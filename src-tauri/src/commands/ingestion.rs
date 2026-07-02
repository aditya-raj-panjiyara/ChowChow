//! Ingestion commands — file ingestion and job status.
//!
//! Frontend calls:
//! - `invoke('ingest_file', { path, sourceType })`
//! - `invoke('get_ingestion_status')`

use crate::state::AppState;
use domain::alert_service::AlertService;
use domain::ingestion_service::{IngestionJob, IngestionService};
use memory_engine::SourceType;
use tauri::State;

/// Ingest a file into the knowledge graph.
///
/// Creates a job record, runs extraction, and returns the completed job.
/// After a successful ingest, the Drift Sentinel cross-examines the new
/// content against prior beliefs in the background — contradictions land
/// in the Command Center as alerts with suggested corrections.
#[tauri::command]
pub async fn ingest_file(
    path: String,
    source_type: String,
    state: State<'_, AppState>,
) -> Result<IngestionJob, String> {
    let source: SourceType = source_type
        .parse()
        .map_err(|e: String| e)?;

    let service = IngestionService::new(state.memory(), state.db.clone());
    let job = service.ingest_file(&path, source).await?;

    // Drift Sentinel — background pass, never blocks the ingest response.
    let engine = state.memory();
    let db = state.db.clone();
    let scan_path = path.clone();
    tauri::async_runtime::spawn(async move {
        let content = match tokio::fs::read_to_string(&scan_path).await {
            Ok(c) if !c.trim().is_empty() => c,
            _ => return,
        };
        match engine.detect_drift(&content).await {
            Ok(findings) => {
                if findings.is_empty() {
                    eprintln!("[sentinel] {scan_path}: no drift detected");
                    return;
                }
                let alerts = AlertService::new(db);
                for finding in &findings {
                    if let Err(e) = alerts.record_drift_finding(finding).await {
                        eprintln!("[sentinel] failed to record alert: {e}");
                    }
                }
                eprintln!("[sentinel] {scan_path}: {} drift alert(s) raised", findings.len());
            }
            Err(e) => eprintln!("[sentinel] drift scan failed (non-fatal): {e}"),
        }
    });

    Ok(job)
}

/// List all ingestion jobs, most recent first.
#[tauri::command]
pub async fn get_ingestion_status(
    state: State<'_, AppState>,
) -> Result<Vec<IngestionJob>, String> {
    let service = IngestionService::new(state.memory(), state.db.clone());
    service.list_jobs().await
}
