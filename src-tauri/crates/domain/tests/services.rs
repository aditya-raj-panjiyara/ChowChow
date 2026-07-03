//! Domain service tests — fast, no LLM, in-memory SQLite.
//!
//! Run with: `cargo test -p domain`
//!
//! Covers the correction lifecycle (submit → confirm / reject), the alert
//! service including Drift Sentinel findings, and ingestion job bookkeeping —
//! all against a mock memory engine, so these run in milliseconds.

use async_trait::async_trait;
use domain::alert_service::{AlertService, AlertSeverity};
use domain::correction_service::CorrectionService;
use domain::ingestion_service::IngestionService;
use memory_engine::*;
use sqlx::sqlite::SqlitePoolOptions;
use sqlx::SqlitePool;
use std::sync::Arc;

/// Mock engine — canned responses, optional failure mode.
struct MockEngine {
    fail_ingest: bool,
}

#[async_trait]
impl MemoryEngine for MockEngine {
    async fn ingest_document(
        &self,
        _path: &str,
        _source_type: SourceType,
    ) -> Result<IngestSummary, MemoryError> {
        if self.fail_ingest {
            return Err(MemoryError::IngestionFailed("mock failure".into()));
        }
        Ok(IngestSummary { entities_extracted: 3, relationships_extracted: 2 })
    }

    async fn query(&self, _question: &str) -> Result<QueryResult, MemoryError> {
        Ok(QueryResult {
            answer: "mock answer".into(),
            reasoning_path: vec![],
            confidence: ConfidenceLevel::Partial,
        })
    }

    async fn get_graph_snapshot(&self) -> Result<GraphSnapshot, MemoryError> {
        Ok(GraphSnapshot { entities: vec![], relationships: vec![] })
    }

    async fn apply_correction(
        &self,
        _correction: CorrectionIntent,
    ) -> Result<CorrectionResult, MemoryError> {
        Ok(CorrectionResult {
            edges_created: 1,
            edges_deprecated: 1,
            audit_node_id: "audit-mock".into(),
        })
    }
}

/// One shared in-memory database per test (max_connections(1) keeps every
/// query on the same in-memory instance).
async fn test_db() -> SqlitePool {
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect("sqlite::memory:")
        .await
        .expect("in-memory sqlite");
    memory_sqlite::SqliteStubEngine::run_migrations(&pool)
        .await
        .expect("migrations");
    pool
}

fn engine(fail_ingest: bool) -> Arc<dyn MemoryEngine> {
    Arc::new(MockEngine { fail_ingest })
}

// ─── Correction lifecycle ────────────────────────────────────────────────────

#[tokio::test]
async fn correction_two_phase_flow_commits() {
    let db = test_db().await;
    let service = CorrectionService::new(engine(false), db);

    let entry = service.submit("Black Doug no longer ships to Kingsley", "Risk Officer").await.unwrap();
    assert_eq!(entry.status, "pending");

    let result = service.confirm(&entry.id).await.unwrap();
    assert_eq!(result.audit_node_id, "audit-mock");
    assert_eq!(result.edges_deprecated, 1);

    let list = service.list().await.unwrap();
    assert_eq!(list.len(), 1);
    assert_eq!(list[0].status, "committed");
    assert_eq!(list[0].audit_node_id.as_deref(), Some("audit-mock"));
}

#[tokio::test]
async fn correction_cannot_be_confirmed_twice() {
    let db = test_db().await;
    let service = CorrectionService::new(engine(false), db);

    let entry = service.submit("some correction", "Officer").await.unwrap();
    service.confirm(&entry.id).await.unwrap();

    let second = service.confirm(&entry.id).await;
    assert!(second.is_err(), "confirming a committed correction must fail");
    assert!(second.unwrap_err().contains("not pending"));
}

#[tokio::test]
async fn correction_reject_keeps_audit_trail_and_blocks_apply() {
    let db = test_db().await;
    let service = CorrectionService::new(engine(false), db);

    let entry = service.submit("bad correction", "Officer").await.unwrap();
    service.reject(&entry.id).await.unwrap();

    let list = service.list().await.unwrap();
    assert_eq!(list[0].status, "rejected", "rejected corrections stay in the log");

    assert!(service.confirm(&entry.id).await.is_err(), "rejected corrections cannot be applied");
    assert!(service.reject(&entry.id).await.is_err(), "cannot reject twice");
}

#[tokio::test]
async fn confirm_unknown_correction_errors() {
    let db = test_db().await;
    let service = CorrectionService::new(engine(false), db);
    assert!(service.confirm("nope").await.is_err());
}

// ─── Alerts / Drift Sentinel ─────────────────────────────────────────────────

#[tokio::test]
async fn drift_finding_becomes_alert_with_suggested_correction() {
    let db = test_db().await;
    let alerts = AlertService::new(db);

    let finding = DriftFinding {
        severity: "critical".into(),
        entity_name: Some("Black Doug".into()),
        prior_belief: "Black Doug distributes to Kingsley".into(),
        new_claim: "Fat Jesus Logistics handles Kingsley".into(),
        suggested_correction: "Update the Kingsley distributor to Fat Jesus Logistics".into(),
    };
    alerts.record_drift_finding(&finding).await.unwrap();

    let list = alerts.list_alerts().await.unwrap();
    assert_eq!(list.len(), 1);
    assert_eq!(list[0].severity, "critical");
    assert_eq!(list[0].entity_id.as_deref(), Some("Black Doug"));
    assert!(list[0].description.contains("State drift detected"));
    assert!(list[0].description.contains("Fat Jesus Logistics"));
    assert_eq!(
        list[0].suggested_correction.as_deref(),
        Some("Update the Kingsley distributor to Fat Jesus Logistics"),
    );
}

#[tokio::test]
async fn non_critical_drift_maps_to_elevated() {
    let db = test_db().await;
    let alerts = AlertService::new(db);

    let finding = DriftFinding {
        severity: "weird-value".into(),
        entity_name: None,
        prior_belief: "a".into(),
        new_claim: "b".into(),
        suggested_correction: "c".into(),
    };
    alerts.record_drift_finding(&finding).await.unwrap();
    assert_eq!(alerts.list_alerts().await.unwrap()[0].severity, "elevated");
}

#[tokio::test]
async fn alerts_list_newest_first() {
    let db = test_db().await;
    let alerts = AlertService::new(db);
    alerts.create_alert(AlertSeverity::Stable, None, "first", None).await.unwrap();
    alerts.create_alert(AlertSeverity::Critical, None, "second", None).await.unwrap();

    let list = alerts.list_alerts().await.unwrap();
    assert_eq!(list.len(), 2);
    assert_eq!(list[0].description, "second");
}

// ─── Ingestion jobs ──────────────────────────────────────────────────────────

#[tokio::test]
async fn ingestion_success_records_complete_job() {
    let db = test_db().await;
    let service = IngestionService::new(engine(false), db);

    let job = service.ingest_file("/tmp/doc.pdf", SourceType::Pdf).await.unwrap();
    assert_eq!(job.status, "complete");
    assert_eq!(job.entities_extracted, Some(3));
    assert_eq!(job.relationships_extracted, Some(2));

    let jobs = service.list_jobs().await.unwrap();
    assert_eq!(jobs.len(), 1);
    assert_eq!(jobs[0].status, "complete");
    assert!(jobs[0].completed_at.is_some());
}

#[tokio::test]
async fn ingestion_failure_records_failed_job_with_error() {
    let db = test_db().await;
    let service = IngestionService::new(engine(true), db);

    assert!(service.ingest_file("/tmp/doc.pdf", SourceType::Erp).await.is_err());

    let jobs = service.list_jobs().await.unwrap();
    assert_eq!(jobs.len(), 1);
    assert_eq!(jobs[0].status, "failed");
    assert!(jobs[0].error_message.as_deref().unwrap_or("").contains("mock failure"));
}

// ─── Engine trait defaults ───────────────────────────────────────────────────

#[tokio::test]
async fn detect_drift_default_is_sentinel_silent() {
    let findings = engine(false).detect_drift("anything").await.unwrap();
    assert!(findings.is_empty(), "engines without semantic memory raise no drift alerts");
}
