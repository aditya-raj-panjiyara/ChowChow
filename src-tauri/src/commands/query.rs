//! Query commands — natural-language questions against the knowledge graph.
//!
//! Frontend calls: `invoke('ask_question', { question })`

use crate::state::AppState;
use domain::query_service::QueryService;
use memory_engine::QueryResult;
use std::collections::HashMap;
use tauri::State;

/// Ask a natural-language question. Returns answer + reasoning path + confidence.
///
/// Manual graph edits (nodes/links the user added or removed on the canvas)
/// live in this app's SQLite overlay tables, not in cognee's memory — so they
/// are injected here as an authoritative preamble, the same pattern the
/// engine uses for committed corrections. Without this, drag-to-connect
/// edits would be invisible to queries.
#[tauri::command]
pub async fn ask_question(
    question: String,
    state: State<'_, AppState>,
) -> Result<QueryResult, String> {
    let service = QueryService::new(state.memory());

    let edits = manual_edit_facts(&state).await.unwrap_or_else(|e| {
        eprintln!("[query] could not load manual graph edits (continuing without): {e}");
        Vec::new()
    });

    let effective_question = if edits.is_empty() {
        question
    } else {
        format!(
            "Manual network edits by the analyst — authoritative, these \
             supersede any conflicting information in the knowledge base:\n- {}\n\n\
             Question: {question}",
            edits.join("\n- ")
        )
    };

    service.ask(&effective_question).await
}

/// Render the user's manual graph edits as plain-language facts.
async fn manual_edit_facts(state: &State<'_, AppState>) -> Result<Vec<String>, String> {
    // id → name resolution: engine graph first, custom entities override/extend.
    let mut names: HashMap<String, String> = HashMap::new();
    if let Ok(snapshot) = state.memory().get_graph_snapshot().await {
        for e in snapshot.entities {
            names.insert(e.id, e.name);
        }
    }

    let custom_nodes: Vec<(String, String, String)> =
        sqlx::query_as("SELECT id, name, entity_type FROM custom_entities")
            .fetch_all(&state.db)
            .await
            .map_err(|e| e.to_string())?;
    for (id, name, _) in &custom_nodes {
        names.insert(id.clone(), name.clone());
    }
    let name_of = |id: &str| names.get(id).cloned().unwrap_or_else(|| id.to_string());

    let mut facts = Vec::new();

    for (_, name, entity_type) in &custom_nodes {
        facts.push(format!(
            "\"{name}\" ({entity_type}) is part of the network (added manually)."
        ));
    }

    let custom_rels: Vec<(String, String, String, i32)> = sqlx::query_as(
        "SELECT from_id, to_id, relationship_type, active FROM custom_relationships",
    )
    .fetch_all(&state.db)
    .await
    .map_err(|e| e.to_string())?;
    for (from_id, to_id, rel, active) in &custom_rels {
        let verb = rel.replace('_', " ");
        if *active != 0 {
            facts.push(format!(
                "\"{}\" {verb} \"{}\" (link added manually).",
                name_of(from_id),
                name_of(to_id),
            ));
        }
    }

    let deleted_nodes: Vec<(String,)> = sqlx::query_as("SELECT id FROM deleted_entities")
        .fetch_all(&state.db)
        .await
        .map_err(|e| e.to_string())?;
    for (id,) in &deleted_nodes {
        // Only meaningful when we can still resolve a name for it.
        if let Some(name) = names.get(id) {
            facts.push(format!(
                "\"{name}\" was removed from the network and must NOT be treated as part of it."
            ));
        }
    }

    let deleted_rels: Vec<(String, String, String)> = sqlx::query_as(
        "SELECT from_id, to_id, relationship_type FROM deleted_relationships",
    )
    .fetch_all(&state.db)
    .await
    .map_err(|e| e.to_string())?;
    for (from_id, to_id, rel) in &deleted_rels {
        let verb = rel.replace('_', " ");
        facts.push(format!(
            "\"{}\" no longer {verb} \"{}\" (link removed manually).",
            name_of(from_id),
            name_of(to_id),
        ));
    }

    Ok(facts)
}
