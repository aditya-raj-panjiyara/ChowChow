//! Sovereign Supply Chain Risk Engine — Tauri application entry point.
//!
//! This module sets up:
//! 1. SQLite database (app-level + stub memory tables)
//! 2. Memory engine (SQLite stub today; swap to cognee-rs later)
//! 3. AppState shared across all commands
//! 4. All command handlers registered with Tauri

mod commands;
mod state;

use state::AppState;
use std::sync::Arc;
use tauri::Manager;

/// Initialize the SQLite database and run migrations.
///
/// The database file is created in Tauri's app data directory:
/// `~/<app-data-dir>/hackathon-app/supply_chain.db`
async fn setup_sqlite(
    app_data_dir: &std::path::Path,
) -> Result<sqlx::SqlitePool, Box<dyn std::error::Error>> {
    // Ensure the directory exists
    std::fs::create_dir_all(app_data_dir)?;

    let db_path = app_data_dir.join("supply_chain.db");
    let db_url = format!("sqlite:{}?mode=rwc", db_path.display());

    let pool = sqlx::sqlite::SqlitePoolOptions::new()
        .max_connections(5)
        .connect(&db_url)
        .await?;

    // Run migrations
    memory_sqlite::SqliteStubEngine::run_migrations(&pool).await?;

    Ok(pool)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let app_data_dir = app
                .path()
                .app_data_dir()
                .map_err(|e| format!("failed to get app data dir: {e}"))?;

            // Use tauri's async runtime to initialize the database and state
            let handle = app.handle().clone();
            tauri::async_runtime::block_on(async move {
                let db = setup_sqlite(&app_data_dir)
                    .await
                    .expect("failed to initialize SQLite database");

                // ── Memory Engine ────────────────────────────────────
                // Swap this line when cognee-rs is ready — nothing else changes.
                #[cfg(feature = "cognee")]
                let memory: Arc<dyn memory_engine::MemoryEngine> = Arc::new(
                    memory_cognee::CogneeMemoryEngine::new(memory_cognee::config::CogneeAppConfig {
                        llm_endpoint: "http://localhost:11434/v1".to_string(),
                        llm_model: "gemma4".to_string(),
                        llm_api_key: "not-needed".to_string(),
                        embedding_provider: "ollama".to_string(),
                        storage_root: app_data_dir.join("cognee_data"),
                        dataset_name: "supply_chain_main".to_string(),
                    })
                    .await
                    .expect("failed to init cognee-rs — is Ollama running? (start it with `ollama run gemma4` first)")
                );

                #[cfg(not(feature = "cognee"))]
                let memory: Arc<dyn memory_engine::MemoryEngine> =
                    Arc::new(memory_sqlite::SqliteStubEngine::new(db.clone()));

                handle.manage(AppState { memory, db });
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::ingestion::ingest_file,
            commands::ingestion::get_ingestion_status,
            commands::query::ask_question,
            commands::graph::get_graph_snapshot,
            commands::corrections::submit_correction,
            commands::corrections::confirm_correction,
            commands::corrections::list_corrections,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
