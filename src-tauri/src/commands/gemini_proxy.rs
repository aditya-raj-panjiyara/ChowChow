//! Local OpenAI-compat proxy for Google Gemini.
//!
//! cognee-llm falls back from `response_format: json_schema` to the **legacy**
//! OpenAI function-calling fields (`functions` / `function_call`). Gemini's
//! OpenAI-compat endpoint rejects those (HTTP 400) and only accepts the modern
//! `tools` / `tool_choice` shape.
//!
//! This proxy sits between cognee and Gemini and:
//! 1. Rewrites `functions`/`function_call` → `tools`/`tool_choice`
//! 2. Rewrites response `tool_calls` → `function_call` so cognee can parse it
//! 3. Forwards everything else unchanged

use serde_json::{json, Value};
use tauri::AppHandle;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;

const LISTEN_ADDR: &str = "127.0.0.1:11431";
const GEMINI_CHAT_URL: &str =
    "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions";

/// Rewrite a request body for Gemini OpenAI-compat compatibility.
pub(crate) fn rewrite_request_for_gemini(mut body: Value) -> Value {
    let Some(obj) = body.as_object_mut() else {
        return body;
    };

    // Legacy function calling → modern tools API
    if let Some(functions) = obj.remove("functions") {
        let mut tools = Vec::new();
        if let Some(arr) = functions.as_array() {
            for f in arr {
                tools.push(json!({
                    "type": "function",
                    "function": f
                }));
            }
        }
        obj.insert("tools".into(), Value::Array(tools));
    }

    if let Some(fc) = obj.remove("function_call") {
        // OpenAI legacy: `"function_call": {"name": "..."}` or `"auto"` / `"none"`
        let tool_choice = match fc {
            Value::String(s) if s == "auto" || s == "none" || s == "required" => Value::String(s),
            Value::Object(ref m) => {
                let name = m
                    .get("name")
                    .and_then(|v| v.as_str())
                    .unwrap_or("extract_structured_data");
                json!({
                    "type": "function",
                    "function": { "name": name }
                })
            }
            other => other,
        };
        obj.insert("tool_choice".into(), tool_choice);
    }

    body
}

/// Rewrite a Gemini chat.completion response so cognee's legacy parser works.
pub(crate) fn rewrite_response_for_cognee(mut body: Value) -> Value {
    let Some(choices) = body
        .as_object_mut()
        .and_then(|o| o.get_mut("choices"))
        .and_then(|c| c.as_array_mut())
    else {
        return body;
    };

    for choice in choices {
        let Some(message) = choice
            .as_object_mut()
            .and_then(|c| c.get_mut("message"))
            .and_then(|m| m.as_object_mut())
        else {
            continue;
        };

        // Promote tool_calls → function_call for cognee-llm's legacy parser.
        if message.get("function_call").is_none() {
            if let Some(tool_calls) = message.get("tool_calls").and_then(|t| t.as_array()) {
                if let Some(first) = tool_calls.first() {
                    if let Some(func) = first.get("function") {
                        let name = func
                            .get("name")
                            .cloned()
                            .unwrap_or_else(|| json!("extract_structured_data"));
                        let arguments = match func.get("arguments") {
                            Some(Value::String(s)) => s.clone(),
                            Some(other) => other.to_string(),
                            None => "{}".to_string(),
                        };
                        message.insert(
                            "function_call".into(),
                            json!({
                                "name": name,
                                "arguments": arguments
                            }),
                        );
                    }
                }
            }
        }
    }

    body
}

/// Start the Gemini OpenAI-compat proxy on localhost:11431.
pub fn start_gemini_proxy_server(_app_handle: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let listener = match TcpListener::bind(LISTEN_ADDR).await {
            Ok(l) => l,
            Err(e) => {
                eprintln!(
                    "[gemini-proxy] Failed to bind to {LISTEN_ADDR}: {e}. Proxy already running?"
                );
                return;
            }
        };
        println!("[gemini-proxy] Gemini OpenAI-compat proxy listening on {LISTEN_ADDR}");

        loop {
            let (mut socket, _) = match listener.accept().await {
                Ok(s) => s,
                Err(_) => continue,
            };

            tauri::async_runtime::spawn(async move {
                if let Err(e) = handle_connection(&mut socket).await {
                    eprintln!("[gemini-proxy] connection error: {e}");
                }
            });
        }
    });
}

async fn handle_connection(socket: &mut tokio::net::TcpStream) -> Result<(), String> {
    let mut buffer = vec![0u8; 65536];
    let mut n = 0usize;

    while n < buffer.len() {
        let count = socket
            .read(&mut buffer[n..])
            .await
            .map_err(|e| format!("read header: {e}"))?;
        if count == 0 {
            break;
        }
        n += count;
        if String::from_utf8_lossy(&buffer[..n]).contains("\r\n\r\n") {
            break;
        }
    }

    let req_header = String::from_utf8_lossy(&buffer[..n]);
    if !req_header.starts_with("POST ") {
        let _ = socket
            .write_all(b"HTTP/1.1 405 Method Not Allowed\r\nContent-Length: 0\r\n\r\n")
            .await;
        return Ok(());
    }

    let mut content_len = 0usize;
    if let Some(idx) = req_header.to_lowercase().find("content-length:") {
        let rest = &req_header[idx + 15..];
        if let Some(end_line) = rest.find("\r\n") {
            if let Ok(len) = rest[..end_line].trim().parse::<usize>() {
                content_len = len;
            }
        }
    }

    let mut auth_header = String::new();
    for line in req_header.lines() {
        if line.to_lowercase().starts_with("authorization:") {
            auth_header = line[14..].trim().to_string();
            break;
        }
    }

    let header_end = req_header
        .find("\r\n\r\n")
        .ok_or_else(|| "missing header terminator".to_string())?
        + 4;
    let mut body_bytes = buffer[header_end..n].to_vec();

    while body_bytes.len() < content_len {
        let mut temp = vec![0u8; 8192];
        let count = socket
            .read(&mut temp)
            .await
            .map_err(|e| format!("read body: {e}"))?;
        if count == 0 {
            break;
        }
        body_bytes.extend_from_slice(&temp[..count]);
    }
    if body_bytes.len() > content_len && content_len > 0 {
        body_bytes.truncate(content_len);
    }

    let body_str = String::from_utf8_lossy(&body_bytes);
    let parsed: Value = match serde_json::from_str(&body_str) {
        Ok(v) => v,
        Err(e) => {
            write_http(
                socket,
                400,
                &format!(r#"{{"error":"bad json: {e}"}}"#),
            )
            .await?;
            return Ok(());
        }
    };

    let rewritten = rewrite_request_for_gemini(parsed);

    if auth_header.is_empty() {
        write_http(
            socket,
            401,
            r#"{"error":"Missing Authorization header for Gemini proxy"}"#,
        )
        .await?;
        return Ok(());
    }

    let client = reqwest::Client::new();
    let gemini_resp = client
        .post(GEMINI_CHAT_URL)
        .header("Authorization", &auth_header)
        .header("Content-Type", "application/json")
        .json(&rewritten)
        .send()
        .await
        .map_err(|e| format!("upstream request: {e}"))?;

    let status = gemini_resp.status();
    let resp_body = gemini_resp
        .text()
        .await
        .unwrap_or_else(|_| r#"{"error":"empty upstream body"}"#.to_string());

    let out_body = if status.is_success() {
        match serde_json::from_str::<Value>(&resp_body) {
            Ok(v) => rewrite_response_for_cognee(v).to_string(),
            Err(_) => resp_body,
        }
    } else {
        resp_body
    };

    let response_bytes = format!(
        "HTTP/1.1 {}\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\r\n{}",
        status.as_u16(),
        out_body.len(),
        out_body
    );
    socket
        .write_all(response_bytes.as_bytes())
        .await
        .map_err(|e| format!("write response: {e}"))?;
    Ok(())
}

async fn write_http(
    socket: &mut tokio::net::TcpStream,
    status: u16,
    body: &str,
) -> Result<(), String> {
    let reason = match status {
        400 => "Bad Request",
        401 => "Unauthorized",
        502 => "Bad Gateway",
        _ => "Error",
    };
    let response_bytes = format!(
        "HTTP/1.1 {status} {reason}\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\r\n{body}",
        body.len()
    );
    socket
        .write_all(response_bytes.as_bytes())
        .await
        .map_err(|e| format!("write: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn rewrites_legacy_functions_to_tools() {
        let req = json!({
            "model": "gemini-3.5-flash",
            "messages": [{"role": "user", "content": "hi"}],
            "functions": [{
                "name": "extract_structured_data",
                "description": "extract",
                "parameters": {"type": "object", "properties": {"name": {"type": "string"}}}
            }],
            "function_call": {"name": "extract_structured_data"}
        });
        let out = rewrite_request_for_gemini(req);
        assert!(out.get("functions").is_none());
        assert!(out.get("function_call").is_none());
        assert_eq!(out["tools"][0]["type"], "function");
        assert_eq!(
            out["tools"][0]["function"]["name"],
            "extract_structured_data"
        );
        assert_eq!(out["tool_choice"]["type"], "function");
        assert_eq!(
            out["tool_choice"]["function"]["name"],
            "extract_structured_data"
        );
    }

    #[test]
    fn rewrites_tool_calls_to_function_call() {
        let resp = json!({
            "choices": [{
                "message": {
                    "role": "assistant",
                    "tool_calls": [{
                        "id": "call_1",
                        "type": "function",
                        "function": {
                            "name": "extract_structured_data",
                            "arguments": "{\"name\":\"Alice\"}"
                        }
                    }]
                }
            }]
        });
        let out = rewrite_response_for_cognee(resp);
        assert_eq!(
            out["choices"][0]["message"]["function_call"]["name"],
            "extract_structured_data"
        );
        assert_eq!(
            out["choices"][0]["message"]["function_call"]["arguments"],
            "{\"name\":\"Alice\"}"
        );
    }

    #[test]
    fn leaves_plain_requests_alone() {
        let req = json!({
            "model": "gemini-3.5-flash",
            "messages": [{"role": "user", "content": "hi"}],
            "response_format": {"type": "json_object"}
        });
        let out = rewrite_request_for_gemini(req.clone());
        assert_eq!(out, req);
    }
}
