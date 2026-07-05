//! Cognition Trace — live instrumentation of the cognee ↔ LLM pipeline.
//!
//! Two mechanisms feed one broadcast channel:
//! 1. **Stage events** emitted by `CogneeMemoryEngine`'s own methods
//!    (ingest / query / correction / drift scan).
//! 2. **Interceptors**: [`TracedLlm`] and [`TracedEmbedding`] wrap the real
//!    component handles before they're wired into cognee's pipelines, so
//!    every LLM prompt/response and embedding batch cognee makes internally
//!    is observed — real calls, not synthetic progress text.
//!
//! The Tauri layer subscribes and forwards events to the webview, where the
//! Cognition Trace panel renders them live.

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::{Instant, SystemTime, UNIX_EPOCH};

use async_trait::async_trait;
use serde::Serialize;
use std::sync::Arc;
use tokio::sync::broadcast;
use uuid::Uuid;

use cognee_lib::embedding::{EmbeddingEngine, EmbeddingResult};
use cognee_lib::llm::{GenerationOptions, GenerationResponse, Llm, LlmResult, Message};

/// One observed step in the cognition pipeline.
#[derive(Debug, Clone, Serialize)]
pub struct TraceEvent {
    pub seq: u64,
    /// Groups events under a top-level operation (one ingest, one query…).
    pub op_id: String,
    pub op_label: String,
    /// "op_start" | "op_end" | "stage" | "llm" | "embed"
    pub kind: String,
    pub label: String,
    pub detail: String,
    pub duration_ms: Option<u64>,
    /// Wall-clock milliseconds since epoch — the UI computes offsets from this.
    pub ts_ms: u64,
}

static CHANNEL: OnceLock<broadcast::Sender<TraceEvent>> = OnceLock::new();
static SEQ: AtomicU64 = AtomicU64::new(0);
static OP_STACK: Mutex<Vec<(String, String)>> = Mutex::new(Vec::new());

fn sender() -> &'static broadcast::Sender<TraceEvent> {
    CHANNEL.get_or_init(|| broadcast::channel(1024).0)
}

/// Subscribe to the live trace stream (the Tauri layer forwards this to the UI).
pub fn subscribe() -> broadcast::Receiver<TraceEvent> {
    sender().subscribe()
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn current_op() -> (String, String) {
    OP_STACK
        .lock()
        .ok()
        .and_then(|s| s.last().cloned())
        .unwrap_or_else(|| ("background".to_string(), "Background".to_string()))
}

/// The label of the operation currently in progress, e.g.
/// `"Ingest · chow_shipments_erp.csv"` or `"Correction · …"`. Returns `None`
/// when nothing is running (the background default). Used to tag graph
/// mutations with the source and reason they were created.
pub fn current_op_label() -> Option<String> {
    OP_STACK
        .lock()
        .ok()
        .and_then(|s| s.last().map(|(_, label)| label.clone()))
}

fn emit(kind: &str, label: impl Into<String>, detail: impl Into<String>, duration_ms: Option<u64>) {
    let (op_id, op_label) = current_op();
    let event = TraceEvent {
        seq: SEQ.fetch_add(1, Ordering::Relaxed),
        op_id,
        op_label,
        kind: kind.to_string(),
        label: label.into(),
        detail: detail.into(),
        duration_ms,
        ts_ms: now_ms(),
    };
    // No subscribers is fine — tracing must never fail an operation.
    let _ = sender().send(event);
}

/// Emit a mid-operation stage marker.
pub fn stage(label: impl Into<String>, detail: impl Into<String>) {
    emit("stage", label, detail, None);
}

/// Truncate text for event payloads — the UI shows previews, not transcripts.
pub fn preview(text: &str, max_chars: usize) -> String {
    let cleaned = text.trim().replace('\n', " ");
    if cleaned.chars().count() <= max_chars {
        cleaned
    } else {
        let cut: String = cleaned.chars().take(max_chars).collect();
        format!("{cut}…")
    }
}

/// RAII guard for a top-level operation. Emits `op_start` on creation and
/// `op_end` on `finish()`; if dropped without finishing (error path), still
/// emits a terminal event so the UI never shows a forever-spinning run.
pub struct OpGuard {
    id: String,
    start: Instant,
    finished: bool,
}

pub fn begin_op(label: impl Into<String>) -> OpGuard {
    let id = Uuid::new_v4().to_string();
    let label = label.into();
    if let Ok(mut stack) = OP_STACK.lock() {
        stack.push((id.clone(), label.clone()));
    }
    emit("op_start", label, "", None);
    OpGuard { id, start: Instant::now(), finished: false }
}

impl OpGuard {
    pub fn finish(mut self, detail: impl Into<String>) {
        self.finished = true;
        let duration = self.start.elapsed().as_millis() as u64;
        emit("op_end", "done", detail, Some(duration));
        self.pop();
    }

    fn pop(&self) {
        if let Ok(mut stack) = OP_STACK.lock() {
            if let Some(pos) = stack.iter().rposition(|(id, _)| *id == self.id) {
                stack.remove(pos);
            }
        }
    }
}

impl Drop for OpGuard {
    fn drop(&mut self) {
        if !self.finished {
            let duration = self.start.elapsed().as_millis() as u64;
            emit("op_end", "ended with error", "operation did not complete — see app error", Some(duration));
            self.pop();
        }
    }
}

// ─── LLM interceptor ─────────────────────────────────────────────────────────

/// Decorator over the real LLM handle — every call cognee makes internally
/// (entity extraction, summaries, graph completion…) emits a trace event
/// with prompt/response previews and timing.
pub struct TracedLlm {
    inner: Arc<dyn Llm>,
}

impl TracedLlm {
    pub fn new(inner: Arc<dyn Llm>) -> Self {
        Self { inner }
    }
}

fn last_user_preview(messages: &[Message]) -> String {
    messages
        .last()
        .map(|m| preview(&m.content, 240))
        .unwrap_or_default()
}

#[async_trait]
impl Llm for TracedLlm {
    async fn generate(
        &self,
        messages: Vec<Message>,
        options: Option<GenerationOptions>,
    ) -> LlmResult<GenerationResponse> {
        let prompt = last_user_preview(&messages);
        let started = Instant::now();
        let result = self.inner.generate(messages, options).await;
        let ms = started.elapsed().as_millis() as u64;
        match &result {
            Ok(r) => emit(
                "llm",
                "chat completion",
                format!("prompt: {prompt}\n→ {}", preview(&r.content, 280)),
                Some(ms),
            ),
            Err(e) => emit("llm", "chat completion — failed", format!("prompt: {prompt}\n→ error: {e}"), Some(ms)),
        }
        result
    }

    async fn create_structured_output_with_messages_raw(
        &self,
        messages: Vec<Message>,
        json_schema: &serde_json::Value,
        options: Option<GenerationOptions>,
    ) -> LlmResult<serde_json::Value> {
        let prompt = last_user_preview(&messages);
        let schema_name = json_schema
            .get("title")
            .and_then(|v| v.as_str())
            .unwrap_or("structured output")
            .to_string();
        let started = Instant::now();
        let result = self
            .inner
            .create_structured_output_with_messages_raw(messages, json_schema, options)
            .await;

        // Recover from deserialization errors caused by LLM wrapping JSON in markdown code blocks
        let result = match result {
            Ok(v) => Ok(v),
            Err(e) => {
                let err_str = e.to_string();
                if err_str.contains("DeserializationError") || err_str.contains("deserialize") {
                    if let Some(raw_start) = err_str.find("Raw: ") {
                        let raw_content = &err_str[raw_start + 5..];
                        let mut cleaned = raw_content.trim();
                        if cleaned.starts_with("```") {
                            if let Some(first_newline) = cleaned.find('\n') {
                                cleaned = &cleaned[first_newline + 1..];
                            } else {
                                cleaned = cleaned.trim_start_matches('`').trim_start_matches("json").trim_start_matches("JSON");
                            }
                        }
                        if cleaned.ends_with("```") {
                            cleaned = &cleaned[..cleaned.len() - 3];
                        }
                        let cleaned = cleaned.trim();
                        match serde_json::from_str::<serde_json::Value>(cleaned) {
                            Ok(parsed) => {
                                eprintln!("[cognee-trace] Recovered LLM JSON by stripping markdown code blocks");
                                Ok(parsed)
                            }
                            Err(_) => Err(e),
                        }
                    } else {
                        Err(e)
                    }
                } else {
                    Err(e)
                }
            }
        };

        // Schema repair — local models often return JSON that is almost
        // right (label instead of name, wrapper keys, numbers as strings).
        // cognee deserializes strictly, so a single missing required field
        // ("missing field `name`") would fail the whole cognify pipeline.
        // Fix what we can against the supplied schema before cognee sees it.
        let result = result.map(|v| {
            let (repaired, fixes) = crate::schema_repair::repair(v, json_schema);
            if !fixes.is_empty() {
                emit(
                    "llm",
                    format!("schema repair · {schema_name}"),
                    format!(
                        "model output violated the schema — {} auto-fix(es): {}",
                        fixes.len(),
                        preview(&fixes.join(" · "), 240)
                    ),
                    None,
                );
            }
            repaired
        });

        let ms = started.elapsed().as_millis() as u64;
        match &result {
            Ok(v) => emit(
                "llm",
                format!("structured extraction · {schema_name}"),
                format!("input: {prompt}\n→ {}", preview(&v.to_string(), 280)),
                Some(ms),
            ),
            Err(e) => emit(
                "llm",
                format!("structured extraction · {schema_name} — failed"),
                format!("input: {prompt}\n→ error: {e}"),
                Some(ms),
            ),
        }
        result
    }

    async fn transcribe_image(
        &self,
        image_bytes: &[u8],
        mime_type: &str,
        options: Option<GenerationOptions>,
    ) -> LlmResult<String> {
        let started = Instant::now();
        let result = self.inner.transcribe_image(image_bytes, mime_type, options).await;
        let ms = started.elapsed().as_millis() as u64;
        if let Ok(text) = &result {
            emit("llm", "vision transcription", preview(text, 200), Some(ms));
        }
        result
    }

    fn model(&self) -> &str {
        self.inner.model()
    }
    fn supports_streaming(&self) -> bool {
        self.inner.supports_streaming()
    }
    fn supports_function_calling(&self) -> bool {
        self.inner.supports_function_calling()
    }
    fn max_context_length(&self) -> u32 {
        self.inner.max_context_length()
    }
    fn supports_vision(&self) -> bool {
        self.inner.supports_vision()
    }
}

// ─── Embedding interceptor ───────────────────────────────────────────────────

/// Decorator over the embedding engine — batches show up in the trace with
/// size, sample text, and timing.
pub struct TracedEmbedding {
    inner: Arc<dyn EmbeddingEngine>,
}

impl TracedEmbedding {
    pub fn new(inner: Arc<dyn EmbeddingEngine>) -> Self {
        Self { inner }
    }
}

#[async_trait]
impl EmbeddingEngine for TracedEmbedding {
    async fn embed(&self, texts: &[&str]) -> EmbeddingResult<Vec<Vec<f32>>> {
        let sample = texts.first().map(|t| preview(t, 100)).unwrap_or_default();
        let started = Instant::now();
        let result = self.inner.embed(texts).await;
        let ms = started.elapsed().as_millis() as u64;
        match &result {
            Ok(vecs) => emit(
                "embed",
                format!("embed batch · {} text(s)", texts.len()),
                format!("dim {} · e.g. \"{sample}\"", vecs.first().map(|v| v.len()).unwrap_or(0)),
                Some(ms),
            ),
            Err(e) => emit("embed", "embed batch — failed", format!("{} text(s) · error: {e}", texts.len()), Some(ms)),
        }
        result
    }

    fn dimension(&self) -> usize {
        self.inner.dimension()
    }
    fn batch_size(&self) -> usize {
        self.inner.batch_size()
    }
    fn max_sequence_length(&self) -> usize {
        self.inner.max_sequence_length()
    }
}
