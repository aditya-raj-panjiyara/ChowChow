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
use cognee_lib::prelude::{
    remember, recall, improve,
    RememberResult, RecallResult, ImproveParams,
};

use cognee_lib::embedding::EmbeddingEngine;
use cognee_lib::graph::GraphDBTrait;
use cognee_lib::llm::Llm;
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
        // Read file content to pass as DataInput::Text
        let content = tokio::fs::read_to_string(path)
            .await
            .map_err(|e| MemoryError::IngestionFailed(format!("cannot read file: {e}")))?;

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

        Ok(IngestSummary {
            entities_extracted: entities,
            relationships_extracted: relationships,
        })
    }

    /// Maps to `cognee_lib::api::recall()` — auto-routed search.
    ///
    /// Returns the search result text plus the graph traversal path
    /// (from `SearchResponse.graphs`) when available.
    async fn query(&self, question: &str) -> Result<QueryResult, MemoryError> {
        let result: RecallResult = recall(
            question,
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

        // Derive confidence from result quality
        let confidence = if result.items.is_empty() {
            ConfidenceLevel::Low
        } else if result.items.len() >= 3 {
            ConfidenceLevel::High
        } else {
            ConfidenceLevel::Partial
        };

        Ok(QueryResult {
            answer,
            reasoning_path,
            confidence,
        })
    }

    /// Direct graph read via `GraphDBTrait::get_graph_data()`.
    ///
    /// Returns all nodes and edges in the knowledge graph for the
    /// Graph Explorer visualization.
    async fn get_graph_snapshot(&self) -> Result<GraphSnapshot, MemoryError> {
        let (nodes, edges) = self
            .graph_db
            .get_graph_data()
            .await
            .map_err(|e| MemoryError::Storage(format!("graph snapshot failed: {e}")))?;

        let entities: Vec<MemoryEntity> = nodes
            .into_iter()
            .map(|(id, props)| {
                let entity_type = props
                    .get(&Cow::Borrowed("type"))
                    .and_then(|v| v.as_str())
                    .unwrap_or("Unknown")
                    .to_string();

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

                MemoryEntity {
                    id,
                    entity_type,
                    name,
                    attributes,
                }
            })
            .collect();

        let relationships: Vec<MemoryRelationship> = edges
            .into_iter()
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

    /// Maps to `cognee_lib::api::improve()` — feedback-driven graph refinement.
    ///
    /// `ImproveParams` is a structured input (dataset_name, node_name,
    /// feedback_alpha, session_ids) — not natural-language text.
    async fn apply_correction(
        &self,
        correction: CorrectionIntent,
    ) -> Result<CorrectionResult, MemoryError> {
        let params = ImproveParams {
            dataset_name: self.dataset_name.clone(),
            session_ids: None,
            node_name: None,
            owner_id: self.owner_id,
            tenant_id: None,
            feedback_alpha: 0.1,
            extraction_tasks: None,
            enrichment_tasks: None,
            data: Some(correction.raw_text),
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
            add_pipeline: None,
            checkpoint_store: self.checkpoint_store.clone(),
            cognify_config: &self.cognify_config,
        };

        let result = improve(params)
            .await
            .map_err(|e| MemoryError::Storage(e.to_string()))?;

        Ok(CorrectionResult {
            edges_created: result.feedback_entries_applied as u32,
            edges_deprecated: 0,
            audit_node_id: Uuid::new_v4().to_string(),
        })
    }
}
