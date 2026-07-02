//! Query Service — handles natural-language questions against the knowledge graph.
//!
//! Implements the "Deep Relational Questioning" operational expectation:
//! delegates to `MemoryEngine::query()`, which returns a `QueryResult` with
//! `reasoning_path` populated — enabling the Query tab's "show reasoning path"
//! requirement at the data layer.

use memory_engine::{MemoryEngine, QueryResult};
use std::sync::Arc;

/// Handles natural-language queries against the memory engine.
pub struct QueryService {
    engine: Arc<dyn MemoryEngine>,
}

impl QueryService {
    pub fn new(engine: Arc<dyn MemoryEngine>) -> Self {
        Self { engine }
    }

    /// Ask a natural-language question. Returns answer + reasoning path + confidence.
    pub async fn ask(&self, question: &str) -> Result<QueryResult, String> {
        self.engine
            .query(question)
            .await
            .map_err(|e| e.to_string())
    }
}
