//! Command modules — thin `#[tauri::command]` functions.
//!
//! These are the only surface the frontend talks to. No business logic here;
//! all work is delegated to domain services.

pub mod blast_radius;
pub mod corrections;
pub mod graph;
pub mod ingestion;
pub mod query;
pub mod settings;
