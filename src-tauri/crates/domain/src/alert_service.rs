//! Alert Service — manages Command Center alerts.
//!
//! Surfaces risk/stability signals to the user. Reads from and writes to the
//! `alerts` table. In the future, alerts can be auto-generated from ingestion
//! results (e.g., a new single-source dependency detected).

use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;
use uuid::Uuid;

/// An alert as stored in the `alerts` table.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Alert {
    pub id: String,
    pub severity: String,
    pub entity_id: Option<String>,
    pub description: String,
    pub created_at: String,
}

/// Alert severity levels matching the Command Center UI.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub enum AlertSeverity {
    Stable,
    Elevated,
    Critical,
}

impl std::fmt::Display for AlertSeverity {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            AlertSeverity::Stable => write!(f, "stable"),
            AlertSeverity::Elevated => write!(f, "elevated"),
            AlertSeverity::Critical => write!(f, "critical"),
        }
    }
}

/// Manages Command Center alerts — creation, listing, filtering.
pub struct AlertService {
    db: SqlitePool,
}

impl AlertService {
    pub fn new(db: SqlitePool) -> Self {
        Self { db }
    }

    /// Create a new alert.
    pub async fn create_alert(
        &self,
        severity: AlertSeverity,
        entity_id: Option<&str>,
        description: &str,
    ) -> Result<Alert, String> {
        let id = Uuid::new_v4().to_string();
        let now = chrono::Utc::now().to_rfc3339();

        sqlx::query(
            "INSERT INTO alerts (id, severity, entity_id, description, created_at) \
             VALUES (?, ?, ?, ?, ?)",
        )
        .bind(&id)
        .bind(severity.to_string())
        .bind(entity_id)
        .bind(description)
        .bind(&now)
        .execute(&self.db)
        .await
        .map_err(|e| format!("failed to create alert: {e}"))?;

        Ok(Alert {
            id,
            severity: severity.to_string(),
            entity_id: entity_id.map(|s| s.to_string()),
            description: description.to_string(),
            created_at: now,
        })
    }

    /// List all alerts, most recent first.
    pub async fn list_alerts(&self) -> Result<Vec<Alert>, String> {
        let rows: Vec<(String, String, Option<String>, String, String)> = sqlx::query_as(
            "SELECT id, severity, entity_id, description, created_at \
             FROM alerts ORDER BY created_at DESC",
        )
        .fetch_all(&self.db)
        .await
        .map_err(|e| format!("failed to list alerts: {e}"))?;

        Ok(rows
            .into_iter()
            .map(|(id, severity, entity_id, description, created_at)| Alert {
                id,
                severity,
                entity_id,
                description,
                created_at,
            })
            .collect())
    }

    /// List alerts filtered by severity.
    pub async fn list_by_severity(&self, severity: AlertSeverity) -> Result<Vec<Alert>, String> {
        let rows: Vec<(String, String, Option<String>, String, String)> = sqlx::query_as(
            "SELECT id, severity, entity_id, description, created_at \
             FROM alerts WHERE severity = ? ORDER BY created_at DESC",
        )
        .bind(severity.to_string())
        .fetch_all(&self.db)
        .await
        .map_err(|e| format!("failed to list alerts by severity: {e}"))?;

        Ok(rows
            .into_iter()
            .map(|(id, severity, entity_id, description, created_at)| Alert {
                id,
                severity,
                entity_id,
                description,
                created_at,
            })
            .collect())
    }
}
