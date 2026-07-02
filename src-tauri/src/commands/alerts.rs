//! Alert commands — Command Center's live feed.
//!
//! Frontend calls: `invoke('list_alerts')`

use crate::state::AppState;
use domain::alert_service::{Alert, AlertService};
use tauri::State;

/// List all alerts, most recent first. Includes Drift Sentinel findings
/// with their ready-to-apply suggested corrections.
#[tauri::command]
pub async fn list_alerts(state: State<'_, AppState>) -> Result<Vec<Alert>, String> {
    AlertService::new(state.db.clone()).list_alerts().await
}
