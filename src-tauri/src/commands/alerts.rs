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

/// Close an alert: `resolution` is "resolved" (correction applied) or
/// "dismissed" (user waved it off). Alerts linked to a correction resolve
/// automatically on confirm — this command covers manual dismissal.
#[tauri::command]
pub async fn resolve_alert(
    alert_id: String,
    resolution: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    AlertService::new(state.db.clone())
        .resolve_alert(&alert_id, &resolution)
        .await
}
