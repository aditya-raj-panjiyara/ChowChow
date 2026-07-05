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
pub mod muted_graph;
pub mod schema_repair;
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
use cognee_lib::cognee_delete::{DeleteMode, DeleteRequest, DeleteScope, DeleteService};
use cognee_lib::prelude::{improve, ImproveParams};

/// Session that records every Q&A so answer feedback can drive `improve()`.
const APP_SESSION: &str = "app-main";

use cognee_lib::database::DeleteDb;

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

        // Configure RDF/OWL Ontology Enforcement
        let ontology_path = app_config.storage_root.join("ontology.ttl");
        if !ontology_path.exists() {
            // Write default embedded ontology if not exists
            let default_ttl = r#"@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
@prefix owl: <http://www.w3.org/2002/07/owl#> .
@prefix sc: <http://supplychain.org/ontology#> .

sc:Material rdf:type owl:Class ;
    rdfs:label "Material" .

sc:Supplier rdf:type owl:Class ;
    rdfs:label "Supplier" .

sc:Port rdf:type owl:Class ;
    rdfs:label "Port" .

sc:Factory rdf:type owl:Class ;
    rdfs:label "Factory" .

sc:Customer rdf:type owl:Class ;
    rdfs:label "Customer" .

sc:supplies rdf:type owl:ObjectProperty ;
    rdfs:label "supplies" ;
    rdfs:domain sc:Supplier ;
    rdfs:range sc:Material .

sc:ships_via rdf:type owl:ObjectProperty ;
    rdfs:label "ships_via" ;
    rdfs:domain sc:Material ;
    rdfs:range sc:Port .

sc:stored_in rdf:type owl:ObjectProperty ;
    rdfs:label "stored_in" ;
    rdfs:domain sc:Material ;
    rdfs:range sc:Factory .

sc:fulfills rdf:type owl:ObjectProperty ;
    rdfs:label "fulfills" ;
    rdfs:domain sc:Factory ;
    rdfs:range sc:Customer .
"#;
            let _ = std::fs::write(&ontology_path, default_ttl);
        }

        let ontology_resolver: Arc<dyn OntologyResolver> = match cognee_lib::ontology::RdfLibOntologyResolver::new(ontology_path) {
            Ok(resolver) => Arc::new(resolver),
            Err(e) => {
                eprintln!("Failed to load RdfLibOntologyResolver, falling back to NoOp: {e:?}");
                Arc::new(cognee_lib::ontology::NoOpOntologyResolver::new())
            }
        };

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
             \"create\": [{\"from\": \"<entity>\", \"to\": \"<entity>\", \"relationship\": \"<snake_case_verb>\"}], \
             \"retire\": [\"<entity>\"], \"restore\": [\"<entity>\"]}\n\
            Rules:\n\
            - deprecate: specific relationships the correction says are no longer true. \
              Use ONLY names from KNOWN ENTITIES for both ends; if an end is not listed, omit that pair.\n\
            - retire: entities the correction discontinues, closes, or marks unusable \
              as a whole (a port closed, a route discontinued, a supplier shut down) — \
              EVERY active relationship they have will be deprecated. Use ONLY names \
              from KNOWN ENTITIES. Use this when the correction names one entity \
              rather than a specific relationship between two.\n\
            - restore: entities the correction re-activates, reopens, or marks \
              usable again (a port reopened, a route resumed, a supplier back \
              online) — EVERY deprecated relationship they have will be \
              re-activated. Use ONLY names from KNOWN ENTITIES.\n\
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
    /// Entities retired wholesale — every active edge they touch is deprecated.
    #[serde(default)]
    retire: Vec<String>,
    /// Entities restored wholesale — every deprecated edge they touch is re-activated.
    #[serde(default)]
    restore: Vec<String>,
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

fn preprocess_text(text: &str) -> String {
    let mut result = String::with_capacity(text.len());
    let chars: Vec<char> = text.chars().collect();
    let mut i = 0;
    while i < chars.len() {
        if chars[i] == '/' {
            let prev_ok = i > 0 && chars[i - 1].is_alphanumeric();
            let next_ok = i + 1 < chars.len() && chars[i + 1].is_alphanumeric();
            if prev_ok && next_ok {
                result.push_str(" and ");
                i += 1;
                continue;
            }
        }
        result.push(chars[i]);
        i += 1;
    }
    result
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
        let raw_content = tokio::fs::read_to_string(path)
            .await
            .map_err(|e| MemoryError::IngestionFailed(format!("cannot read file: {e}")))?;
        let content = preprocess_text(&raw_content);
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

        // Record the Q&A in the app session so the user can rate this answer
        // later — feedback drives cognee's improve() bridge. The reasoning
        // path rides along as used_graph_element_ids: feedback weights only
        // apply to entries that name the graph elements behind the answer.
        // Non-fatal.
        let used_elements = if reasoning_path.is_empty() {
            None
        } else {
            Some(cognee_session::UsedGraphElementIds {
                node_ids: reasoning_path.iter().map(|e| e.id.clone()).collect(),
                edge_ids: Vec::new(),
            })
        };
        let qa_id = if let Some(sm) = &self.session_manager {
            match sm
                .save_qa(Some(APP_SESSION), None, question, &answer, None, used_elements)
                .await
            {
                Ok(id) => Some(id),
                Err(e) => {
                    eprintln!("[query] could not record Q&A for feedback (non-fatal): {e}");
                    None
                }
            }
        } else {
            None
        };

        op.finish(format!(
            "answer ready · {} reasoning entities · confidence {confidence:?}",
            reasoning_path.len()
        ));

        Ok(QueryResult {
            answer,
            reasoning_path,
            confidence,
            qa_id,
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
                    type_name_by_id.insert(id.replace("-", "").to_lowercase(), name.to_string());
                    if let Some(attr_id) = props.get(&Cow::Borrowed("id")).and_then(|v| v.as_str()) {
                        type_name_by_id.insert(attr_id.to_string(), name.to_string());
                        type_name_by_id.insert(attr_id.replace("-", "").to_lowercase(), name.to_string());
                    }
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
                        .and_then(|type_id| {
                            type_name_by_id
                                .get(type_id)
                                .or_else(|| type_name_by_id.get(&type_id.replace("-", "").to_lowercase()))
                        })
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
        //
        // Returns ALL matching ids: repeated ingests/memify can create several
        // nodes with the same name, and their edges are spread across the
        // duplicates (the UI merges them by name). Deprecating only the first
        // match would leave the other duplicates' edges active.
        let resolve_all = |name: &str| -> Vec<String> {
            let lower = name.trim().to_lowercase();
            if lower.len() < 3 {
                return Vec::new();
            }
            let exact: Vec<String> = graph_entities
                .iter()
                .filter(|e| e.name.to_lowercase() == lower)
                .map(|e| e.id.clone())
                .collect();
            if !exact.is_empty() {
                return exact;
            }
            graph_entities
                .iter()
                .filter(|e| {
                    let en = e.name.to_lowercase();
                    en.contains(&lower) || lower.contains(&en)
                })
                .map(|e| e.id.clone())
                .collect()
        };
        let resolve = |name: &str| -> Option<String> { resolve_all(name).into_iter().next() };

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

        // Retire an entity wholesale: every active edge it touches.
        let deprecate_all = |entity_id: &str| -> Vec<(String, String, String)> {
            snapshot
                .relationships
                .iter()
                .filter(|r| r.active && (r.from_id == entity_id || r.to_id == entity_id))
                .map(|r| (r.from_id.clone(), r.to_id.clone(), r.relationship_type.clone()))
                .collect()
        };

        // Restore an entity wholesale: every deprecated edge it touches.
        let restore_all = |entity_id: &str| -> Vec<(String, String, String)> {
            snapshot
                .relationships
                .iter()
                .filter(|r| !r.active && (r.from_id == entity_id || r.to_id == entity_id))
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
        let mut revivals: Vec<(String, String, String)> = Vec::new(); // edges to re-activate
        let mut creations: Vec<(String, String, String)> = Vec::new(); // from_id, to_id, rel

        match &ops {
            Some(ops)
                if !(ops.deprecate.is_empty()
                    && ops.create.is_empty()
                    && ops.retire.is_empty()
                    && ops.restore.is_empty()) =>
            {
                for pair in &ops.deprecate {
                    // Cross-product: edges may connect any duplicate of either name.
                    for a in resolve_all(&pair.from) {
                        for b in resolve_all(&pair.to) {
                            targets.extend(deprecate_pair(&a, &b));
                        }
                    }
                }
                for name in &ops.retire {
                    for id in resolve_all(name) {
                        targets.extend(deprecate_all(&id));
                    }
                }
                for name in &ops.restore {
                    for id in resolve_all(name) {
                        revivals.extend(restore_all(&id));
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
                    // Skip if an identical active edge already exists; if a
                    // deprecated identical edge exists, re-activate it instead
                    // of stacking a duplicate on top.
                    let existing = snapshot.relationships.iter().find(|r| {
                        r.from_id == from_id && r.to_id == to_id && r.relationship_type == rel
                    });
                    match existing {
                        Some(r) if r.active => {}
                        Some(_) => revivals.push((from_id, to_id, rel)),
                        None => creations.push((from_id, to_id, rel)),
                    }
                }
            }
            _ => {
                // Fallback: keyword heuristics between mentioned entities.
                const NEGATIONS: [&str; 17] = [
                    "no longer", "not ", "never", "stopped", "stops", "ceased",
                    "ended", "cut off", "does not", "doesn't", "removed", "replaced",
                    "discontinued", "unusable", "closed", "suspended", "retired",
                ];
                const REVIVALS: [&str; 9] = [
                    "active again", "reactivated", "re-activated", "reopened",
                    "resumed", "restored", "back online", "operational again",
                    "usable again",
                ];
                let mentioned: Vec<&&MemoryEntity> = graph_entities
                    .iter()
                    .filter(|e| e.name.len() >= 3 && text_lower.contains(&e.name.to_lowercase()))
                    .collect();
                let distinct_names: std::collections::HashSet<String> =
                    mentioned.iter().map(|e| e.name.to_lowercase()).collect();

                // Revival keywords win: "active again" contains no negation,
                // but guard the order anyway so "no longer unusable"-style
                // phrasings lean toward restore.
                if REVIVALS.iter().any(|k| text_lower.contains(k)) {
                    if distinct_names.len() == 1 {
                        for m in &mentioned {
                            revivals.extend(restore_all(&m.id));
                        }
                    } else {
                        // Restore the deprecated edges between the mentioned pair(s).
                        for a in &mentioned {
                            for b in &mentioned {
                                if a.id != b.id && a.name.to_lowercase() != b.name.to_lowercase() {
                                    revivals.extend(
                                        snapshot
                                            .relationships
                                            .iter()
                                            .filter(|r| {
                                                !r.active
                                                    && ((r.from_id == a.id && r.to_id == b.id)
                                                        || (r.from_id == b.id && r.to_id == a.id))
                                            })
                                            .map(|r| (r.from_id.clone(), r.to_id.clone(), r.relationship_type.clone())),
                                    );
                                }
                            }
                        }
                    }
                } else if NEGATIONS.iter().any(|k| text_lower.contains(k)) {
                    // Pairs only between distinct *names* — duplicates of the
                    // same entity are not a relationship to deprecate.
                    for a in &mentioned {
                        for b in &mentioned {
                            if a.id != b.id && a.name.to_lowercase() != b.name.to_lowercase() {
                                targets.extend(deprecate_pair(&a.id, &b.id));
                            }
                        }
                    }
                    // Single-entity corrections ("the Port of Bangkok route is
                    // discontinued") have no pair to deprecate — retire every
                    // active edge touching every duplicate of the one name.
                    if targets.is_empty() && distinct_names.len() == 1 {
                        for m in &mentioned {
                            targets.extend(deprecate_all(&m.id));
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

        // 2b. Apply revivals — deprecated edges flip back to active.
        let mut edges_restored: u32 = 0;
        revivals.sort();
        revivals.dedup();
        // An edge can't be both retired and restored in one correction; the
        // explicit deprecations win, so drop overlaps from the revival list.
        revivals.retain(|r| !targets.contains(r));
        for (from_id, to_id, rel_type) in &revivals {
            for (key, value) in [
                ("active", serde_json::json!(true)),
                ("restored_by", serde_json::json!(correction.author)),
                ("restored_at", serde_json::json!(timestamp)),
            ] {
                self.graph_db
                    .update_edge_property(from_id, to_id, rel_type, key, value)
                    .await
                    .map_err(|e| MemoryError::Storage(format!("edge restore failed: {e}")))?;
            }
            edges_restored += 1;
        }

        // 2c. Apply creations.
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
                "{edges_deprecated} edge(s) deprecated (amber-dashed, audit-preserved) · {edges_restored} restored · {edges_created_direct} created"
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
                "edges_restored": edges_restored,
            }))
            .await
            .map_err(|e| MemoryError::Storage(format!("audit node creation failed: {e}")))?;
        trace::stage("audit node", format!("written into the graph: {audit_node_id}"));

        // 4. Memify the superseding fact so retrieval reflects the correction.
        //
        // Graph writes are MUTED here: the corrective statement must land in
        // vector memory (so recall and the Drift Sentinel see the superseding
        // fact), but cognify's entity extraction of the statement itself would
        // pollute the graph with metadata junk — "Correction", the timestamp,
        // the author's name, duplicates of entities the correction mentions.
        // The graph surgery a correction needs already happened above,
        // precisely.
        trace::stage(
            "memify correction",
            "remember() writes the superseding fact into semantic memory (graph writes muted)",
        );
        let corrective_statement = format!(
            "CORRECTION ({timestamp}, recorded by {}): {}. \
             This correction supersedes and deprecates any earlier statement \
             that contradicts it.",
            correction.author, correction.raw_text
        );
        let muted_graph: Arc<dyn GraphDBTrait> =
            Arc::new(muted_graph::MutedGraphDb::new(self.graph_db.clone()));
        let _result: RememberResult = remember(
            vec![DataInput::Text(corrective_statement)],
            &self.dataset_name,
            None,
            true,
            self.owner_id,
            None,
            self.add_pipeline.clone(),
            self.llm.clone(),
            self.storage.clone(),
            muted_graph,
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

        // Only edges this correction wrote deliberately — memify's cognify
        // output never reaches the graph, so it is not counted.
        let edges_created = edges_created_direct;

        op.finish(format!(
            "{edges_created} edge(s) created · {edges_deprecated} deprecated · {edges_restored} restored · audit {audit_node_id}"
        ));

        Ok(CorrectionResult {
            edges_created,
            edges_deprecated,
            edges_restored,
            audit_node_id,
        })
    }

    /// The "right to be forgotten" — maps to `cognee_lib`'s forget/delete API.
    ///
    /// [`DeleteService`] cascades a hard delete in dependency order across
    /// every backend: relational DB → graph DB → vector DB → file storage,
    /// including orphan sweeps, so no dangling references remain. Because the
    /// graph handle is the [`live_graph::LiveGraphDb`] interceptor, node
    /// removals stream to the Graph Explorer as they happen.
    async fn forget_all(&self) -> Result<ForgetSummary, MemoryError> {
        let op = trace::begin_op("Forget · erase all memory");
        let db = self.db.clone().ok_or_else(|| {
            MemoryError::Storage("relational database connection is required for forget".to_string())
        })?;

        trace::stage(
            "cognee DeleteService",
            "cascading hard delete — relational → graph → vector → file storage, with orphan sweep",
        );
        let mut service = DeleteService::new(self.storage.clone(), db as Arc<dyn DeleteDb>)
            .with_graph_db(self.graph_db.clone())
            .with_vector_db(self.vector_db.clone());
        if let Some(store) = &self.session_store {
            service = service.with_session_store(store.clone());
        }

        let result = service
            .execute(&DeleteRequest {
                scope: DeleteScope::All,
                mode: DeleteMode::Hard,
                memory_only: false,
            })
            .await
            .map_err(|e| MemoryError::Storage(format!("forget failed: {e}")))?;

        op.finish(format!(
            "{} graph node(s) · {} vector point(s) · {} document(s) · {} file(s) forgotten",
            result.deleted_graph_nodes,
            result.deleted_vector_points,
            result.deleted_data,
            result.deleted_storage_files,
        ));

        Ok(ForgetSummary {
            graph_nodes_removed: result.deleted_graph_nodes as u32,
            vector_points_removed: result.deleted_vector_points as u32,
            documents_removed: result.deleted_data as u32,
            files_removed: result.deleted_storage_files as u32,
        })
    }

    /// Answer feedback → cognee's `improve()` bridge.
    ///
    /// 1. The thumbs-up/down (mapped to a 1–5 score) is attached to the Q&A
    ///    entry recorded by `query()`.
    /// 2. `improve()` runs its four-stage pipeline: feedback weights are
    ///    propagated onto the graph nodes/edges that produced the answer,
    ///    session Q&A is persisted into the permanent graph, memify re-embeds
    ///    triplets, and recent graph edges sync back into the session context.
    ///
    /// Net effect: retrieval genuinely learns — down-voted evidence ranks
    /// lower on the next recall, up-voted evidence ranks higher.
    async fn improve_answer(
        &self,
        qa_id: &str,
        helpful: bool,
        note: Option<String>,
    ) -> Result<ImproveSummary, MemoryError> {
        let sm = self.session_manager.clone().ok_or_else(|| {
            MemoryError::Storage("session support is required for answer feedback".to_string())
        })?;

        let op = trace::begin_op(format!(
            "Improve · answer rated {}",
            if helpful { "helpful" } else { "not helpful" }
        ));

        let score = if helpful { 5 } else { 1 };
        sm.add_feedback(Some(APP_SESSION), None, qa_id, note.as_deref(), Some(score))
            .await
            .map_err(|e| MemoryError::Storage(format!("feedback recording failed: {e}")))?;
        trace::stage(
            "session feedback",
            format!("score {score}/5 attached to Q&A entry {qa_id}"),
        );

        trace::stage(
            "improve() pipeline",
            "apply feedback weights to graph → persist Q&A → memify re-embed → sync session context",
        );
        let result = improve(ImproveParams {
            dataset_name: self.dataset_name.clone(),
            session_ids: Some(vec![APP_SESSION.to_string()]),
            node_name: None,
            owner_id: self.owner_id,
            tenant_id: None,
            feedback_alpha: 0.3,
            extraction_tasks: None,
            enrichment_tasks: None,
            data: None,
            build_global_context_index: false,
            run_in_background: false,
            llm: self.llm.clone(),
            storage: self.storage.clone(),
            graph_db: self.graph_db.clone(),
            vector_db: self.vector_db.clone(),
            embedding_engine: self.embedding_engine.clone(),
            ontology_resolver: self.ontology_resolver.clone(),
            db: self.db.clone(),
            session_store: self.session_store.clone(),
            session_manager: self.session_manager.clone(),
            add_pipeline: Some(self.add_pipeline.as_ref()),
            checkpoint_store: self.checkpoint_store.clone(),
            cognify_config: &self.cognify_config,
        })
        .await
        .map_err(|e| MemoryError::Storage(format!("improve failed: {e}")))?;

        op.finish(format!(
            "{} feedback update(s) applied to graph weights · {} session(s) persisted · {} edge(s) synced",
            result.feedback_entries_applied, result.sessions_persisted, result.edges_synced,
        ));

        Ok(ImproveSummary {
            feedback_applied: result.feedback_entries_applied as u32,
            sessions_persisted: result.sessions_persisted as u32,
            edges_synced: result.edges_synced as u32,
        })
    }
}
