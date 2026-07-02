use crate::state::AppState;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::sync::Arc;
use tauri::{AppHandle, Manager, State};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct LlmSettings {
    pub provider: String, // "local" | "openai" | "gemini" | "groq" | "custom" | "anthropic"
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

/// Start a lightweight OpenAI-to-Anthropic Messages API proxy server on localhost:11430.
/// Runs in the background, reading the API key from settings.json on-demand.
pub fn start_proxy_server(app_handle: AppHandle) {
    tokio::spawn(async move {
        let listener = match TcpListener::bind("127.0.0.1:11430").await {
            Ok(l) => l,
            Err(e) => {
                eprintln!("[proxy] Failed to bind to 127.0.0.1:11430: {e}. Proxy already running?");
                return;
            }
        };
        println!("[proxy] Anthropic OpenAI-to-Messages proxy listening on 127.0.0.1:11430");
        let app_handle = Arc::new(app_handle);

        loop {
            let (mut socket, _) = match listener.accept().await {
                Ok(s) => s,
                Err(_) => continue,
            };
            let app_handle = app_handle.clone();

            tokio::spawn(async move {
                let mut buffer = vec![0; 65536];
                let mut n = 0;

                // Read HTTP request header
                while n < buffer.len() {
                    let count = match socket.read(&mut buffer[n..]).await {
                        Ok(0) => break,
                        Ok(c) => c,
                        Err(_) => return,
                    };
                    n += count;
                    if String::from_utf8_lossy(&buffer[..n]).contains("\r\n\r\n") {
                        break;
                    }
                }

                let req_header = String::from_utf8_lossy(&buffer[..n]);
                if !req_header.starts_with("POST ") {
                    let _ = socket.write_all(b"HTTP/1.1 405 Method Not Allowed\r\nContent-Length: 0\r\n\r\n").await;
                    return;
                }

                // Check content length to get request body
                let mut content_len = 0;
                if let Some(content_len_idx) = req_header.to_lowercase().find("content-length:") {
                    let rest = &req_header[content_len_idx + 15..];
                    if let Some(end_line) = rest.find("\r\n") {
                        if let Ok(len) = rest[..end_line].trim().parse::<usize>() {
                            content_len = len;
                        }
                    }
                }

                let header_end = match req_header.find("\r\n\r\n") {
                    Some(idx) => idx + 4,
                    None => return,
                };
                let mut body_bytes = buffer[header_end..n].to_vec();

                // Read remaining body bytes if needed
                while body_bytes.len() < content_len {
                    let mut temp = vec![0; 4096];
                    let count = match socket.read(&mut temp).await {
                        Ok(0) => break,
                        Ok(c) => c,
                        Err(_) => return,
                    };
                    body_bytes.extend_from_slice(&temp[..count]);
                }

                let body_str = String::from_utf8_lossy(&body_bytes);

                // Parse OpenAI request body
                #[derive(Deserialize)]
                struct OpenAiMessage {
                    role: String,
                    content: serde_json::Value,
                }
                #[derive(Deserialize)]
                struct OpenAiRequest {
                    model: String,
                    messages: Vec<OpenAiMessage>,
                    max_tokens: Option<u32>,
                }

                let openai_req: OpenAiRequest = match serde_json::from_str(&body_str) {
                    Ok(r) => r,
                    Err(e) => {
                        eprintln!("[proxy] JSON parse error: {e}");
                        let _ = socket.write_all(b"HTTP/1.1 400 Bad Request\r\nContent-Length: 0\r\n\r\n").await;
                        return;
                    }
                };

                // Read api key from settings.json
                let settings = load_settings_internal(&app_handle);
                let api_key = settings.llm.api_key;

                if api_key.is_empty() {
                    let err_msg = "{\"error\": \"Anthropic API key is not configured in settings.\"}";
                    let response_bytes = format!(
                        "HTTP/1.1 400 Bad Request\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\r\n{}",
                        err_msg.len(),
                        err_msg
                    );
                    let _ = socket.write_all(response_bytes.as_bytes()).await;
                    return;
                }

                // Construct Anthropic request payload
                let mut system_prompt = String::new();
                let mut anthropic_messages = Vec::new();

                for msg in openai_req.messages {
                    let content_text = if msg.content.is_string() {
                        msg.content.as_str().unwrap().to_string()
                    } else {
                        msg.content.to_string()
                    };

                    if msg.role == "system" {
                        if !system_prompt.is_empty() {
                            system_prompt.push_str("\n");
                        }
                        system_prompt.push_str(&content_text);
                    } else {
                        let role = if msg.role == "assistant" { "assistant" } else { "user" };
                        anthropic_messages.push(serde_json::json!({
                            "role": role,
                            "content": content_text
                        }));
                    }
                }

                // Anthropic API fails if we send an assistant message first, or if we send consecutive messages with the same role.
                // We'll filter and alternate them just in case.
                let mut final_messages: Vec<serde_json::Value> = Vec::new();
                for msg in anthropic_messages {
                    if final_messages.is_empty() && msg["role"] == "assistant" {
                        // Skip starting with assistant
                        continue;
                    }
                    if let Some(last) = final_messages.last_mut() {
                        if last["role"] == msg["role"] {
                            // Merge consecutive messages of the same role
                            let mut text = last["content"].as_str().unwrap_or("").to_string();
                            text.push_str("\n");
                            text.push_str(msg["content"].as_str().unwrap_or(""));
                            last["content"] = serde_json::json!(text);
                            continue;
                        }
                    }
                    final_messages.push(msg);
                }

                let mut anthropic_req = serde_json::json!({
                    "model": openai_req.model,
                    "max_tokens": openai_req.max_tokens.unwrap_or(1024),
                    "messages": final_messages
                });

                if !system_prompt.is_empty() {
                    anthropic_req.as_object_mut().unwrap().insert("system".to_string(), serde_json::json!(system_prompt));
                }

                // Send request to Anthropic Messages API
                let client = reqwest::Client::new();
                let anthropic_resp = client.post("https://api.anthropic.com/v1/messages")
                    .header("x-api-key", &api_key)
                    .header("anthropic-version", "2023-06-01")
                    .header("content-type", "application/json")
                    .json(&anthropic_req)
                    .send()
                    .await;

                match anthropic_resp {
                    Ok(resp) => {
                        let status = resp.status();
                        let resp_body = resp.text().await.unwrap_or_default();

                        if !status.is_success() {
                            let response_bytes = format!(
                                "HTTP/1.1 {}\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\r\n{}",
                                status,
                                resp_body.len(),
                                resp_body
                            );
                            let _ = socket.write_all(response_bytes.as_bytes()).await;
                            return;
                        }

                        // Convert Anthropic response back to OpenAI format
                        #[derive(Deserialize)]
                        struct AnthropicContentBlock {
                            #[serde(rename = "type")]
                            block_type: String,
                            text: Option<String>,
                        }
                        #[derive(Deserialize)]
                        struct AnthropicUsage {
                            input_tokens: u32,
                            output_tokens: u32,
                        }
                        #[derive(Deserialize)]
                        struct AnthropicResponse {
                            id: String,
                            content: Vec<AnthropicContentBlock>,
                            model: String,
                            usage: AnthropicUsage,
                        }

                        if let Ok(anthropic_val) = serde_json::from_str::<AnthropicResponse>(&resp_body) {
                            let text_content = anthropic_val.content.iter()
                                .filter(|c| c.block_type == "text")
                                .filter_map(|c| c.text.clone())
                                .collect::<Vec<_>>()
                                .join("\n");

                            let openai_val = serde_json::json!({
                                "id": anthropic_val.id,
                                "object": "chat.completion",
                                "created": sqlx::types::chrono::Utc::now().timestamp(),
                                "model": anthropic_val.model,
                                "choices": [{
                                    "index": 0,
                                    "message": {
                                        "role": "assistant",
                                        "content": text_content
                                    },
                                    "finish_reason": "stop"
                                }],
                                "usage": {
                                    "prompt_tokens": anthropic_val.usage.input_tokens,
                                    "completion_tokens": anthropic_val.usage.output_tokens,
                                    "total_tokens": anthropic_val.usage.input_tokens + anthropic_val.usage.output_tokens
                                }
                            });

                            let openai_resp_str = openai_val.to_string();
                            let response_bytes = format!(
                                "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\r\n{}",
                                openai_resp_str.len(),
                                openai_resp_str
                            );
                            let _ = socket.write_all(response_bytes.as_bytes()).await;
                        } else {
                            let response_bytes = format!(
                                "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\r\n{}",
                                resp_body.len(),
                                resp_body
                            );
                            let _ = socket.write_all(response_bytes.as_bytes()).await;
                        }
                    }
                    Err(e) => {
                        let err_msg = format!("{{\"error\": \"Anthropic proxy request failed: {}\"}}", e);
                        let response_bytes = format!(
                            "HTTP/1.1 502 Bad Gateway\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\r\n{}",
                            err_msg.len(),
                            err_msg
                        );
                        let _ = socket.write_all(response_bytes.as_bytes()).await;
                    }
                }
            });
        }
    });
}
