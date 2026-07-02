//! Configuration for the cognee-rs backed memory engine.
//!
//! Sets process-global environment variables to configure `cognee-lib`'s
//! `ConfigManager::from_env()`. **Call `apply_env()` exactly once at startup,
//! before `ComponentManager::new()`.**
//!
//! ## Sovereignty
//! - `llm_endpoint` → local Ollama, never a cloud key.
//! - `storage_root` → Tauri `app_data_dir()`, not `~/.config/cognee-rust/`.

use std::path::PathBuf;

/// Application-level configuration for the Cognee memory engine.
///
/// All fields map to cognee-lib env vars (confirmed against v0.1.1 source:
/// `config.rs` lines 242–414).
pub struct CogneeAppConfig {
    /// LLM endpoint — Ollama's OpenAI-compatible surface.
    /// E.g. `"http://localhost:11434/v1"`
    pub llm_endpoint: String,
    /// LLM model identifier. E.g. `"gemma4"`
    pub llm_model: String,
    /// LLM API key — for Ollama, use a dummy non-empty string.
    /// cognee-lib requires a non-empty key even when the endpoint doesn't.
    pub llm_api_key: String,
    /// Embedding provider: `"ollama"` or `"onnx"` for local-first.
    pub embedding_provider: String,
    /// On-disk storage root — Tauri `app_data_dir()`.
    pub storage_root: PathBuf,
    /// Dataset name. E.g. `"supply_chain_main"`
    pub dataset_name: String,
}

impl Default for CogneeAppConfig {
    fn default() -> Self {
        Self {
            llm_endpoint: "http://localhost:11434/v1".to_string(),
            llm_model: "gemma4".to_string(),
            llm_api_key: "not-needed".to_string(),
            embedding_provider: "ollama".to_string(),
            storage_root: PathBuf::from("./.data_storage"),
            dataset_name: "supply_chain_main".to_string(),
        }
    }
}

/// Set process-global env vars before `ComponentManager::new()`.
///
/// # Safety
/// `set_var` is process-global and not thread-safe in Rust ≥1.66.
/// Call this **once** at app startup, before any async runtime or
/// background task is spawned. The `unsafe` blocks acknowledge this.
pub fn apply_env(config: &CogneeAppConfig) {
    // SAFETY: called once at startup before any concurrent access.
    // cognee-lib's ConfigManager::from_env() reads these synchronously.
    unsafe {
        // LLM — env var names confirmed from cognee-lib config.rs:242-248
        std::env::set_var("OPENAI_URL", &config.llm_endpoint);
        std::env::set_var("OPENAI_MODEL", &config.llm_model);
        std::env::set_var("OPENAI_TOKEN", &config.llm_api_key);

        // Also set the canonical names (some paths read these directly)
        std::env::set_var("LLM_ENDPOINT", &config.llm_endpoint);
        std::env::set_var("LLM_MODEL", &config.llm_model);
        std::env::set_var("LLM_API_KEY", &config.llm_api_key);

        // Embedding — config.rs:374
        std::env::set_var("EMBEDDING_PROVIDER", &config.embedding_provider);

        // Data root — config.rs:413
        std::env::set_var(
            "DATA_ROOT_DIRECTORY",
            config.storage_root.to_string_lossy().as_ref(),
        );
    }
}
