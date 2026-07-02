//! # Domain Services
//!
//! Business logic layer — storage-agnostic, testable without Tauri.
//!
//! Each service operates against the [`MemoryEngine`](memory_engine::MemoryEngine)
//! trait and the app-level SQLite database. Services never know or care whether
//! the underlying engine is the SQLite stub or cognee-rs.

pub mod alert_service;
pub mod correction_service;
pub mod ingestion_service;
pub mod query_service;
