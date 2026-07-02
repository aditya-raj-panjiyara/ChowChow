//! Ingestion commands — file ingestion and job status.
//!
//! Frontend calls:
//! - `invoke('ingest_file', { path, sourceType })`
//! - `invoke('get_ingestion_status')`

use crate::state::AppState;
use domain::ingestion_service::{IngestionJob, IngestionService};
use memory_engine::SourceType;
use tauri::State;

/// Ingest a file into the knowledge graph.
///
/// Creates a job record, runs extraction, and returns the completed job.
#[tauri::command]
pub async fn ingest_file(
    path: String,
    source_type: String,
    state: State<'_, AppState>,
) -> Result<IngestionJob, String> {
    let source: SourceType = source_type
        .parse()
        .map_err(|e: String| e)?;

    let service = IngestionService::new(state.memory.clone(), state.db.clone());
    service.ingest_file(&path, source).await
}

/// List all ingestion jobs, most recent first.
#[tauri::command]
pub async fn get_ingestion_status(
    state: State<'_, AppState>,
) -> Result<Vec<IngestionJob>, String> {
    let service = IngestionService::new(state.memory.clone(), state.db.clone());
    service.list_jobs().await
}
