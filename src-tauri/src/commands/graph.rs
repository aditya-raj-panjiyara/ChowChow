//! Graph commands — graph snapshot for the Graph Explorer.
//!
//! Frontend calls: `invoke('get_graph_snapshot')`

use crate::state::AppState;
use memory_engine::GraphSnapshot;
use tauri::State;

/// Return a full snapshot of the current knowledge graph.
///
/// This is what the Graph Explorer tab renders — all entities and relationships.
#[tauri::command]
pub async fn get_graph_snapshot(
    state: State<'_, AppState>,
) -> Result<GraphSnapshot, String> {
    state
        .memory()
        .get_graph_snapshot()
        .await
        .map_err(|e| e.to_string())
}
