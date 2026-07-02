//! Ingestion Service — orchestrates file ingestion through the memory engine.
//!
//! Implements the "Autonomous Ingestion" operational expectation:
//! 1. Creates an `ingestion_jobs` record (status: queued)
//! 2. Calls `MemoryEngine::ingest_document()`
//! 3. Updates the job record with results (status: complete/failed)
//! 4. Returns the job summary to the caller
//!
//! The Ingestion tab in the frontend polls/subscribes to `ingestion_jobs`
//! via the command layer.

use memory_engine::{MemoryEngine, SourceType};
use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;
use std::sync::Arc;
use uuid::Uuid;

/// An ingestion job record as stored in the `ingestion_jobs` table.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct IngestionJob {
    pub id: String,
    pub file_path: String,
    pub source_type: String,
    pub status: String,
    pub entities_extracted: Option<i64>,
    pub relationships_extracted: Option<i64>,
    pub error_message: Option<String>,
    pub created_at: String,
    pub completed_at: Option<String>,
}

/// Orchestrates ingestion: manages job lifecycle + delegates extraction to the engine.
pub struct IngestionService {
    engine: Arc<dyn MemoryEngine>,
    db: SqlitePool,
}

impl IngestionService {
    pub fn new(engine: Arc<dyn MemoryEngine>, db: SqlitePool) -> Self {
        Self { engine, db }
    }

    /// Ingest a file: create job record → run engine → update record.
    pub async fn ingest_file(
        &self,
        file_path: &str,
        source_type: SourceType,
    ) -> Result<IngestionJob, String> {
        let job_id = Uuid::new_v4().to_string();
        let now = chrono::Utc::now().to_rfc3339();

        // 1. Create job record (status: queued)
        sqlx::query(
            "INSERT INTO ingestion_jobs (id, file_path, source_type, status, created_at) \
             VALUES (?, ?, ?, 'queued', ?)",
        )
        .bind(&job_id)
        .bind(file_path)
        .bind(source_type.to_string())
        .bind(&now)
        .execute(&self.db)
        .await
        .map_err(|e| format!("failed to create job record: {e}"))?;

        // 2. Update to processing
        sqlx::query("UPDATE ingestion_jobs SET status = 'processing' WHERE id = ?")
            .bind(&job_id)
            .execute(&self.db)
            .await
            .map_err(|e| format!("failed to update job status: {e}"))?;

        // 3. Run the engine
        let result = self.engine.ingest_document(file_path, source_type).await;
        let completed_at = chrono::Utc::now().to_rfc3339();

        match result {
            Ok(summary) => {
                // 4a. Success — update with results
                sqlx::query(
                    "UPDATE ingestion_jobs SET status = 'complete', \
                     entities_extracted = ?, relationships_extracted = ?, \
                     completed_at = ? WHERE id = ?",
                )
                .bind(summary.entities_extracted as i64)
                .bind(summary.relationships_extracted as i64)
                .bind(&completed_at)
                .bind(&job_id)
                .execute(&self.db)
                .await
                .map_err(|e| format!("failed to update job on success: {e}"))?;

                Ok(IngestionJob {
                    id: job_id,
                    file_path: file_path.to_string(),
                    source_type: "complete".to_string(),
                    status: "complete".to_string(),
                    entities_extracted: Some(summary.entities_extracted as i64),
                    relationships_extracted: Some(summary.relationships_extracted as i64),
                    error_message: None,
                    created_at: now,
                    completed_at: Some(completed_at),
                })
            }
            Err(e) => {
                // 4b. Failure — record the error
                let err_msg = e.to_string();
                sqlx::query(
                    "UPDATE ingestion_jobs SET status = 'failed', \
                     error_message = ?, completed_at = ? WHERE id = ?",
                )
                .bind(&err_msg)
                .bind(&completed_at)
                .bind(&job_id)
                .execute(&self.db)
                .await
                .map_err(|e| format!("failed to update job on failure: {e}"))?;

                Err(format!("ingestion failed: {err_msg}"))
            }
        }
    }

    /// List all ingestion jobs, most recent first.
    pub async fn list_jobs(&self) -> Result<Vec<IngestionJob>, String> {
        let rows: Vec<(
            String,
            String,
            String,
            String,
            Option<i64>,
            Option<i64>,
            Option<String>,
            String,
            Option<String>,
        )> = sqlx::query_as(
            "SELECT id, file_path, source_type, status, \
             entities_extracted, relationships_extracted, error_message, \
             created_at, completed_at \
             FROM ingestion_jobs ORDER BY created_at DESC",
        )
        .fetch_all(&self.db)
        .await
        .map_err(|e| format!("failed to list jobs: {e}"))?;

        Ok(rows
            .into_iter()
            .map(
                |(
                    id,
                    file_path,
                    source_type,
                    status,
                    entities,
                    relationships,
                    error,
                    created,
                    completed,
                )| {
                    IngestionJob {
                        id,
                        file_path,
                        source_type,
                        status,
                        entities_extracted: entities,
                        relationships_extracted: relationships,
                        error_message: error,
                        created_at: created,
                        completed_at: completed,
                    }
                },
            )
            .collect())
    }
}
