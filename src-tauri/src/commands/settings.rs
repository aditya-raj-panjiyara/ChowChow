use crate::state::AppState;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::sync::Arc;
use tauri::{AppHandle, Manager, State};

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct LlmSettings {
    pub provider: String, // "local" | "openai" | "gemini" | "groq" | "custom"
    pub model: String,
    pub api_key: String,
    pub endpoint: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct AppSettings {
    pub llm: LlmSettings,
    pub storage_path: String,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            llm: LlmSettings {
                provider: "local".to_string(),
                model: "gemma4".to_string(),
                api_key: "".to_string(),
                endpoint: "http://localhost:11434/v1".to_string(),
            },
            storage_path: "~/sovereign-engine/data".to_string(),
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct SystemInfo {
    pub arch: String,
    pub os: String,
}

#[tauri::command]
pub fn get_system_info() -> SystemInfo {
    SystemInfo {
        arch: std::env::consts::ARCH.to_string(),
        os: std::env::consts::OS.to_string(),
    }
}

pub fn get_settings_path(app_handle: &AppHandle) -> PathBuf {
    app_handle
        .path()
        .app_config_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
        .join("settings.json")
}

pub fn load_settings_internal(app_handle: &AppHandle) -> AppSettings {
    let path = get_settings_path(app_handle);
    if path.exists() {
        if let Ok(content) = fs::read_to_string(path) {
            if let Ok(settings) = serde_json::from_str::<AppSettings>(&content) {
                return settings;
            }
        }
    }
    AppSettings::default()
}

#[tauri::command]
pub fn get_settings(app_handle: AppHandle) -> AppSettings {
    load_settings_internal(&app_handle)
}

#[tauri::command]
pub async fn save_settings(
    settings: AppSettings,
    app_handle: AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let path = get_settings_path(&app_handle);

    // Ensure parent directory exists
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }

    let content = serde_json::to_string_pretty(&settings)
        .map_err(|e| format!("failed to serialize settings: {e}"))?;

    fs::write(path, content)
        .map_err(|e| format!("failed to write settings file: {e}"))?;

    // Trigger memory engine re-initialization if cognee is enabled
    #[cfg(feature = "cognee")]
    {
        let app_data_dir = app_handle
            .path()
            .app_data_dir()
            .map_err(|e| format!("failed to get app data dir: {e}"))?;

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
        } else {
            settings.llm.endpoint.clone()
        };

        let api_key = if settings.llm.provider == "local" {
            "not-needed".to_string()
        } else {
            settings.llm.api_key.clone()
        };

        println!(
            "[settings] reinitializing cognee memory engine with model {} on {}",
            settings.llm.model, llm_endpoint
        );

        match memory_cognee::CogneeMemoryEngine::new(memory_cognee::config::CogneeAppConfig {
            llm_endpoint,
            llm_model: settings.llm.model.clone(),
            llm_api_key: api_key,
            embedding_provider: "onnx".to_string(),
            storage_root: app_data_dir.join("cognee_data"),
            dataset_name: "supply_chain_main".to_string(),
        })
        .await
        {
            Ok(new_engine) => {
                state.set_memory(Arc::new(new_engine));
                println!("[settings] cognee engine hot-swapped successfully");
            }
            Err(e) => {
                return Err(format!(
                    "Failed to initialize Cognee engine with new settings: {e}. Keeping current engine."
                ));
            }
        }
    }

    Ok(())
}
