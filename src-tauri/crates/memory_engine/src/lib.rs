//! # Memory Engine
//!
//! Defines the [`MemoryEngine`] trait — the open-ended boundary that domain
//! services depend on. Today it is fulfilled by a SQLite-backed stub
//! (`memory_sqlite`); later it will be fulfilled by `CogneeMemoryEngine`
//! wrapping cognee-rs. Domain services never call a storage backend directly;
//! they call this trait.

use async_trait::async_trait;
use serde::{Deserialize, Serialize};

// ─── Shared Types ────────────────────────────────────────────────────────────

/// A node in the knowledge graph — supplier, port, material, factory, etc.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct MemoryEntity {
    pub id: String,
    /// E.g. "Supplier", "Port", "Material", "Factory", "Customer"
    pub entity_type: String,
    pub name: String,
    /// Arbitrary key-value attributes stored as JSON.
    pub attributes: serde_json::Value,
}

/// An edge in the knowledge graph — "sources_from", "ships_via", "feeds_into", etc.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct MemoryRelationship {
    pub from_id: String,
    pub to_id: String,
    /// E.g. "sources_from", "ships_via", "feeds_into"
    pub relationship_type: String,
    pub weight: f32,
    pub active: bool,
}

/// Result of a natural-language query against the knowledge graph.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct QueryResult {
    pub answer: String,
    /// The chain of entities traversed to arrive at the answer.
    pub reasoning_path: Vec<MemoryEntity>,
    pub confidence: ConfidenceLevel,
}

/// How much trust the engine has in a query result.
#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
pub enum ConfidenceLevel {
    High,
    Partial,
    Low,
}

/// Classification of an ingested document's origin.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub enum SourceType {
    Erp,
    Email,
    Pdf,
    TradeFeed,
}

impl std::fmt::Display for SourceType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            SourceType::Erp => write!(f, "erp"),
            SourceType::Email => write!(f, "email"),
            SourceType::Pdf => write!(f, "pdf"),
            SourceType::TradeFeed => write!(f, "trade_feed"),
        }
    }
}

impl std::str::FromStr for SourceType {
    type Err = String;
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s.to_lowercase().as_str() {
            "erp" => Ok(SourceType::Erp),
            "email" => Ok(SourceType::Email),
            "pdf" => Ok(SourceType::Pdf),
            "trade_feed" | "tradefeed" => Ok(SourceType::TradeFeed),
            other => Err(format!("unknown source type: {other}")),
        }
    }
}

/// Summary returned after ingesting a document.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct IngestSummary {
    pub entities_extracted: u32,
    pub relationships_extracted: u32,
}

/// Full snapshot of the knowledge graph for the Graph Explorer UI.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct GraphSnapshot {
    pub entities: Vec<MemoryEntity>,
    pub relationships: Vec<MemoryRelationship>,
}

/// A user's correction intent — free-text that the engine interprets and
/// applies to the graph (after confirmation).
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CorrectionIntent {
    pub raw_text: String,
    pub author: String,
}

/// Result of applying a correction to the knowledge graph.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CorrectionResult {
    pub edges_created: u32,
    pub edges_deprecated: u32,
    /// The audit node ID in the graph for traceability.
    pub audit_node_id: String,
}

/// A contradiction between newly ingested content and prior graph beliefs,
/// found by the Drift Sentinel's cross-examination pass.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DriftFinding {
    /// "critical" | "elevated"
    pub severity: String,
    /// The entity at the center of the conflict, if identifiable.
    pub entity_name: Option<String>,
    /// What memory previously believed.
    pub prior_belief: String,
    /// What the new document claims.
    pub new_claim: String,
    /// Ready-to-apply correction text for the two-phase correction flow.
    pub suggested_correction: String,
}

// ─── Error Type ──────────────────────────────────────────────────────────────

#[derive(thiserror::Error, Debug)]
pub enum MemoryError {
    #[error("ingestion failed: {0}")]
    IngestionFailed(String),
    #[error("query failed: {0}")]
    QueryFailed(String),
    #[error("storage error: {0}")]
    Storage(String),
}

// ─── The Trait ───────────────────────────────────────────────────────────────

/// The open-ended boundary. Domain services depend only on this trait.
///
/// - **Today:** fulfilled by [`memory_sqlite::SqliteStubEngine`] (basic
///   keyword extraction, good enough to unblock frontend work).
/// - **Later:** fulfilled by `CogneeMemoryEngine` wrapping cognee-rs
///   (`remember`, `recall`, `improve` / `memify`).
#[async_trait]
pub trait MemoryEngine: Send + Sync {
    /// Ingest a document, extracting entities and relationships into the graph.
    async fn ingest_document(
        &self,
        path: &str,
        source_type: SourceType,
    ) -> Result<IngestSummary, MemoryError>;

    /// Answer a natural-language question using the knowledge graph.
    async fn query(&self, question: &str) -> Result<QueryResult, MemoryError>;

    /// Return a full snapshot of the current knowledge graph.
    async fn get_graph_snapshot(&self) -> Result<GraphSnapshot, MemoryError>;

    /// Apply a user correction to the graph (create/deprecate edges, add audit node).
    async fn apply_correction(
        &self,
        correction: CorrectionIntent,
    ) -> Result<CorrectionResult, MemoryError>;

    /// Cross-examine newly ingested content against prior beliefs and return
    /// contradictions. Engines without semantic memory return no findings —
    /// the default implementation — so the stub stays sentinel-silent.
    async fn detect_drift(&self, _new_content: &str) -> Result<Vec<DriftFinding>, MemoryError> {
        Ok(Vec::new())
    }
}
