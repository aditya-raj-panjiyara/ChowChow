//! Blast radius commands — disruption cascade simulation.
//!
//! Frontend calls: `invoke('simulate_blast_radius', { entityId, durationDays })`

use crate::state::AppState;
use domain::blast_radius_service::{simulate_over_snapshot, BlastRadiusResult};
use tauri::State;

/// Simulate the blast radius of a disruption at `entity_id` lasting
/// `duration_days`. Returns hop-ordered affected entities, financial
/// exposure, and a prioritized mitigation roadmap.
///
/// Runs over the *merged* snapshot (engine graph + manual canvas edits), so
/// links the user drew by hand carry impact and deleted ones don't.
#[tauri::command]
pub async fn simulate_blast_radius(
    entity_id: String,
    duration_days: u32,
    state: State<'_, AppState>,
) -> Result<BlastRadiusResult, String> {
    let snapshot = crate::commands::graph::merged_snapshot(state.inner()).await?;
    simulate_over_snapshot(&snapshot, &entity_id, duration_days)
}
