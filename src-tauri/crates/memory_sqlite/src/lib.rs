//! # SQLite Stub Memory Engine
//!
//! A working-but-crude implementation of [`MemoryEngine`] backed entirely by
//! SQLite. Exists to unblock frontend development before cognee-rs is wired in.
//!
//! **STUB: replace with cognee-rs — see `memory_cognee` crate.**
//!
//! - `ingest_document`: basic regex entity extraction, not real NLP.
//! - `query`: keyword search across entities, returns best-effort with `Low` confidence.
//! - `get_graph_snapshot`: SELECT all from stub tables.
//! - `apply_correction`: creates audit trail entries in stub tables.

use async_trait::async_trait;
use memory_engine::*;
use sqlx::SqlitePool;
use uuid::Uuid;

/// SQLite-backed stub implementation of [`MemoryEngine`].
///
/// Good enough to populate the Ingestion and Graph Explorer tabs for UI work.
/// Do **not** mistake this for real ingestion quality — it is a placeholder.
pub struct SqliteStubEngine {
    pool: SqlitePool,
}

impl SqliteStubEngine {
    /// Create a new stub engine from an existing connection pool.
    /// Migrations should already have been run against this pool.
    pub fn new(pool: SqlitePool) -> Self {
        Self { pool }
    }

    /// Run database migrations. Call once at app startup.
    pub async fn run_migrations(pool: &SqlitePool) -> Result<(), sqlx::Error> {
        sqlx::query(include_str!("../migrations/001_init.sql"))
            .execute(pool)
            .await?;

        // 002 — Drift Sentinel: alerts carry a ready-to-apply correction.
        // SQLite has no ALTER ... IF NOT EXISTS, so guard via table_info.
        let has_column: Option<(i64,)> = sqlx::query_as(
            "SELECT 1 FROM pragma_table_info('alerts') WHERE name = 'suggested_correction'",
        )
        .fetch_optional(pool)
        .await?;
        if has_column.is_none() {
            sqlx::query("ALTER TABLE alerts ADD COLUMN suggested_correction TEXT")
                .execute(pool)
                .await?;
        }
        Ok(())
    }
}

fn preprocess_text(text: &str) -> String {
    let mut result = String::with_capacity(text.len());
    let chars: Vec<char> = text.chars().collect();
    let mut i = 0;
    while i < chars.len() {
        if chars[i] == '/' {
            let prev_ok = i > 0 && chars[i - 1].is_alphanumeric();
            let next_ok = i + 1 < chars.len() && chars[i + 1].is_alphanumeric();
            if prev_ok && next_ok {
                result.push_str(" and ");
                i += 1;
                continue;
            }
        }
        result.push(chars[i]);
        i += 1;
    }
    result
}

#[async_trait]
impl MemoryEngine for SqliteStubEngine {
    /// STUB: Basic regex-based entity extraction from file contents.
    ///
    /// Reads the file, splits into tokens, and creates entity nodes for
    /// capitalized words (a naive heuristic). Creates "mentioned_with"
    /// relationships between entities found in the same line.
    async fn ingest_document(
        &self,
        path: &str,
        _source_type: SourceType,
    ) -> Result<IngestSummary, MemoryError> {
        // Read the file
        let raw_content = tokio::fs::read_to_string(path)
            .await
            .map_err(|e| MemoryError::IngestionFailed(format!("cannot read file: {e}")))?;
        let content = preprocess_text(&raw_content);

        let mut entities_extracted: u32 = 0;
        let mut relationships_extracted: u32 = 0;

        // STUB: Extract capitalized words as entity names (very naive).
        // In production, cognee-rs `remember()` handles real NLP extraction.
        let mut line_entities: Vec<Vec<String>> = Vec::new();

        for line in content.lines() {
            let mut ids_in_line = Vec::new();

            for word in line.split_whitespace() {
                let cleaned: String = word.chars().filter(|c| c.is_alphanumeric()).collect();
                if cleaned.len() >= 3 && cleaned.chars().next().map_or(false, |c| c.is_uppercase())
                {
                    let name = cleaned;

                    // Check if entity already exists by name
                    let row: Option<(String,)> =
                        sqlx::query_as("SELECT id FROM stub_entities WHERE name = ?")
                            .bind(&name)
                            .fetch_optional(&self.pool)
                            .await
                            .map_err(|e| MemoryError::Storage(e.to_string()))?;

                    if let Some((existing_id,)) = row {
                        ids_in_line.push(existing_id);
                    } else {
                        let entity_id = Uuid::new_v4().to_string();
                        sqlx::query(
                            "INSERT INTO stub_entities (id, entity_type, name, attributes) \
                             VALUES (?, 'Unknown', ?, '{}')",
                        )
                        .bind(&entity_id)
                        .bind(&name)
                        .execute(&self.pool)
                        .await
                        .map_err(|e| MemoryError::Storage(e.to_string()))?;

                        entities_extracted += 1;
                        ids_in_line.push(entity_id);
                    }
                }
            }

            line_entities.push(ids_in_line);
        }

        // STUB: Create "mentioned_with" edges between entities on the same line
        for ids in &line_entities {
            for i in 0..ids.len() {
                for j in (i + 1)..ids.len() {
                    let result = sqlx::query(
                        "INSERT OR IGNORE INTO stub_relationships \
                         (from_id, to_id, relationship_type, weight, active) \
                         VALUES (?, ?, 'mentioned_with', 1.0, 1)",
                    )
                    .bind(&ids[i])
                    .bind(&ids[j])
                    .execute(&self.pool)
                    .await
                    .map_err(|e| MemoryError::Storage(e.to_string()))?;

                    if result.rows_affected() > 0 {
                        relationships_extracted += 1;
                    }
                }
            }
        }

        Ok(IngestSummary {
            entities_extracted,
            relationships_extracted,
        })
    }

    /// STUB: Keyword search across entity names.
    ///
    /// Splits the question into words, searches for matching entities,
    /// returns a best-effort answer with `Low` confidence.
    async fn query(&self, question: &str) -> Result<QueryResult, MemoryError> {
        let keywords: Vec<&str> = question
            .split_whitespace()
            .filter(|w| w.len() >= 3)
            .collect();

        if keywords.is_empty() {
            return Ok(QueryResult {
                answer: "No meaningful keywords found in question.".to_string(),
                reasoning_path: vec![],
                confidence: ConfidenceLevel::Low,
            });
        }

        let mut matching_entities: Vec<MemoryEntity> = Vec::new();

        for keyword in &keywords {
            let pattern = format!("%{keyword}%");
            let rows: Vec<(String, String, String, String)> = sqlx::query_as(
                "SELECT id, entity_type, name, attributes FROM stub_entities \
                 WHERE name LIKE ? LIMIT 10",
            )
            .bind(&pattern)
            .fetch_all(&self.pool)
            .await
            .map_err(|e| MemoryError::QueryFailed(e.to_string()))?;

            for (id, entity_type, name, attrs) in rows {
                let attributes: serde_json::Value =
                    serde_json::from_str(&attrs).unwrap_or(serde_json::Value::Null);
                matching_entities.push(MemoryEntity {
                    id,
                    entity_type,
                    name,
                    attributes,
                });
            }
        }

        // Deduplicate by ID
        matching_entities.sort_by(|a, b| a.id.cmp(&b.id));
        matching_entities.dedup_by(|a, b| a.id == b.id);

        let answer = if matching_entities.is_empty() {
            "No matching entities found in the knowledge graph.".to_string()
        } else {
            let names: Vec<&str> = matching_entities.iter().map(|e| e.name.as_str()).collect();
            format!(
                "Found {} matching entities: {}. (STUB: real answers require cognee-rs integration)",
                matching_entities.len(),
                names.join(", ")
            )
        };

        let confidence = if matching_entities.is_empty() {
            ConfidenceLevel::Low
        } else {
            ConfidenceLevel::Partial
        };

        Ok(QueryResult {
            answer,
            reasoning_path: matching_entities,
            confidence,
        })
    }

    /// Returns all entities and relationships from the stub tables.
    async fn get_graph_snapshot(&self) -> Result<GraphSnapshot, MemoryError> {
        let entity_rows: Vec<(String, String, String, String)> =
            sqlx::query_as("SELECT id, entity_type, name, attributes FROM stub_entities")
                .fetch_all(&self.pool)
                .await
                .map_err(|e| MemoryError::Storage(e.to_string()))?;

        let entities: Vec<MemoryEntity> = entity_rows
            .into_iter()
            .map(|(id, entity_type, name, attrs)| {
                let attributes = serde_json::from_str(&attrs).unwrap_or(serde_json::Value::Null);
                MemoryEntity {
                    id,
                    entity_type,
                    name,
                    attributes,
                }
            })
            .collect();

        let rel_rows: Vec<(String, String, String, f64, i32)> = sqlx::query_as(
            "SELECT from_id, to_id, relationship_type, weight, active \
             FROM stub_relationships",
        )
        .fetch_all(&self.pool)
        .await
        .map_err(|e| MemoryError::Storage(e.to_string()))?;

        let relationships: Vec<MemoryRelationship> = rel_rows
            .into_iter()
            .map(
                |(from_id, to_id, relationship_type, weight, active)| MemoryRelationship {
                    from_id,
                    to_id,
                    relationship_type,
                    weight: weight as f32,
                    active: active != 0,
                },
            )
            .collect();

        Ok(GraphSnapshot {
            entities,
            relationships,
        })
    }

    /// STUB: Applies a correction by creating an audit entity and a relationship.
    ///
    /// In production, cognee-rs `improve()` / `memify()` handles graph refinement.
    async fn apply_correction(
        &self,
        correction: CorrectionIntent,
    ) -> Result<CorrectionResult, MemoryError> {
        let audit_id = Uuid::new_v4().to_string();

        // Create an audit entity node
        let attrs = serde_json::json!({
            "author": correction.author,
            "raw_text": correction.raw_text,
            "timestamp": chrono::Utc::now().to_rfc3339(),
        });

        sqlx::query(
            "INSERT INTO stub_entities (id, entity_type, name, attributes) \
             VALUES (?, 'AuditCorrection', ?, ?)",
        )
        .bind(&audit_id)
        .bind(format!("Correction by {}", correction.author))
        .bind(attrs.to_string())
        .execute(&self.pool)
        .await
        .map_err(|e| MemoryError::Storage(e.to_string()))?;

        // STUB: In a real implementation, we'd parse the correction text,
        // identify affected entities/edges, create new edges, and deprecate old ones.
        // For now, just create the audit node.

        Ok(CorrectionResult {
            edges_created: 0,
            edges_deprecated: 0,
            audit_node_id: audit_id,
        })
    }
}
