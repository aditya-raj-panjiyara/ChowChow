//! Command modules — thin `#[tauri::command]` functions.
//!
//! These are the only surface the frontend talks to. No business logic here;
//! all work is delegated to domain services.

pub mod alerts;
pub mod blast_radius;
pub mod corrections;
pub mod forget;
pub mod graph;
pub mod ingestion;
pub mod query;
pub mod settings;
pub mod google_sync;
