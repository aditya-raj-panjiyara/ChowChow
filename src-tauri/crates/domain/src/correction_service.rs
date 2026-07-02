//! Correction Service — two-phase user correction flow.
//!
//! Implements the "Dynamic Learning Loops" operational expectation:
//! 1. `submit_correction()` — records the intent (status: pending), returns for UI confirmation
//! 2. `confirm_correction()` — applies via `MemoryEngine::apply_correction()`, updates log
//!
//! The Corrections Log tab reads from the `correction_log` table.

use memory_engine::{CorrectionIntent, CorrectionResult, MemoryEngine};
use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;
use std::sync::Arc;
use uuid::Uuid;

/// A correction log entry as stored in the `correction_log` table.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CorrectionEntry {
    pub id: String,
    pub raw_text: String,
    pub author: String,
    pub status: String,
    pub audit_node_id: Option<String>,
    pub created_at: String,
}

/// Two-phase correction flow: submit (pending) → confirm (committed).
pub struct CorrectionService {
    engine: Arc<dyn MemoryEngine>,
    db: SqlitePool,
}

impl CorrectionService {
    pub fn new(engine: Arc<dyn MemoryEngine>, db: SqlitePool) -> Self {
        Self { engine, db }
    }

    /// Phase 1: Record the correction intent as pending.
    /// The frontend should display this for user confirmation before calling `confirm`.
    pub async fn submit(
        &self,
        raw_text: &str,
        author: &str,
    ) -> Result<CorrectionEntry, String> {
        let id = Uuid::new_v4().to_string();
        let now = chrono::Utc::now().to_rfc3339();

        sqlx::query(
            "INSERT INTO correction_log (id, raw_text, author, status, created_at) \
             VALUES (?, ?, ?, 'pending', ?)",
        )
        .bind(&id)
        .bind(raw_text)
        .bind(author)
        .bind(&now)
        .execute(&self.db)
        .await
        .map_err(|e| format!("failed to create correction entry: {e}"))?;

        Ok(CorrectionEntry {
            id,
            raw_text: raw_text.to_string(),
            author: author.to_string(),
            status: "pending".to_string(),
            audit_node_id: None,
            created_at: now,
        })
    }

    /// Phase 2: Apply the correction to the knowledge graph.
    /// Only call this after the user has confirmed the intent in the UI.
    pub async fn confirm(&self, correction_id: &str) -> Result<CorrectionResult, String> {
        // Fetch the pending correction
        let row: Option<(String, String, String, String)> = sqlx::query_as(
            "SELECT id, raw_text, author, status FROM correction_log WHERE id = ?",
        )
        .bind(correction_id)
        .fetch_optional(&self.db)
        .await
        .map_err(|e| format!("failed to fetch correction: {e}"))?;

        let (id, raw_text, author, status) = row
            .ok_or_else(|| format!("correction not found: {correction_id}"))?;

        if status != "pending" {
            return Err(format!(
                "correction {id} is not pending (current status: {status})"
            ));
        }

        // Apply via the memory engine
        let intent = CorrectionIntent {
            raw_text: raw_text.clone(),
            author: author.clone(),
        };

        let result = self
            .engine
            .apply_correction(intent)
            .await
            .map_err(|e| e.to_string())?;

        // Update the correction log
        sqlx::query(
            "UPDATE correction_log SET status = 'committed', audit_node_id = ? WHERE id = ?",
        )
        .bind(&result.audit_node_id)
        .bind(&id)
        .execute(&self.db)
        .await
        .map_err(|e| format!("failed to update correction status: {e}"))?;

        Ok(result)
    }

    /// List all corrections, most recent first.
    pub async fn list(&self) -> Result<Vec<CorrectionEntry>, String> {
        let rows: Vec<(String, String, String, String, Option<String>, String)> =
            sqlx::query_as(
                "SELECT id, raw_text, author, status, audit_node_id, created_at \
                 FROM correction_log ORDER BY created_at DESC",
            )
            .fetch_all(&self.db)
            .await
            .map_err(|e| format!("failed to list corrections: {e}"))?;

        Ok(rows
            .into_iter()
            .map(|(id, raw_text, author, status, audit_node_id, created_at)| {
                CorrectionEntry {
                    id,
                    raw_text,
                    author,
                    status,
                    audit_node_id,
                    created_at,
                }
            })
            .collect())
    }
}
