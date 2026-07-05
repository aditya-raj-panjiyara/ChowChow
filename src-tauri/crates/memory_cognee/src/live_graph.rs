//! Live Graph Stream — real-time graph mutation events.
//!
//! [`LiveGraphDb`] wraps the real `GraphDBTrait` handle the same way
//! [`crate::trace::TracedLlm`] wraps the LLM: it is installed *before* the
//! pipelines are built, so every node and edge cognee writes internally
//! (cognify entity extraction, corrections, audit nodes…) is observed at the
//! moment it lands in the graph database — real writes, not polling.
//!
//! Events are filtered to the *domain* graph (same plumbing-type rules as
//! `get_graph_snapshot`) and broadcast on a channel the Tauri layer forwards
//! to the webview as `graph-delta` events, where the Graph Explorer renders
//! the graph growing live.

use std::borrow::Cow;
use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};

use async_trait::async_trait;
use serde::Serialize;
use serde_json::Value;
use tokio::sync::broadcast;

use cognee_lib::graph::{EdgeData, GraphDBResult, GraphDBTrait, GraphNode, NodeData};

/// cognee pipeline plumbing — never part of the domain graph.
/// Shared with `get_graph_snapshot`'s filtering.
pub const PLUMBING_TYPES: [&str; 8] = [
    "DocumentChunk",
    "TextChunk",
    "TextDocument",
    "TextSummary",
    "EntityType",
    "NodeSet",
    "Table",
    "TableRow",
];

/// One graph mutation, as observed at the database boundary.
#[derive(Debug, Clone, Serialize)]
pub struct GraphDeltaEvent {
    pub seq: u64,
    /// "node_added" | "edge_added" | "edge_updated" | "node_removed"
    pub kind: String,
    /// Node id (node events).
    pub id: Option<String>,
    pub name: Option<String>,
    /// Semantic type ("Person", "Organization"…) resolved via `is_a` when possible.
    pub entity_type: Option<String>,
    /// Edge endpoints (edge events).
    pub from_id: Option<String>,
    pub to_id: Option<String>,
    pub rel_type: Option<String>,
    /// For edge_updated: the new `active` flag (false = deprecated).
    pub active: Option<bool>,
    /// Where this change came from — the document/source or operation origin
    /// (e.g. "chow_shipments_erp.csv", "Manual correction", "Drift Sentinel").
    pub source: Option<String>,
    /// Why this specific node/edge was created, in plain language.
    pub reason: Option<String>,
    pub ts_ms: u64,
}

/// Split the current op label (`"Ingest · file.csv"`) into (category, detail).
/// Returns (None, None) when nothing is running.
fn op_context() -> (Option<String>, Option<String>) {
    match crate::trace::current_op_label() {
        Some(label) => match label.split_once('·') {
            Some((cat, detail)) => (
                Some(cat.trim().to_string()),
                Some(detail.trim().to_string()),
            ),
            None => (Some(label.trim().to_string()), None),
        },
        None => (None, None),
    }
}

/// Derive the (source, reason) provenance pair for a graph mutation from the
/// active operation, the write kind, and the node's semantic type.
fn provenance(write: &str, node_type: Option<&str>) -> (Option<String>, Option<String>) {
    let (category, detail) = op_context();
    let cat = category.as_deref().unwrap_or("");

    // Audit nodes are self-describing regardless of the enclosing op.
    if node_type == Some("AuditCorrection") {
        return (
            Some("Correction".to_string()),
            Some("Audit record of a committed correction — preserved, never deleted".to_string()),
        );
    }

    match cat {
        "Ingest" => {
            let src = detail.clone().unwrap_or_else(|| "an ingested document".to_string());
            let reason = match write {
                "node_added" => format!(
                    "Entity extracted from {src} by cognee's cognify LLM pass"
                ),
                "edge_added" => format!(
                    "Relationship inferred from {src} — the LLM read the text and connected these entities"
                ),
                _ => format!("Written while ingesting {src}"),
            };
            (detail, Some(reason))
        }
        "Correction" => {
            let reason = match write {
                "node_added" => "New entity introduced by a human correction",
                "edge_added" => "Relationship created by a human correction",
                "edge_updated" => "Relationship deprecated by a human correction (amber-dashed, audit-preserved)",
                _ => "Graph restructured by a human correction",
            };
            (Some("Manual correction".to_string()), Some(reason.to_string()))
        }
        "Drift Sentinel" => (
            Some("Drift Sentinel".to_string()),
            Some("Graph updated while cross-examining new intel against prior beliefs".to_string()),
        ),
        _ => (None, None),
    }
}

static CHANNEL: OnceLock<broadcast::Sender<GraphDeltaEvent>> = OnceLock::new();
static SEQ: AtomicU64 = AtomicU64::new(0);

fn sender() -> &'static broadcast::Sender<GraphDeltaEvent> {
    CHANNEL.get_or_init(|| broadcast::channel(2048).0)
}

/// Subscribe to the live graph mutation stream.
pub fn subscribe() -> broadcast::Receiver<GraphDeltaEvent> {
    sender().subscribe()
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn emit(event: GraphDeltaEvent) {
    // No subscribers is fine — streaming must never fail a write.
    let _ = sender().send(event);
}

fn base_event(kind: &str) -> GraphDeltaEvent {
    GraphDeltaEvent {
        seq: SEQ.fetch_add(1, Ordering::Relaxed),
        kind: kind.to_string(),
        id: None,
        name: None,
        entity_type: None,
        from_id: None,
        to_id: None,
        rel_type: None,
        active: None,
        source: None,
        reason: None,
        ts_ms: now_ms(),
    }
}

/// Decorator over the real graph database — every mutation cognee makes
/// is broadcast as a [`GraphDeltaEvent`] after it succeeds.
pub struct LiveGraphDb {
    inner: Arc<dyn GraphDBTrait>,
    /// EntityType node id → semantic type name ("Person", "Location"…),
    /// learned as EntityType nodes pass through the write path so `is_a`
    /// references on Entity nodes can be resolved immediately.
    type_names: Mutex<HashMap<String, String>>,
}

impl LiveGraphDb {
    pub fn new(inner: Arc<dyn GraphDBTrait>) -> Self {
        Self {
            inner,
            type_names: Mutex::new(HashMap::new()),
        }
    }

    /// Inspect a batch of node JSON values: learn EntityType names first so
    /// same-batch `is_a` references resolve, then emit node_added for every
    /// domain node.
    fn emit_nodes(&self, nodes: &[Value]) {
        // Pass 1: learn EntityType id → name.
        if let Ok(mut map) = self.type_names.lock() {
            for node in nodes {
                let node_type = node.get("type").and_then(|v| v.as_str()).unwrap_or("");
                if node_type == "EntityType" {
                    if let (Some(id), Some(name)) = (
                        node.get("id").and_then(|v| v.as_str()),
                        node.get("name").and_then(|v| v.as_str()),
                    ) {
                        map.insert(id.to_string(), name.to_string());
                    }
                }
            }
        }

        // Pass 2: emit domain nodes.
        for node in nodes {
            let raw_type = node
                .get("type")
                .and_then(|v| v.as_str())
                .unwrap_or("Unknown")
                .to_string();
            if PLUMBING_TYPES.contains(&raw_type.as_str()) {
                continue;
            }
            let Some(id) = node.get("id").and_then(|v| v.as_str()) else {
                continue;
            };
            let name = node
                .get("name")
                .and_then(|v| v.as_str())
                .unwrap_or(id)
                .to_string();

            // Resolve semantic type via is_a → EntityType, mirroring the snapshot.
            let entity_type = if raw_type == "Entity" {
                node.get("is_a")
                    .and_then(|v| v.as_str())
                    .and_then(|type_id| {
                        self.type_names
                            .lock()
                            .ok()
                            .and_then(|m| m.get(type_id).cloned())
                    })
                    .unwrap_or(raw_type)
            } else {
                raw_type
            };

            let (source, reason) = provenance("node_added", Some(&entity_type));
            let mut ev = base_event("node_added");
            ev.id = Some(id.to_string());
            ev.name = Some(name);
            ev.entity_type = Some(entity_type);
            ev.source = source;
            ev.reason = reason;
            emit(ev);
        }
    }

    fn emit_edge(&self, source_id: &str, target_id: &str, relationship_name: &str) {
        let (source, reason) = provenance("edge_added", None);
        let mut ev = base_event("edge_added");
        ev.from_id = Some(source_id.to_string());
        ev.to_id = Some(target_id.to_string());
        ev.rel_type = Some(relationship_name.to_string());
        ev.source = source;
        ev.reason = reason;
        emit(ev);
    }
}

#[async_trait]
impl GraphDBTrait for LiveGraphDb {
    async fn initialize(&self) -> GraphDBResult<()> {
        self.inner.initialize().await
    }

    async fn is_empty(&self) -> GraphDBResult<bool> {
        self.inner.is_empty().await
    }

    async fn query(
        &self,
        query: &str,
        params: Option<HashMap<Cow<'static, str>, Value>>,
    ) -> GraphDBResult<Vec<Vec<Value>>> {
        self.inner.query(query, params).await
    }

    async fn delete_graph(&self) -> GraphDBResult<()> {
        self.inner.delete_graph().await
    }

    async fn has_node(&self, node_id: &str) -> GraphDBResult<bool> {
        self.inner.has_node(node_id).await
    }

    async fn add_node_raw(&self, node: Value) -> GraphDBResult<()> {
        self.inner.add_node_raw(node.clone()).await?;
        self.emit_nodes(std::slice::from_ref(&node));
        Ok(())
    }

    async fn add_nodes_raw(&self, nodes: Vec<Value>) -> GraphDBResult<()> {
        self.inner.add_nodes_raw(nodes.clone()).await?;
        crate::trace::stage(
            "graph write",
            format!("{} node(s) written to the knowledge graph", nodes.len()),
        );
        self.emit_nodes(&nodes);
        Ok(())
    }

    async fn delete_node(&self, node_id: &str) -> GraphDBResult<()> {
        self.inner.delete_node(node_id).await?;
        let mut ev = base_event("node_removed");
        ev.id = Some(node_id.to_string());
        emit(ev);
        Ok(())
    }

    async fn delete_nodes(&self, node_ids: &[String]) -> GraphDBResult<()> {
        self.inner.delete_nodes(node_ids).await?;
        for id in node_ids {
            let mut ev = base_event("node_removed");
            ev.id = Some(id.clone());
            emit(ev);
        }
        Ok(())
    }

    async fn get_node(&self, node_id: &str) -> GraphDBResult<Option<NodeData>> {
        self.inner.get_node(node_id).await
    }

    async fn get_nodes(&self, node_ids: &[String]) -> GraphDBResult<Vec<NodeData>> {
        self.inner.get_nodes(node_ids).await
    }

    async fn has_edge(
        &self,
        source_id: &str,
        target_id: &str,
        relationship_name: &str,
    ) -> GraphDBResult<bool> {
        self.inner.has_edge(source_id, target_id, relationship_name).await
    }

    async fn has_edges(&self, edges: &[EdgeData]) -> GraphDBResult<Vec<EdgeData>> {
        self.inner.has_edges(edges).await
    }

    async fn add_edge(
        &self,
        source_id: &str,
        target_id: &str,
        relationship_name: &str,
        properties: Option<HashMap<Cow<'static, str>, Value>>,
    ) -> GraphDBResult<()> {
        self.inner
            .add_edge(source_id, target_id, relationship_name, properties)
            .await?;
        self.emit_edge(source_id, target_id, relationship_name);
        Ok(())
    }

    async fn add_edges(&self, edges: &[EdgeData]) -> GraphDBResult<()> {
        self.inner.add_edges(edges).await?;
        crate::trace::stage(
            "graph write",
            format!("{} edge(s) written to the knowledge graph", edges.len()),
        );
        for (source_id, target_id, relationship_name, _) in edges {
            self.emit_edge(source_id, target_id, relationship_name);
        }
        Ok(())
    }

    async fn get_edges(&self, node_id: &str) -> GraphDBResult<Vec<EdgeData>> {
        self.inner.get_edges(node_id).await
    }

    async fn get_neighbors(&self, node_id: &str) -> GraphDBResult<Vec<NodeData>> {
        self.inner.get_neighbors(node_id).await
    }

    async fn get_connections(
        &self,
        node_id: &str,
    ) -> GraphDBResult<Vec<(NodeData, HashMap<Cow<'static, str>, Value>, NodeData)>> {
        self.inner.get_connections(node_id).await
    }

    async fn get_graph_data(&self) -> GraphDBResult<(Vec<GraphNode>, Vec<EdgeData>)> {
        self.inner.get_graph_data().await
    }

    async fn get_graph_metrics(
        &self,
        include_optional: bool,
    ) -> GraphDBResult<HashMap<Cow<'static, str>, Value>> {
        self.inner.get_graph_metrics(include_optional).await
    }

    async fn get_filtered_graph_data(
        &self,
        attribute_filters: &HashMap<Cow<'static, str>, Vec<Value>>,
    ) -> GraphDBResult<(Vec<GraphNode>, Vec<EdgeData>)> {
        self.inner.get_filtered_graph_data(attribute_filters).await
    }

    async fn get_nodeset_subgraph(
        &self,
        node_type: &str,
        node_names: &[String],
        node_name_filter_operator: &str,
    ) -> GraphDBResult<(Vec<GraphNode>, Vec<EdgeData>)> {
        self.inner
            .get_nodeset_subgraph(node_type, node_names, node_name_filter_operator)
            .await
    }

    // Default-provided methods are forwarded explicitly so backend overrides
    // (e.g. Ladybug's in-place update_edge_property) are never shadowed by
    // the trait's fallback implementations.

    async fn get_degree_one_nodes(&self, node_type: &str) -> GraphDBResult<Vec<GraphNode>> {
        self.inner.get_degree_one_nodes(node_type).await
    }

    async fn get_all_relationship_names(&self) -> GraphDBResult<HashSet<String>> {
        self.inner.get_all_relationship_names().await
    }

    async fn get_zero_degree_edge_type_nodes(&self) -> GraphDBResult<Vec<GraphNode>> {
        self.inner.get_zero_degree_edge_type_nodes().await
    }

    async fn update_node_property(
        &self,
        node_id: &str,
        key: &str,
        value: Value,
    ) -> GraphDBResult<()> {
        self.inner.update_node_property(node_id, key, value).await
    }

    async fn update_edge_property(
        &self,
        source_id: &str,
        target_id: &str,
        relationship_name: &str,
        key: &str,
        value: Value,
    ) -> GraphDBResult<()> {
        self.inner
            .update_edge_property(source_id, target_id, relationship_name, key, value.clone())
            .await?;
        if key == "active" {
            let (source, reason) = provenance("edge_updated", None);
            let mut ev = base_event("edge_updated");
            ev.from_id = Some(source_id.to_string());
            ev.to_id = Some(target_id.to_string());
            ev.rel_type = Some(relationship_name.to_string());
            ev.active = value.as_bool();
            ev.source = source;
            ev.reason = reason;
            emit(ev);
        }
        Ok(())
    }

    async fn get_node_feedback_weights(
        &self,
        node_ids: &[String],
    ) -> GraphDBResult<HashMap<String, f64>> {
        self.inner.get_node_feedback_weights(node_ids).await
    }

    async fn set_node_feedback_weights(
        &self,
        updates: &HashMap<String, f64>,
    ) -> GraphDBResult<HashMap<String, bool>> {
        self.inner.set_node_feedback_weights(updates).await
    }

    async fn get_edge_feedback_weights(
        &self,
        edge_keys: &[cognee_lib::cognee_graph::EdgeKey],
    ) -> GraphDBResult<HashMap<cognee_lib::cognee_graph::EdgeKey, f64>> {
        self.inner.get_edge_feedback_weights(edge_keys).await
    }

    async fn set_edge_feedback_weights(
        &self,
        updates: &HashMap<cognee_lib::cognee_graph::EdgeKey, f64>,
    ) -> GraphDBResult<HashMap<cognee_lib::cognee_graph::EdgeKey, bool>> {
        self.inner.set_edge_feedback_weights(updates).await
    }

    async fn get_id_filtered_graph_data(
        &self,
        node_ids: &[String],
    ) -> GraphDBResult<(Vec<GraphNode>, Vec<EdgeData>)> {
        self.inner.get_id_filtered_graph_data(node_ids).await
    }
}
