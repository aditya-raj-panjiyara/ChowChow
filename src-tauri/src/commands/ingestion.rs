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

/// Queue a file for ingestion into the knowledge graph.
///
/// Returns as soon as the job record exists — extraction runs detached and
/// reports progress through `get_ingestion_status`, which the Ingestion tab
/// polls. Awaiting the pipeline here would hold the frontend's promise open
/// for the entire LLM extraction (minutes on a large source), which the user
/// cannot tell apart from a frozen app.
///
/// Once extraction succeeds, the Drift Sentinel cross-examines the new content
/// against prior beliefs — contradictions land in the Command Center as alerts
/// with suggested corrections.
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
    let job = service.create_job(&path, source).await?;

    let engine = state.memory();
    let db = state.db.clone();
    let gate = state.ingest_gate();
    let job_id = job.id.clone();
    let scan_path = path.clone();
    tauri::async_runtime::spawn(async move {
        let service = IngestionService::new(engine.clone(), db.clone());

        // One extraction at a time — cognee rejects concurrent cognify runs
        // against the same dataset. Waiting jobs stay 'queued', which is
        // exactly what the Ingestion tab already renders.
        let outcome = {
            let _permit = gate.lock().await;
            service.run_job(&job_id, &scan_path, source).await
        };

        if let Err(e) = outcome {
            // Already recorded on the job row; the log is for the developer.
            eprintln!("[ingest] {scan_path}: {e}");
            return;
        }

        // Drift Sentinel. Only the head of the file is compared — detect_drift
        // itself takes just the first 1800 characters, so pulling a 40 MB
        // export into memory to feed it would be pure waste.
        let content = match read_head(&scan_path, SENTINEL_SCAN_BYTES).await {
            Some(c) if !c.trim().is_empty() => c,
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

/// Run one ingestion to completion under the process-wide extraction gate.
///
/// For callers that need the finished job rather than a queued one (the Google
/// Workspace sync). Taking the gate is not optional: cognee rejects a second
/// concurrent cognify run against the same dataset, so an un-gated ingest here
/// would fail whenever a dropped file happened to be extracting.
pub async fn ingest_gated(
    service: &IngestionService,
    gate: &tokio::sync::Mutex<()>,
    path: &str,
    source: SourceType,
) -> Result<IngestionJob, String> {
    let _permit = gate.lock().await;
    service.ingest_file(path, source).await
}

/// How much of a source the Drift Sentinel reads. Comfortably more than the
/// 1800 characters `detect_drift` excerpts, even for multi-byte text.
const SENTINEL_SCAN_BYTES: u64 = 64 * 1024;

/// Read up to `limit` bytes from the front of a file as UTF-8, trimming any
/// partial multi-byte character left at the cut.
async fn read_head(path: &str, limit: u64) -> Option<String> {
    use tokio::io::AsyncReadExt;

    let file = tokio::fs::File::open(path).await.ok()?;
    let mut buf = Vec::with_capacity(limit as usize);
    file.take(limit).read_to_end(&mut buf).await.ok()?;

    match String::from_utf8(buf) {
        Ok(s) => Some(s),
        // A truncated multi-byte character at the boundary is expected; keep
        // everything up to it.
        Err(e) => {
            let valid = e.utf8_error().valid_up_to();
            let mut bytes = e.into_bytes();
            bytes.truncate(valid);
            String::from_utf8(bytes).ok()
        }
    }
}

/// List all ingestion jobs, most recent first.
#[tauri::command]
pub async fn get_ingestion_status(
    state: State<'_, AppState>,
) -> Result<Vec<IngestionJob>, String> {
    let service = IngestionService::new(state.memory(), state.db.clone());
    service.list_jobs().await
}
