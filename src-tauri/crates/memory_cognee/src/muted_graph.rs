//! Write-muted graph handle.
//!
//! [`MutedGraphDb`] forwards every *read* to the real graph database but
//! silently swallows every *write*. It exists for `apply_correction`'s
//! memify step: the corrective statement must be `remember()`ed so vector
//! memory and drift detection see the superseding fact, but letting cognify
//! write its entity extraction into the graph pollutes it with metadata
//! junk ("Correction", "2026-07-05", "Risk Officer", duplicate entities…).
//! The graph surgery a correction needs is done explicitly and precisely
//! before memify runs.

use std::borrow::Cow;
use std::collections::{HashMap, HashSet};
use std::sync::Arc;

use async_trait::async_trait;
use serde_json::Value;

use cognee_lib::cognee_graph::EdgeKey;
use cognee_lib::graph::{EdgeData, GraphDBResult, GraphDBTrait, GraphNode, NodeData};

pub struct MutedGraphDb {
    inner: Arc<dyn GraphDBTrait>,
}

impl MutedGraphDb {
    pub fn new(inner: Arc<dyn GraphDBTrait>) -> Self {
        Self { inner }
    }
}

#[async_trait]
impl GraphDBTrait for MutedGraphDb {
    // ── Writes: muted ────────────────────────────────────────────────────
    async fn initialize(&self) -> GraphDBResult<()> {
        Ok(())
    }
    async fn delete_graph(&self) -> GraphDBResult<()> {
        Ok(())
    }
    async fn add_node_raw(&self, _node: Value) -> GraphDBResult<()> {
        Ok(())
    }
    async fn add_nodes_raw(&self, _nodes: Vec<Value>) -> GraphDBResult<()> {
        Ok(())
    }
    async fn delete_node(&self, _node_id: &str) -> GraphDBResult<()> {
        Ok(())
    }
    async fn delete_nodes(&self, _node_ids: &[String]) -> GraphDBResult<()> {
        Ok(())
    }
    async fn add_edge(
        &self,
        _source_id: &str,
        _target_id: &str,
        _relationship_name: &str,
        _properties: Option<HashMap<Cow<'static, str>, Value>>,
    ) -> GraphDBResult<()> {
        Ok(())
    }
    async fn add_edges(&self, _edges: &[EdgeData]) -> GraphDBResult<()> {
        Ok(())
    }
    async fn update_node_property(
        &self,
        _node_id: &str,
        _key: &str,
        _value: Value,
    ) -> GraphDBResult<()> {
        Ok(())
    }
    async fn update_edge_property(
        &self,
        _source_id: &str,
        _target_id: &str,
        _relationship_name: &str,
        _key: &str,
        _value: Value,
    ) -> GraphDBResult<()> {
        Ok(())
    }
    async fn set_node_feedback_weights(
        &self,
        updates: &HashMap<String, f64>,
    ) -> GraphDBResult<HashMap<String, bool>> {
        Ok(updates.keys().map(|k| (k.clone(), true)).collect())
    }
    async fn set_edge_feedback_weights(
        &self,
        updates: &HashMap<EdgeKey, f64>,
    ) -> GraphDBResult<HashMap<EdgeKey, bool>> {
        Ok(updates.keys().map(|k| (k.clone(), true)).collect())
    }

    // ── Reads: forwarded ─────────────────────────────────────────────────
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
    async fn has_node(&self, node_id: &str) -> GraphDBResult<bool> {
        self.inner.has_node(node_id).await
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
    async fn get_degree_one_nodes(&self, node_type: &str) -> GraphDBResult<Vec<GraphNode>> {
        self.inner.get_degree_one_nodes(node_type).await
    }
    async fn get_all_relationship_names(&self) -> GraphDBResult<HashSet<String>> {
        self.inner.get_all_relationship_names().await
    }
    async fn get_zero_degree_edge_type_nodes(&self) -> GraphDBResult<Vec<GraphNode>> {
        self.inner.get_zero_degree_edge_type_nodes().await
    }
    async fn get_node_feedback_weights(
        &self,
        node_ids: &[String],
    ) -> GraphDBResult<HashMap<String, f64>> {
        self.inner.get_node_feedback_weights(node_ids).await
    }
    async fn get_edge_feedback_weights(
        &self,
        edge_keys: &[EdgeKey],
    ) -> GraphDBResult<HashMap<EdgeKey, f64>> {
        self.inner.get_edge_feedback_weights(edge_keys).await
    }
    async fn get_id_filtered_graph_data(
        &self,
        node_ids: &[String],
    ) -> GraphDBResult<(Vec<GraphNode>, Vec<EdgeData>)> {
        self.inner.get_id_filtered_graph_data(node_ids).await
    }
}
