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
    /// Caveat about how the source was read — e.g. a large table ingested only
    /// up to the row budget. Present on successful jobs, unlike `error_message`.
    #[serde(default)]
    pub notes: Option<String>,
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

    /// Register a file for ingestion and return the job immediately.
    ///
    /// Extraction itself is not started here: entity extraction is an LLM
    /// workload measured in minutes for a sizeable source, and a Tauri command
    /// that awaits it leaves the caller's promise unresolved for that whole
    /// time — indistinguishable from a hang. Callers pair this with
    /// [`Self::run_job`] on a background task and let the UI poll.
    pub async fn create_job(
        &self,
        file_path: &str,
        source_type: SourceType,
    ) -> Result<IngestionJob, String> {
        let job_id = Uuid::new_v4().to_string();
        let now = chrono::Utc::now().to_rfc3339();

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

        Ok(IngestionJob {
            id: job_id,
            file_path: file_path.to_string(),
            source_type: source_type.to_string(),
            status: "queued".to_string(),
            entities_extracted: None,
            relationships_extracted: None,
            error_message: None,
            created_at: now,
            completed_at: None,
            notes: None,
        })
    }

    /// Run extraction for an existing job, updating the record as it goes.
    ///
    /// Safe to run detached — every outcome, including failure, lands in the
    /// job row where the Ingestion tab can see it.
    pub async fn run_job(
        &self,
        job_id: &str,
        file_path: &str,
        source_type: SourceType,
    ) -> Result<(), String> {
        sqlx::query("UPDATE ingestion_jobs SET status = 'processing' WHERE id = ?")
            .bind(job_id)
            .execute(&self.db)
            .await
            .map_err(|e| format!("failed to update job status: {e}"))?;

        let result = self.engine.ingest_document(file_path, source_type).await;
        let completed_at = chrono::Utc::now().to_rfc3339();

        match result {
            Ok(summary) => {
                sqlx::query(
                    "UPDATE ingestion_jobs SET status = 'complete', \
                     entities_extracted = ?, relationships_extracted = ?, \
                     notes = ?, completed_at = ? WHERE id = ?",
                )
                .bind(summary.entities_extracted as i64)
                .bind(summary.relationships_extracted as i64)
                .bind(summary.notes.as_deref())
                .bind(&completed_at)
                .bind(job_id)
                .execute(&self.db)
                .await
                .map_err(|e| format!("failed to update job on success: {e}"))?;

                Ok(())
            }
            Err(e) => {
                let err_msg = e.to_string();
                sqlx::query(
                    "UPDATE ingestion_jobs SET status = 'failed', \
                     error_message = ?, completed_at = ? WHERE id = ?",
                )
                .bind(&err_msg)
                .bind(&completed_at)
                .bind(job_id)
                .execute(&self.db)
                .await
                .map_err(|e| format!("failed to update job on failure: {e}"))?;

                Err(format!("ingestion failed: {err_msg}"))
            }
        }
    }

    /// Create and run a job, awaiting completion.
    ///
    /// Convenient for headless callers and tests. Interactive callers should
    /// prefer [`Self::create_job`] + a detached [`Self::run_job`].
    pub async fn ingest_file(
        &self,
        file_path: &str,
        source_type: SourceType,
    ) -> Result<IngestionJob, String> {
        let job = self.create_job(file_path, source_type).await?;
        self.run_job(&job.id, file_path, source_type).await?;

        self.get_job(&job.id)
            .await?
            .ok_or_else(|| "job record vanished after ingestion".to_string())
    }

    /// Fetch a single job by id.
    pub async fn get_job(&self, job_id: &str) -> Result<Option<IngestionJob>, String> {
        let row: Option<JobRow> = sqlx::query_as(&format!("{JOB_SELECT} WHERE id = ?"))
            .bind(job_id)
            .fetch_optional(&self.db)
            .await
            .map_err(|e| format!("failed to load job: {e}"))?;

        Ok(row.map(Into::into))
    }

    /// List all ingestion jobs, most recent first.
    pub async fn list_jobs(&self) -> Result<Vec<IngestionJob>, String> {
        let rows: Vec<JobRow> = sqlx::query_as(&format!("{JOB_SELECT} ORDER BY created_at DESC"))
            .fetch_all(&self.db)
            .await
            .map_err(|e| format!("failed to list jobs: {e}"))?;

        Ok(rows.into_iter().map(Into::into).collect())
    }
}

/// Column list shared by every job read, so the tuple positions in [`JobRow`]
/// can only ever match one query shape.
const JOB_SELECT: &str = "SELECT id, file_path, source_type, status, \
     entities_extracted, relationships_extracted, error_message, \
     created_at, completed_at, notes FROM ingestion_jobs";

type JobRow = (
    String,
    String,
    String,
    String,
    Option<i64>,
    Option<i64>,
    Option<String>,
    String,
    Option<String>,
    Option<String>,
);

impl From<JobRow> for IngestionJob {
    fn from(row: JobRow) -> Self {
        let (
            id,
            file_path,
            source_type,
            status,
            entities_extracted,
            relationships_extracted,
            error_message,
            created_at,
            completed_at,
            notes,
        ) = row;
        IngestionJob {
            id,
            file_path,
            source_type,
            status,
            entities_extracted,
            relationships_extracted,
            error_message,
            created_at,
            completed_at,
            notes,
        }
    }
}
