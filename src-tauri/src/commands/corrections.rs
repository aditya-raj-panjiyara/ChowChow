//! Correction commands — two-phase correction flow.
//!
//! Frontend calls:
//! - `invoke('submit_correction', { rawText, author })` — phase 1 (pending)
//! - `invoke('confirm_correction', { correctionId })` — phase 2 (committed)
//! - `invoke('list_corrections')` — for the Corrections Log tab

use crate::state::AppState;
use domain::correction_service::{CorrectionEntry, CorrectionService};
use memory_engine::CorrectionResult;
use tauri::State;

/// Submit a correction intent (phase 1 — creates a pending record).
///
/// The frontend should display this for user confirmation before calling `confirm`.
#[tauri::command]
pub async fn submit_correction(
    raw_text: String,
    author: String,
    state: State<'_, AppState>,
) -> Result<CorrectionEntry, String> {
    let service = CorrectionService::new(state.memory(), state.db.clone());
    service.submit(&raw_text, &author).await
}

/// Confirm and apply a pending correction (phase 2 — writes to graph).
#[tauri::command]
pub async fn confirm_correction(
    correction_id: String,
    state: State<'_, AppState>,
) -> Result<CorrectionResult, String> {
    let service = CorrectionService::new(state.memory(), state.db.clone());
    service.confirm(&correction_id).await
}

/// Reject a pending correction (kept in the log, never applied).
#[tauri::command]
pub async fn reject_correction(
    correction_id: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let service = CorrectionService::new(state.memory(), state.db.clone());
    service.reject(&correction_id).await
}

/// List all corrections, most recent first.
#[tauri::command]
pub async fn list_corrections(
    state: State<'_, AppState>,
) -> Result<Vec<CorrectionEntry>, String> {
    let service = CorrectionService::new(state.memory(), state.db.clone());
    service.list().await
}
