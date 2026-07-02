//! Query commands — natural-language questions against the knowledge graph.
//!
//! Frontend calls: `invoke('ask_question', { question })`

use crate::state::AppState;
use domain::query_service::QueryService;
use memory_engine::QueryResult;
use tauri::State;

/// Ask a natural-language question. Returns answer + reasoning path + confidence.
#[tauri::command]
pub async fn ask_question(
    question: String,
    state: State<'_, AppState>,
) -> Result<QueryResult, String> {
    let service = QueryService::new(state.memory.clone());
    service.ask(&question).await
}
