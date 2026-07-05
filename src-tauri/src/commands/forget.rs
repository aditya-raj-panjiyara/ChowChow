//! Forget command — the "right to be forgotten".
//!
//! Frontend calls: `invoke('forget_all_memory')` (Settings → Danger Zone).
//!
//! Two layers are wiped:
//! 1. cognee memory via `MemoryEngine::forget_all()` — a cascading hard
//!    delete across relational DB, graph DB, vector DB, and file storage.
//! 2. This app's own SQLite tables (jobs, alerts, corrections, custom graph
//!    edits), so the UI starts genuinely clean.

use crate::state::AppState;
use memory_engine::ForgetSummary;
use tauri::State;

#[tauri::command]
pub async fn forget_all_memory(state: State<'_, AppState>) -> Result<ForgetSummary, String> {
    // 1. cognee forget — the real memory erase.
    let summary = state.memory().forget_all().await.map_err(|e| e.to_string())?;

    // 2. App-level bookkeeping tables.
    for table in [
        "ingestion_jobs",
        "alerts",
        "correction_log",
        "custom_entities",
        "custom_relationships",
        "deleted_entities",
        "deleted_relationships",
        "stub_entities",
        "stub_relationships",
    ] {
        sqlx::query(&format!("DELETE FROM {table}"))
            .execute(&state.db)
            .await
            .map_err(|e| format!("failed to clear {table}: {e}"))?;
    }

    Ok(summary)
}
