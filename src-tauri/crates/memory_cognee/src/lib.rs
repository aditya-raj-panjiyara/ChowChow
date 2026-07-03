//! # Cognee Memory Engine
//!
//! Production [`MemoryEngine`] implementation backed by cognee-rs.
//!
//! ## API Mapping (confirmed against cognee-lib v0.1.1 source)
//!
//! | `MemoryEngine` method  | cognee-rs primitive                                         |
//! |------------------------|-------------------------------------------------------------|
//! | `ingest_document()`    | `api::remember()` — add + cognify + optional improve        |
//! | `query()`              | `api::recall()` — auto-routed search with graph traversal   |
//! | `get_graph_snapshot()` | `GraphDBTrait::get_graph_data()` — direct graph read        |
//! | `apply_correction()`   | `api::improve()` — feedback-driven graph refinement         |
//!
//! ## Sovereignty
//!
//! All LLM/embedding calls route through local Ollama. All storage is
//! file-based (SQLite + Ladybug + LanceDB) inside Tauri's `app_data_dir()`.

pub mod config;
pub mod live_graph;
pub mod trace;

use std::borrow::Cow;
use std::sync::Arc;

use async_trait::async_trait;
use memory_engine::*;
use uuid::Uuid;

use cognee_lib::ComponentManager;
use cognee_lib::ConfigManager;
use cognee_lib::PipelineContext;

use cognee_lib::add::AddPipeline;
use cognee_lib::cognify::CognifyConfig;
use cognee_lib::search::{SearchBuilder, SearchOrchestrator};

// Re-export the verb-level API from cognee_lib::prelude
use cognee_lib::prelude::{recall, remember, RecallResult, RememberResult};

use cognee_lib::embedding::EmbeddingEngine;
use cognee_lib::graph::GraphDBTrait;
use cognee_lib::llm::{Llm, Message, MessageRole};
use cognee_lib::models::DataInput;
use cognee_lib::ontology::OntologyResolver;
use cognee_lib::storage::StorageTrait;
use cognee_lib::vector::VectorDB;

use cognee_lib::database::DatabaseConnection;
use cognee_lib::database::CheckpointStore;
use cognee_lib::session::{SessionManager, SessionStore};

use config::CogneeAppConfig;

/// cognee-rs backed implementation of [`MemoryEngine`].
///
/// Holds the wired component graph — initialized eagerly at startup
/// so config errors surface immediately, not on the user's first query.
pub struct CogneeMemoryEngine {
    dataset_name: String,
    owner_id: Uuid,

    // Component handles — all Arc<dyn ...>, resolved from ComponentManager
    add_pipeline: Arc<AddPipeline>,
    llm: Arc<dyn Llm>,
    storage: Arc<dyn StorageTrait>,
    graph_db: Arc<dyn GraphDBTrait>,
    vector_db: Arc<dyn VectorDB>,
    embedding_engine: Arc<dyn EmbeddingEngine>,
    db: Option<Arc<DatabaseConnection>>,
    session_store: Option<Arc<dyn SessionStore>>,
    session_manager: Option<Arc<SessionManager>>,
    checkpoint_store: Option<Arc<dyn CheckpointStore>>,
    ontology_resolver: Arc<dyn OntologyResolver>,
    cognify_config: Arc<CognifyConfig>,
    search_orchestrator: SearchOrchestrator,
}

impl CogneeMemoryEngine {
    /// Initialize the cognee-rs engine.
    ///
    /// Eagerly resolves all components to surface config/connectivity errors
    /// at app launch rather than on the user's first operation.
    pub async fn new(app_config: CogneeAppConfig) -> Result<Self, MemoryError> {
        // Set env vars before ConfigManager reads them
        config::apply_env(&app_config);

        let cm = ComponentManager::new(ConfigManager::from_env());

        // Eagerly resolve each component — any failure is a startup error
        let storage = cm
            .storage()
            .await
            .map_err(|e| MemoryError::Storage(format!("storage init failed: {e}")))?;

        let db = cm
            .database()
            .await
            .map(Some)
            .unwrap_or_else(|e| {
                eprintln!("[cognee] database init warning (non-fatal): {e}");
                None
            });

        let graph_db = cm
            .graph_db()
            .await
            .map_err(|e| MemoryError::Storage(format!("graph db init failed: {e}")))?;

        let vector_db = cm
            .vector_db()
            .await
            .map_err(|e| MemoryError::Storage(format!("vector db init failed: {e}")))?;

        let embedding_engine = cm
            .embedding_engine()
            .await
            .map_err(|e| MemoryError::Storage(format!("embedding engine init failed: {e}")))?;

        let llm = cm
            .llm()
            .await
            .map_err(|e| {
                MemoryError::Storage(format!(
                    "LLM connection failed — is Ollama running at {}? Error: {e}",
                    app_config.llm_endpoint
                ))
            })?;

        // Cognition Trace interceptors — wrapped BEFORE the pipelines are
        // built, so every internal LLM call and embedding batch cognee makes
        // streams to the UI as a live trace event.
        let llm: Arc<dyn Llm> = Arc::new(trace::TracedLlm::new(llm));
        let embedding_engine: Arc<dyn EmbeddingEngine> =
            Arc::new(trace::TracedEmbedding::new(embedding_engine));

        // Live Graph interceptor — every node/edge cognee writes (cognify,
        // corrections, audit nodes) is broadcast as a graph-delta event the
        // moment it lands, powering the Graph Explorer's real-time growth view.
        let graph_db: Arc<dyn GraphDBTrait> = Arc::new(live_graph::LiveGraphDb::new(graph_db));

        // Construct session store and manager
        let sessions_dir = app_config.storage_root.join("sessions");
        tokio::fs::create_dir_all(&sessions_dir).await.map_err(|e| {
            MemoryError::Storage(format!("cannot create sessions directory: {e}"))
        })?;
        let session_store: Arc<dyn SessionStore> = Arc::new(
            cognee_session::FsSessionStore::new(&sessions_dir)
        );
        let session_manager = Arc::new(SessionManager::new(session_store.clone()));

        // Construct checkpoint store if database exists
        let checkpoint_store: Option<Arc<dyn CheckpointStore>> = if let Some(ref db_conn) = db {
            Some(Arc::new(cognee_lib::cognee_database::SeaOrmCheckpointStore::new(db_conn.clone())) as Arc<dyn CheckpointStore>)
        } else {
            None
        };

        // Construct AddPipeline
        let ingest_db = db.clone().ok_or_else(|| {
            MemoryError::Storage("relational database connection is required for ingestion".to_string())
        })?;
        let add_pipeline = Arc::new(
            AddPipeline::new(storage.clone(), ingest_db.clone() as Arc<dyn cognee_lib::database::IngestDb>)
                .with_thread_pool(Arc::new(
                    cognee_lib::core::RayonThreadPool::with_default_threads().map_err(|e| {
                        MemoryError::Storage(format!("thread pool creation failed: {e}"))
                    })?,
                ))
                .with_graph_db(graph_db.clone())
                .with_vector_db(vector_db.clone())
                .with_database(ingest_db.clone()),
        );

        // Build SearchOrchestrator for recall
        let search_orchestrator = SearchBuilder::new(
            vector_db.clone(),
            embedding_engine.clone(),
            graph_db.clone(),
            llm.clone(),
            ingest_db.clone() as Arc<dyn cognee_lib::database::SearchHistoryDb>,
        )
        .with_dataset_resolver(ingest_db as Arc<dyn cognee_lib::database::IngestDb>)
        .build();

        // Default cognify config
        let cognify_config = Arc::new(CognifyConfig::default());

        // Default ontology resolver (No-Op is the default when no file is supplied)
        let ontology_resolver: Arc<dyn OntologyResolver> = Arc::new(
            cognee_lib::ontology::NoOpOntologyResolver::new()
        );

        let owner_id = Uuid::new_v4(); // Default owner for single-user desktop app

        Ok(Self {
            dataset_name: app_config.dataset_name,
            owner_id,
            add_pipeline,
            llm,
            storage,
            graph_db,
            vector_db,
            embedding_engine,
            db,
            session_store: Some(session_store),
            session_manager: Some(session_manager),
            checkpoint_store,
            ontology_resolver,
            cognify_config,
            search_orchestrator,
        })
    }

    /// LLM intent extraction: turn a free-text correction into structured
    /// graph operations against the graph's actual entity vocabulary.
    /// Returns `None` when the model output can't be parsed — callers fall
    /// back to the keyword heuristic.
    async fn extract_correction_ops(
        &self,
        correction_text: &str,
        entities: &[&MemoryEntity],
    ) -> Option<CorrectionOps> {
        let names = entities
            .iter()
            .take(120)
            .map(|e| format!("- {}", e.name))
            .collect::<Vec<_>>()
            .join("\n");

        let system = "You convert supply-chain correction statements into graph operations. \
            Respond with ONLY a JSON object, no prose, in exactly this shape:\n\
            {\"deprecate\": [{\"from\": \"<entity>\", \"to\": \"<entity>\"}], \
             \"create\": [{\"from\": \"<entity>\", \"to\": \"<entity>\", \"relationship\": \"<snake_case_verb>\"}]}\n\
            Rules:\n\
            - deprecate: relationships the correction says are no longer true. \
              Use ONLY names from KNOWN ENTITIES for both ends; if an end is not listed, omit that pair.\n\
            - create: new relationships the correction introduces. Names not in \
              KNOWN ENTITIES are allowed here (new entities will be created).\n\
            - Direction runs from the provider/source toward the receiver \
              (supplier → customer, distributor → syndicate, material → port).\n\
            - If the correction replaces X with Y for target Z: deprecate X→Z and create Y→Z.\n\
            - relationship is a short snake_case verb phrase like distributes_to, ships_via, supplies.\n\
            - Use empty arrays when nothing applies.";

        let user = format!("KNOWN ENTITIES:\n{names}\n\nCORRECTION: {correction_text}");

        let response = self
            .llm
            .generate(
                vec![
                    Message { role: MessageRole::System, content: system.to_string() },
                    Message { role: MessageRole::User, content: user },
                ],
                None,
            )
            .await
            .map_err(|e| eprintln!("[correction] intent extraction LLM call failed: {e}"))
            .ok()?;

        let raw = response.content;
        let start = raw.find('{')?;
        let end = raw.rfind('}')?;
        match serde_json::from_str::<CorrectionOps>(&raw[start..=end]) {
            Ok(ops) => Some(ops),
            Err(e) => {
                eprintln!("[correction] could not parse intent JSON (falling back): {e}");
                None
            }
        }
    }

    /// Create a new entity node introduced by a correction (e.g. a
    /// replacement supplier that wasn't in the graph yet).
    async fn create_entity_node(&self, name: &str) -> Result<String, MemoryError> {
        let id = Uuid::new_v4().to_string();
        self.graph_db
            .add_node_raw(serde_json::json!({
                "id": id,
                "name": name.trim(),
                "type": "Organization",
                "source": "correction",
            }))
            .await
            .map_err(|e| MemoryError::Storage(format!("entity creation failed: {e}")))?;
        Ok(id)
    }
}

/// Structured operations extracted from a correction statement.
#[derive(Debug, serde::Deserialize)]
struct CorrectionOps {
    #[serde(default)]
    deprecate: Vec<PairOp>,
    #[serde(default)]
    create: Vec<CreateOp>,
}

#[derive(Debug, serde::Deserialize)]
struct PairOp {
    #[serde(default)]
    from: String,
    #[serde(default)]
    to: String,
}

#[derive(Debug, serde::Deserialize)]
struct CreateOp {
    #[serde(default)]
    from: String,
    #[serde(default)]
    to: String,
    #[serde(default)]
    relationship: String,
}

#[async_trait]
impl MemoryEngine for CogneeMemoryEngine {
    /// Maps to `cognee_lib::api::remember()` — add + cognify + optional improve.
    ///
    /// Accepts a file path, reads it, and passes it as `DataInput::Text` to
    /// the remember pipeline.
    async fn ingest_document(
        &self,
        path: &str,
        _source_type: SourceType,
    ) -> Result<IngestSummary, MemoryError> {
        let file_name = std::path::Path::new(path)
            .file_name()
            .map(|f| f.to_string_lossy().to_string())
            .unwrap_or_else(|| path.to_string());
        let op = trace::begin_op(format!("Ingest · {file_name}"));

        // Read file content to pass as DataInput::Text
        let content = tokio::fs::read_to_string(path)
            .await
            .map_err(|e| MemoryError::IngestionFailed(format!("cannot read file: {e}")))?;
        trace::stage("read file", format!("{} chars from {file_name}", content.chars().count()));
        trace::stage(
            "remember() pipeline",
            "add → chunk → cognify (LLM entity extraction) → embed → graph + vector write",
        );

        let data = vec![DataInput::Text(content)];

        let result: RememberResult = remember(
            data,
            &self.dataset_name,
            None,                       // session_id — permanent memory
            true,                       // self_improvement
            self.owner_id,
            None,                       // tenant_id
            self.add_pipeline.clone(),
            self.llm.clone(),
            self.storage.clone(),
            self.graph_db.clone(),
            self.vector_db.clone(),
            self.embedding_engine.clone(),
            self.db.clone(),
            self.session_store.clone(),
            self.session_manager.clone(),
            self.checkpoint_store.clone(),
            self.ontology_resolver.clone(),
            self.cognify_config.clone(),
        )
        .await
        .map_err(|e| MemoryError::IngestionFailed(e.to_string()))?;

        // Extract entity/relationship counts from cognify result if available
        let (entities, relationships) = result
            .cognify_result
            .as_ref()
            .map(|cr| {
                (
                    cr.entities.len() as u32,
                    cr.edges.len() as u32,
                )
            })
            .unwrap_or((result.items_processed as u32, 0));

        op.finish(format!(
            "{entities} entities · {relationships} relationships written to the graph"
        ));

        Ok(IngestSummary {
            entities_extracted: entities,
            relationships_extracted: relationships,
        })
    }

    /// Maps to `cognee_lib::api::recall()` — auto-routed search.
    ///
    /// Returns the search result text plus the graph traversal path
    /// (from `SearchResponse.graphs`) when available.
    ///
    /// Committed corrections (audit nodes in the graph) are injected as an
    /// authoritative overlay on every query: retrieval alone can still
    /// surface pre-correction chunks, so the superseding facts ride along
    /// with the question and win at answer-generation time.
    async fn query(&self, question: &str) -> Result<QueryResult, MemoryError> {
        let op = trace::begin_op(format!("Query · \"{}\"", trace::preview(question, 70)));

        let corrections: Vec<String> = self
            .get_graph_snapshot()
            .await
            .map(|s| {
                s.entities
                    .iter()
                    .filter(|e| e.entity_type == "AuditCorrection")
                    .filter_map(|e| {
                        e.attributes
                            .get("raw_text")
                            .and_then(|v| v.as_str())
                            .map(String::from)
                    })
                    .collect()
            })
            .unwrap_or_default();

        trace::stage(
            "correction overlay",
            if corrections.is_empty() {
                "no committed corrections to apply".to_string()
            } else {
                format!("{} committed correction(s) injected as authoritative context", corrections.len())
            },
        );

        let effective_question = if corrections.is_empty() {
            question.to_string()
        } else {
            format!(
                "Authoritative corrections — these supersede any conflicting \
                 information in the knowledge base:\n- {}\n\nQuestion: {question}",
                corrections.join("\n- ")
            )
        };

        trace::stage(
            "recall() pipeline",
            "embed question → vector search → graph traversal context → LLM completion",
        );

        let result: RecallResult = recall(
            &effective_question,
            None,                               // query_type — auto-route
            // cognee-lib 0.1.1 bug: run_graph() hardcodes user_id: None in
            // SearchRequest, so the orchestrator rejects any datasets filter.
            // Pass None here (unfiltered search) as the workaround.
            None,                               // datasets
            10,                                 // top_k
            true,                               // auto_route
            None,                               // session_id — query permanent memory
            None,                               // user_id (unused without datasets filter)
            &self.search_orchestrator,
            self.session_store.as_ref().map(|s| s.as_ref()),
            self.session_manager.as_ref().map(|s| s.as_ref()),
            None,                               // scope — auto
            None,                               // options
        )
        .await
        .map_err(|e| MemoryError::QueryFailed(e.to_string()))?;

        // Build answer text from recall items
        let answer = if result.items.is_empty() {
            "No matching results found in the knowledge graph.".to_string()
        } else {
            result
                .items
                .iter()
                .map(|item| {
                    // Each RecallItem.content is a serde_json::Value
                    if let Some(text) = item.content.as_str() {
                        text.to_string()
                    } else {
                        item.content.to_string()
                    }
                })
                .collect::<Vec<_>>()
                .join("\n\n")
        };

        // Extract reasoning path from the SearchResponse graph data
        let mut reasoning_path = Vec::new();
        if let Some(ref response) = result.search_response {
            if let Some(ref graphs) = response.graphs {
                for (_dataset, search_graph) in graphs {
                    for node in &search_graph.nodes {
                        reasoning_path.push(MemoryEntity {
                            id: node.id.clone(),
                            entity_type: "GraphNode".to_string(),
                            name: node.label.clone(),
                            attributes: serde_json::Value::Null,
                        });
                    }
                }
            }
        }

        // GRAPH_COMPLETION answers don't always carry traversal data in the
        // response. Fall back to deriving the path from graph entities that
        // the answer actually mentions, ordered by first appearance.
        if reasoning_path.is_empty() && !result.items.is_empty() {
            if let Ok(snapshot) = self.get_graph_snapshot().await {
                let answer_lower = answer.to_lowercase();
                let mut mentioned: Vec<(usize, MemoryEntity)> = snapshot
                    .entities
                    .into_iter()
                    .filter(|e| e.name.len() >= 3)
                    .filter_map(|e| {
                        answer_lower.find(&e.name.to_lowercase()).map(|pos| (pos, e))
                    })
                    .collect();
                mentioned.sort_by_key(|(pos, _)| *pos);
                reasoning_path = mentioned
                    .into_iter()
                    .map(|(_, e)| e)
                    .take(8)
                    .collect();
            }
        }

        // Derive confidence from result quality
        let confidence = if result.items.is_empty() {
            ConfidenceLevel::Low
        } else if result.items.len() >= 3 {
            ConfidenceLevel::High
        } else {
            ConfidenceLevel::Partial
        };

        op.finish(format!(
            "answer ready · {} reasoning entities · confidence {confidence:?}",
            reasoning_path.len()
        ));

        Ok(QueryResult {
            answer,
            reasoning_path,
            confidence,
        })
    }

    /// Direct graph read via `GraphDBTrait::get_graph_data()`.
    ///
    /// Returns the *domain* graph for the Graph Explorer / Blast Radius:
    /// - cognee stores every extracted entity with `type = "Entity"` and the
    ///   semantic type ("Person", "Location", "Product"…) on a separate
    ///   `EntityType` node referenced via the `is_a` property — resolved here.
    /// - cognee's pipeline plumbing (chunks, documents, summaries, the
    ///   EntityType nodes themselves) is filtered out along with its edges.
    async fn get_graph_snapshot(&self) -> Result<GraphSnapshot, MemoryError> {
        let (nodes, edges) = self
            .graph_db
            .get_graph_data()
            .await
            .map_err(|e| MemoryError::Storage(format!("graph snapshot failed: {e}")))?;

        use live_graph::PLUMBING_TYPES;

        // First pass: EntityType node id → semantic type name ("Person", …).
        let mut type_name_by_id: std::collections::HashMap<String, String> =
            std::collections::HashMap::new();
        for (id, props) in &nodes {
            let node_type = props
                .get(&Cow::Borrowed("type"))
                .and_then(|v| v.as_str())
                .unwrap_or("");
            if node_type == "EntityType" {
                if let Some(name) = props.get(&Cow::Borrowed("name")).and_then(|v| v.as_str()) {
                    type_name_by_id.insert(id.clone(), name.to_string());
                }
            }
        }

        let mut kept_ids: std::collections::HashSet<String> = std::collections::HashSet::new();
        let entities: Vec<MemoryEntity> = nodes
            .into_iter()
            .filter_map(|(id, props)| {
                let raw_type = props
                    .get(&Cow::Borrowed("type"))
                    .and_then(|v| v.as_str())
                    .unwrap_or("Unknown")
                    .to_string();

                if PLUMBING_TYPES.contains(&raw_type.as_str()) {
                    return None;
                }

                // Resolve the semantic type via the is_a → EntityType link.
                let entity_type = if raw_type == "Entity" {
                    props
                        .get(&Cow::Borrowed("is_a"))
                        .and_then(|v| v.as_str())
                        .and_then(|type_id| type_name_by_id.get(type_id))
                        .cloned()
                        .unwrap_or(raw_type)
                } else {
                    raw_type
                };

                let name = props
                    .get(&Cow::Borrowed("name"))
                    .and_then(|v| v.as_str())
                    .unwrap_or(&id)
                    .to_string();

                // Convert remaining properties to a JSON object
                let attributes: serde_json::Value = serde_json::to_value(
                    props
                        .iter()
                        .filter(|(k, _)| k.as_ref() != "type" && k.as_ref() != "name")
                        .map(|(k, v)| (k.to_string(), v.clone()))
                        .collect::<serde_json::Map<String, serde_json::Value>>(),
                )
                .unwrap_or(serde_json::Value::Null);

                kept_ids.insert(id.clone());
                Some(MemoryEntity {
                    id,
                    entity_type,
                    name,
                    attributes,
                })
            })
            .collect();

        let relationships: Vec<MemoryRelationship> = edges
            .into_iter()
            .filter(|(from_id, to_id, _, _)| {
                kept_ids.contains(from_id) && kept_ids.contains(to_id)
            })
            .map(|(from_id, to_id, rel_type, props)| {
                let weight = props
                    .get(&Cow::Borrowed("weight"))
                    .and_then(|v| v.as_f64())
                    .unwrap_or(1.0) as f32;

                let active = props
                    .get(&Cow::Borrowed("active"))
                    .and_then(|v| v.as_bool())
                    .unwrap_or(true);

                MemoryRelationship {
                    from_id,
                    to_id,
                    relationship_type: rel_type,
                    weight,
                    active,
                }
            })
            .collect();

        Ok(GraphSnapshot {
            entities,
            relationships,
        })
    }

    /// Drift Sentinel — cross-examine new content against prior beliefs.
    ///
    /// The full-potential move: `recall()`'s semantic retrieval does the
    /// "what could this contradict?" work by pulling the prior chunks and
    /// graph context most related to the new document, and the LLM compares
    /// claim-by-claim. Findings feed Command Center alerts, each carrying a
    /// ready-to-apply correction for the two-phase learning loop.
    async fn detect_drift(&self, new_content: &str) -> Result<Vec<DriftFinding>, MemoryError> {
        let op = trace::begin_op("Drift Sentinel · cross-examination");
        trace::stage(
            "recall() as auditor",
            "retrieve prior beliefs semantically related to the new content, LLM compares claim-by-claim",
        );
        let excerpt: String = new_content.chars().take(1800).collect();

        let prompt = format!(
            "You are a supply-chain state-drift auditor. Compare the NEW DOCUMENT \
             below against previously known facts from memory. Identify only genuine \
             factual contradictions (a relationship that changed, a route that moved, \
             a supplier that was replaced) — not new information that merely adds detail.\n\
             Respond with ONLY a JSON array, no prose. Each element:\n\
             {{\"severity\": \"critical\"|\"elevated\", \"entity\": \"<name>\", \
             \"prior_belief\": \"<what memory says>\", \"new_claim\": \"<what the document says>\", \
             \"suggested_correction\": \"<one imperative sentence stating the update>\"}}\n\
             If there are no contradictions, respond with [].\n\n\
             NEW DOCUMENT:\n{excerpt}"
        );

        let result: RecallResult = recall(
            &prompt,
            None,
            None,
            10,
            true,
            None,
            None,
            &self.search_orchestrator,
            self.session_store.as_ref().map(|s| s.as_ref()),
            self.session_manager.as_ref().map(|s| s.as_ref()),
            None,
            None,
        )
        .await
        .map_err(|e| MemoryError::QueryFailed(format!("drift scan failed: {e}")))?;

        let raw = result
            .items
            .iter()
            .map(|item| item.content.as_str().map(String::from).unwrap_or_else(|| item.content.to_string()))
            .collect::<Vec<_>>()
            .join("\n");

        // Defensive JSON extraction — take the outermost [...] block.
        let json_slice = match (raw.find('['), raw.rfind(']')) {
            (Some(start), Some(end)) if end > start => &raw[start..=end],
            _ => {
                op.finish("no contradictions found");
                return Ok(Vec::new());
            }
        };

        let parsed: Vec<serde_json::Value> = match serde_json::from_str(json_slice) {
            Ok(v) => v,
            Err(e) => {
                eprintln!("[sentinel] could not parse drift JSON (non-fatal): {e}");
                op.finish("model output unparseable — treated as no contradictions");
                return Ok(Vec::new());
            }
        };

        let str_field = |v: &serde_json::Value, key: &str| -> String {
            v.get(key).and_then(|x| x.as_str()).unwrap_or_default().to_string()
        };

        let findings: Vec<DriftFinding> = parsed
            .into_iter()
            .filter_map(|v| {
                let new_claim = str_field(&v, "new_claim");
                let prior_belief = str_field(&v, "prior_belief");
                let suggested = str_field(&v, "suggested_correction");
                if new_claim.is_empty() && prior_belief.is_empty() {
                    return None;
                }
                let severity = match str_field(&v, "severity").to_lowercase().as_str() {
                    "critical" => "critical".to_string(),
                    _ => "elevated".to_string(),
                };
                let entity = str_field(&v, "entity");
                Some(DriftFinding {
                    severity,
                    entity_name: if entity.is_empty() { None } else { Some(entity) },
                    prior_belief,
                    new_claim: new_claim.clone(),
                    suggested_correction: if suggested.is_empty() { new_claim } else { suggested },
                })
            })
            .collect();

        op.finish(if findings.is_empty() {
            "no contradictions found".to_string()
        } else {
            format!("{} contradiction(s) → Command Center alerts", findings.len())
        });

        Ok(findings)
    }

    /// Dynamic learning loop — corrections restructure the graph for real.
    ///
    /// cognee's `improve()` only applies *session Q&A feedback* entries, not
    /// free-text corrections, so this is implemented directly:
    /// 1. LLM intent extraction turns the correction into structured graph
    ///    operations (deprecate pairs + create triples) against the graph's
    ///    actual entity vocabulary — handles any phrasing ("no longer…",
    ///    "update X to Y", "Z is replaced by W").
    /// 2. Deprecated edges are marked inactive (amber-dashed in the UI,
    ///    never deleted); replacement edges are created, spawning new
    ///    entities when the correction introduces them.
    /// 3. A real audit node is written into the graph for traceability.
    /// 4. The correction statement is memified (`remember()`) so retrieval
    ///    sees the superseding fact and follow-up answers change.
    ///
    /// If the LLM extraction fails or returns nothing, a keyword-negation
    /// heuristic still deprecates edges between mentioned entities, so a
    /// flaky model degrades gracefully rather than silently doing nothing.
    async fn apply_correction(
        &self,
        correction: CorrectionIntent,
    ) -> Result<CorrectionResult, MemoryError> {
        let op = trace::begin_op(format!(
            "Correction · \"{}\"",
            trace::preview(&correction.raw_text, 70)
        ));
        let snapshot = self.get_graph_snapshot().await?;
        let text_lower = correction.raw_text.to_lowercase();
        let timestamp = chrono::Utc::now().to_rfc3339();

        let graph_entities: Vec<&MemoryEntity> = snapshot
            .entities
            .iter()
            .filter(|e| e.entity_type != "AuditCorrection")
            .collect();

        // Name → id resolution: exact (case-insensitive) first, then containment.
        let resolve = |name: &str| -> Option<String> {
            let lower = name.trim().to_lowercase();
            if lower.len() < 3 {
                return None;
            }
            graph_entities
                .iter()
                .find(|e| e.name.to_lowercase() == lower)
                .or_else(|| {
                    graph_entities.iter().find(|e| {
                        let en = e.name.to_lowercase();
                        en.contains(&lower) || lower.contains(&en)
                    })
                })
                .map(|e| e.id.clone())
        };

        let mut edges_deprecated: u32 = 0;
        let mut edges_created_direct: u32 = 0;

        let deprecate_pair = |from_id: &str, to_id: &str| -> Vec<(String, String, String)> {
            snapshot
                .relationships
                .iter()
                .filter(|r| {
                    r.active
                        && ((r.from_id == from_id && r.to_id == to_id)
                            || (r.from_id == to_id && r.to_id == from_id))
                })
                .map(|r| (r.from_id.clone(), r.to_id.clone(), r.relationship_type.clone()))
                .collect()
        };

        // 1. LLM intent extraction → structured operations.
        trace::stage(
            "intent extraction",
            "LLM converts the correction into deprecate/create graph operations",
        );
        let ops = self
            .extract_correction_ops(&correction.raw_text, &graph_entities)
            .await;

        let mut targets: Vec<(String, String, String)> = Vec::new(); // edges to deprecate
        let mut creations: Vec<(String, String, String)> = Vec::new(); // from_id, to_id, rel

        match &ops {
            Some(ops) if !(ops.deprecate.is_empty() && ops.create.is_empty()) => {
                for pair in &ops.deprecate {
                    if let (Some(a), Some(b)) = (resolve(&pair.from), resolve(&pair.to)) {
                        targets.extend(deprecate_pair(&a, &b));
                    }
                }
                for op in &ops.create {
                    let from_id = match resolve(&op.from) {
                        Some(id) => id,
                        None => self.create_entity_node(&op.from).await?,
                    };
                    let to_id = match resolve(&op.to) {
                        Some(id) => id,
                        None => self.create_entity_node(&op.to).await?,
                    };
                    let rel = if op.relationship.trim().is_empty() {
                        "related_to".to_string()
                    } else {
                        op.relationship.trim().to_lowercase().replace(' ', "_")
                    };
                    // Skip if an identical active edge already exists.
                    let exists = snapshot.relationships.iter().any(|r| {
                        r.active
                            && r.from_id == from_id
                            && r.to_id == to_id
                            && r.relationship_type == rel
                    });
                    if !exists {
                        creations.push((from_id, to_id, rel));
                    }
                }
            }
            _ => {
                // Fallback: keyword negation between mentioned entities.
                const NEGATIONS: [&str; 12] = [
                    "no longer", "not ", "never", "stopped", "stops", "ceased",
                    "ended", "cut off", "does not", "doesn't", "removed", "replaced",
                ];
                if NEGATIONS.iter().any(|k| text_lower.contains(k)) {
                    let mentioned: Vec<&&MemoryEntity> = graph_entities
                        .iter()
                        .filter(|e| e.name.len() >= 3 && text_lower.contains(&e.name.to_lowercase()))
                        .collect();
                    for a in &mentioned {
                        for b in &mentioned {
                            if a.id != b.id {
                                targets.extend(deprecate_pair(&a.id, &b.id));
                            }
                        }
                    }
                }
            }
        }

        // 2a. Apply deprecations.
        targets.sort();
        targets.dedup();
        for (from_id, to_id, rel_type) in &targets {
            for (key, value) in [
                ("active", serde_json::json!(false)),
                ("deprecated_by", serde_json::json!(correction.author)),
                ("deprecated_at", serde_json::json!(timestamp)),
            ] {
                self.graph_db
                    .update_edge_property(from_id, to_id, rel_type, key, value)
                    .await
                    .map_err(|e| MemoryError::Storage(format!("edge deprecation failed: {e}")))?;
            }
            edges_deprecated += 1;
        }

        // 2b. Apply creations.
        for (from_id, to_id, rel) in &creations {
            let props: std::collections::HashMap<Cow<'static, str>, serde_json::Value> = [
                (Cow::Borrowed("weight"), serde_json::json!(1.0)),
                (Cow::Borrowed("active"), serde_json::json!(true)),
                (Cow::Borrowed("source"), serde_json::json!("correction")),
                (Cow::Borrowed("created_by"), serde_json::json!(correction.author)),
                (Cow::Borrowed("created_at"), serde_json::json!(timestamp)),
            ]
            .into_iter()
            .collect();
            self.graph_db
                .add_edge(from_id, to_id, rel, Some(props))
                .await
                .map_err(|e| MemoryError::Storage(format!("edge creation failed: {e}")))?;
            edges_created_direct += 1;
        }

        trace::stage(
            "graph surgery",
            format!(
                "{edges_deprecated} edge(s) deprecated (amber-dashed, audit-preserved) · {edges_created_direct} created"
            ),
        );

        // 3. Audit node — lives in the graph itself, never deleted.
        let audit_node_id = format!("audit-{}", Uuid::new_v4());
        self.graph_db
            .add_node_raw(serde_json::json!({
                "id": audit_node_id,
                "name": format!("Correction by {}", correction.author),
                "type": "AuditCorrection",
                "raw_text": correction.raw_text,
                "author": correction.author,
                "timestamp": timestamp,
                "edges_deprecated": edges_deprecated,
            }))
            .await
            .map_err(|e| MemoryError::Storage(format!("audit node creation failed: {e}")))?;
        trace::stage("audit node", format!("written into the graph: {audit_node_id}"));

        // 4. Memify the superseding fact so retrieval reflects the correction.
        trace::stage(
            "memify correction",
            "remember() writes the superseding fact into semantic memory",
        );
        let corrective_statement = format!(
            "CORRECTION ({timestamp}, recorded by {}): {}. \
             This correction supersedes and deprecates any earlier statement \
             that contradicts it.",
            correction.author, correction.raw_text
        );
        let result: RememberResult = remember(
            vec![DataInput::Text(corrective_statement)],
            &self.dataset_name,
            None,
            true,
            self.owner_id,
            None,
            self.add_pipeline.clone(),
            self.llm.clone(),
            self.storage.clone(),
            self.graph_db.clone(),
            self.vector_db.clone(),
            self.embedding_engine.clone(),
            self.db.clone(),
            self.session_store.clone(),
            self.session_manager.clone(),
            self.checkpoint_store.clone(),
            self.ontology_resolver.clone(),
            self.cognify_config.clone(),
        )
        .await
        .map_err(|e| MemoryError::Storage(format!("correction memify failed: {e}")))?;

        let edges_created = edges_created_direct
            + result
                .cognify_result
                .as_ref()
                .map(|cr| cr.edges.len() as u32)
                .unwrap_or(0);

        op.finish(format!(
            "{edges_created} edge(s) created · {edges_deprecated} deprecated · audit {audit_node_id}"
        ));

        Ok(CorrectionResult {
            edges_created,
            edges_deprecated,
            audit_node_id,
        })
    }
}
