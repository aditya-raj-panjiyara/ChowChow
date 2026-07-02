//! Alert Service — manages Command Center alerts.
//!
//! Surfaces risk/stability signals to the user. Reads from and writes to the
//! `alerts` table. The Drift Sentinel writes alerts here after every
//! ingestion when new content contradicts prior graph beliefs; those alerts
//! carry a `suggested_correction` ready for the two-phase correction flow.

use memory_engine::DriftFinding;
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
    pub suggested_correction: Option<String>,
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
        suggested_correction: Option<&str>,
    ) -> Result<Alert, String> {
        let id = Uuid::new_v4().to_string();
        let now = chrono::Utc::now().to_rfc3339();

        sqlx::query(
            "INSERT INTO alerts (id, severity, entity_id, description, suggested_correction, created_at) \
             VALUES (?, ?, ?, ?, ?, ?)",
        )
        .bind(&id)
        .bind(severity.to_string())
        .bind(entity_id)
        .bind(description)
        .bind(suggested_correction)
        .bind(&now)
        .execute(&self.db)
        .await
        .map_err(|e| format!("failed to create alert: {e}"))?;

        Ok(Alert {
            id,
            severity: severity.to_string(),
            entity_id: entity_id.map(String::from),
            description: description.to_string(),
            suggested_correction: suggested_correction.map(String::from),
            created_at: now,
        })
    }

    /// Record a Drift Sentinel finding as an alert.
    pub async fn record_drift_finding(&self, finding: &DriftFinding) -> Result<Alert, String> {
        let severity = if finding.severity == "critical" {
            AlertSeverity::Critical
        } else {
            AlertSeverity::Elevated
        };
        let description = format!(
            "State drift detected — memory believed: \"{}\" but new intel says: \"{}\"",
            finding.prior_belief, finding.new_claim
        );
        self.create_alert(
            severity,
            finding.entity_name.as_deref(),
            &description,
            Some(&finding.suggested_correction),
        )
        .await
    }

    /// List all alerts, most recent first.
    pub async fn list_alerts(&self) -> Result<Vec<Alert>, String> {
        let rows: Vec<(String, String, Option<String>, String, Option<String>, String)> =
            sqlx::query_as(
                "SELECT id, severity, entity_id, description, suggested_correction, created_at \
                 FROM alerts ORDER BY created_at DESC",
            )
            .fetch_all(&self.db)
            .await
            .map_err(|e| format!("failed to list alerts: {e}"))?;

        Ok(rows
            .into_iter()
            .map(|(id, severity, entity_id, description, suggested_correction, created_at)| Alert {
                id,
                severity,
                entity_id,
                description,
                suggested_correction,
                created_at,
            })
            .collect())
    }
}
