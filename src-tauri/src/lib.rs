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

            // Fast path: SQLite setup is local and quick — do it before the
            // window shows so commands always have a working engine.
            let handle = app.handle().clone();
            let db = tauri::async_runtime::block_on(setup_sqlite(&app_data_dir))
                .expect("failed to initialize SQLite database");

            let stub: Arc<dyn memory_engine::MemoryEngine> =
                Arc::new(memory_sqlite::SqliteStubEngine::new(db.clone()));
            handle.manage(AppState::new(stub, db));

            // Start local Anthropic proxy server
            commands::settings::start_proxy_server(handle.clone());

            // ── Memory Engine ────────────────────────────────────
            // Production path: cognee-rs (in-process, LLM via local Ollama).
            // Initialization loads the ONNX embedding model (and downloads it
            // on the very first run), so it happens in the background — the
            // window appears immediately on the stub and the real engine is
            // swapped in once ready. If init fails (e.g. Ollama not running)
            // the stub stays active — no silent failure, the reason is
            // logged to stderr.
            // ── Cognition Trace forwarder ────────────────────────
            // Streams every cognee stage / LLM call / embedding batch to the
            // webview, where the Cognition Trace panel renders it live.
            #[cfg(feature = "cognee")]
            {
                use tauri::Emitter;
                let trace_handle = app.handle().clone();
                tauri::async_runtime::spawn(async move {
                    let mut rx = memory_cognee::trace::subscribe();
                    loop {
                        match rx.recv().await {
                            Ok(event) => {
                                let _ = trace_handle.emit("cognition-trace", &event);
                            }
                            Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => continue,
                            Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
                        }
                    }
                });

                // ── Live Graph forwarder ─────────────────────────
                // Streams every node/edge write cognee makes to the webview,
                // where the Graph Explorer renders the graph growing live.
                let delta_handle = app.handle().clone();
                tauri::async_runtime::spawn(async move {
                    let mut rx = memory_cognee::live_graph::subscribe();
                    loop {
                        match rx.recv().await {
                            Ok(event) => {
                                let _ = delta_handle.emit("graph-delta", &event);
                            }
                            Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => continue,
                            Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
                        }
                    }
                });
            }

            #[cfg(feature = "cognee")]
            {
                let handle = app.handle().clone();
                tauri::async_runtime::spawn(async move {
                    let settings = commands::settings::load_settings_internal(&handle);
                    
                    let llm_endpoint = if settings.llm.provider == "local" {
                        if settings.llm.endpoint.is_empty() {
                            "http://localhost:11434/v1".to_string()
                        } else {
                            settings.llm.endpoint.clone()
                        }
                    } else if settings.llm.provider == "openai" {
                        "https://api.openai.com/v1".to_string()
                    } else if settings.llm.provider == "gemini" {
                        "https://generativelanguage.googleapis.com/v1beta/openai/".to_string()
                    } else if settings.llm.provider == "groq" {
                        "https://api.groq.com/openai/v1".to_string()
                    } else if settings.llm.provider == "anthropic" {
                        "http://127.0.0.1:11430/v1".to_string()
                    } else {
                        settings.llm.endpoint.clone()
                    };

                    let api_key = if settings.llm.provider == "local" {
                        "not-needed".to_string()
                    } else {
                        settings.llm.api_key.clone()
                    };

                    match memory_cognee::CogneeMemoryEngine::new(
                        memory_cognee::config::CogneeAppConfig {
                            llm_endpoint,
                            llm_model: settings.llm.model,
                            llm_api_key: api_key,
                            embedding_provider: "onnx".to_string(),
                            storage_root: app_data_dir.join("cognee_data"),
                            dataset_name: "supply_chain_main".to_string(),
                        },
                    )
                    .await
                    {
                        Ok(engine) => {
                            handle
                                .state::<AppState>()
                                .set_memory(Arc::new(engine));
                            eprintln!(
                                "[memory] cognee-rs engine active"
                            );
                        }
                        Err(e) => {
                            eprintln!(
                                "[memory] cognee init failed — staying on SQLite stub. Error: {e}"
                            );
                        }
                    }
                });
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::ingestion::ingest_file,
            commands::ingestion::get_ingestion_status,
            commands::query::ask_question,
            commands::graph::get_graph_snapshot,
            commands::graph::add_custom_node,
            commands::graph::delete_custom_node,
            commands::graph::add_custom_relationship,
            commands::graph::delete_custom_relationship,
            commands::corrections::submit_correction,
            commands::corrections::confirm_correction,
            commands::corrections::reject_correction,
            commands::corrections::list_corrections,
            commands::blast_radius::simulate_blast_radius,
            commands::alerts::list_alerts,
            commands::settings::get_settings,
            commands::settings::save_settings,
            commands::settings::get_system_info,
            commands::google_sync::sync_google_workspace,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
