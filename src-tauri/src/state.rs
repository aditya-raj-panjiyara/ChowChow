//! Application state shared across all Tauri commands.

use memory_engine::MemoryEngine;
use sqlx::SqlitePool;
use std::sync::Arc;

/// Shared application state managed by Tauri's state system.
///
/// Access in commands via `State<'_, AppState>`.
pub struct AppState {
    /// The active memory engine implementation.
    /// Today: `SqliteStubEngine`. Later: `CogneeMemoryEngine`.
    pub memory: Arc<dyn MemoryEngine>,

    /// App-level SQLite database (ingestion jobs, alerts, correction log).
    /// Always SQLite regardless of which memory engine is active.
    pub db: SqlitePool,
}
