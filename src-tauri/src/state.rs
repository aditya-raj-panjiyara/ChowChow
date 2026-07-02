//! Application state shared across all Tauri commands.

use memory_engine::MemoryEngine;
use sqlx::SqlitePool;
use std::sync::{Arc, RwLock};

/// Shared application state managed by Tauri's state system.
///
/// Access in commands via `State<'_, AppState>`.
///
/// The memory engine is swappable at runtime: the app launches instantly on
/// the SQLite stub, then a background task initializes the cognee engine and
/// swaps it in once ready — the window never waits on model loading.
pub struct AppState {
    /// The active memory engine implementation.
    memory: RwLock<Arc<dyn MemoryEngine>>,

    /// App-level SQLite database (ingestion jobs, alerts, correction log).
    /// Always SQLite regardless of which memory engine is active.
    pub db: SqlitePool,
}

impl AppState {
    pub fn new(memory: Arc<dyn MemoryEngine>, db: SqlitePool) -> Self {
        Self {
            memory: RwLock::new(memory),
            db,
        }
    }

    /// Clone a handle to the currently active memory engine.
    pub fn memory(&self) -> Arc<dyn MemoryEngine> {
        self.memory.read().expect("memory engine lock poisoned").clone()
    }

    /// Swap the active memory engine (used when cognee finishes initializing).
    pub fn set_memory(&self, engine: Arc<dyn MemoryEngine>) {
        *self.memory.write().expect("memory engine lock poisoned") = engine;
    }
}
