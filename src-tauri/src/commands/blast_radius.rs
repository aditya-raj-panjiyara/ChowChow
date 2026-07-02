//! Blast radius commands — disruption cascade simulation.
//!
//! Frontend calls: `invoke('simulate_blast_radius', { entityId, durationDays })`

use crate::state::AppState;
use domain::blast_radius_service::{BlastRadiusResult, BlastRadiusService};
use tauri::State;

/// Simulate the blast radius of a disruption at `entity_id` lasting
/// `duration_days`. Returns hop-ordered affected entities, financial
/// exposure, and a prioritized mitigation roadmap.
#[tauri::command]
pub async fn simulate_blast_radius(
    entity_id: String,
    duration_days: u32,
    state: State<'_, AppState>,
) -> Result<BlastRadiusResult, String> {
    let service = BlastRadiusService::new(state.memory.clone());
    service.simulate(&entity_id, duration_days).await
}
