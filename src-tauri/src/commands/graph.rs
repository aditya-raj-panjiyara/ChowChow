use crate::state::AppState;
use memory_engine::GraphSnapshot;
use tauri::State;

#[tauri::command]
pub async fn get_graph_snapshot(
    state: State<'_, AppState>,
) -> Result<GraphSnapshot, String> {
    // 1. Get base snapshot from memory engine
    let mut snapshot = state
        .memory()
        .get_graph_snapshot()
        .await
        .map_err(|e| e.to_string())?;

    // 2. Load deleted entities and relationships from SQLite
    let deleted_nodes_rows: Vec<(String,)> = sqlx::query_as("SELECT id FROM deleted_entities")
        .fetch_all(&state.db)
        .await
        .map_err(|e| e.to_string())?;
    let deleted_nodes: std::collections::HashSet<String> = deleted_nodes_rows.into_iter().map(|(id,)| id).collect();

    let deleted_rels_rows: Vec<(String, String, String)> = sqlx::query_as("SELECT from_id, to_id, relationship_type FROM deleted_relationships")
        .fetch_all(&state.db)
        .await
        .map_err(|e| e.to_string())?;
    let deleted_rels: std::collections::HashSet<(String, String, String)> = deleted_rels_rows.into_iter().collect();

    // 3. Filter base snapshot
    snapshot.entities.retain(|e| !deleted_nodes.contains(&e.id));
    snapshot.relationships.retain(|r| {
        !deleted_nodes.contains(&r.from_id) && 
        !deleted_nodes.contains(&r.to_id) &&
        !deleted_rels.contains(&(r.from_id.clone(), r.to_id.clone(), r.relationship_type.clone()))
    });

    // 4. Load custom entities from SQLite
    let custom_nodes_rows: Vec<(String, String, String, String)> = sqlx::query_as("SELECT id, entity_type, name, attributes FROM custom_entities")
        .fetch_all(&state.db)
        .await
        .map_err(|e| e.to_string())?;

    for (id, entity_type, name, attrs) in custom_nodes_rows {
        let attributes: serde_json::Value = serde_json::from_str(&attrs).unwrap_or(serde_json::Value::Null);
        let custom_entity = memory_engine::MemoryEntity {
            id: id.clone(),
            entity_type,
            name,
            attributes,
        };
        // Update if already exists, otherwise add
        if let Some(pos) = snapshot.entities.iter().position(|e| e.id == id) {
            snapshot.entities[pos] = custom_entity;
        } else {
            snapshot.entities.push(custom_entity);
        }
    }

    // 5. Load custom relationships from SQLite
    let custom_rels_rows: Vec<(String, String, String, f64, i32)> = sqlx::query_as("SELECT from_id, to_id, relationship_type, weight, active FROM custom_relationships")
        .fetch_all(&state.db)
        .await
        .map_err(|e| e.to_string())?;

    for (from_id, to_id, relationship_type, weight, active) in custom_rels_rows {
        let custom_rel = memory_engine::MemoryRelationship {
            from_id: from_id.clone(),
            to_id: to_id.clone(),
            relationship_type: relationship_type.clone(),
            weight: weight as f32,
            active: active != 0,
        };
        if let Some(pos) = snapshot.relationships.iter().position(|r| r.from_id == from_id && r.to_id == to_id && r.relationship_type == relationship_type) {
            snapshot.relationships[pos] = custom_rel;
        } else {
            snapshot.relationships.push(custom_rel);
        }
    }

    Ok(snapshot)
}

#[tauri::command]
pub async fn add_custom_node(
    id: String,
    name: String,
    entity_type: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    // 1. Remove from deleted_entities in case it was previously deleted
    sqlx::query("DELETE FROM deleted_entities WHERE id = ?")
        .bind(&id)
        .execute(&state.db)
        .await
        .map_err(|e| e.to_string())?;

    // 2. Insert or replace in custom_entities
    sqlx::query(
        "INSERT OR REPLACE INTO custom_entities (id, entity_type, name, attributes) VALUES (?, ?, ?, '{}')"
    )
    .bind(id)
    .bind(entity_type)
    .bind(name)
    .execute(&state.db)
    .await
    .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub async fn delete_custom_node(
    id: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    // 1. Delete from custom_entities
    sqlx::query("DELETE FROM custom_entities WHERE id = ?")
        .bind(&id)
        .execute(&state.db)
        .await
        .map_err(|e| e.to_string())?;

    // 2. Add to deleted_entities so it's filtered out of the base snapshot
    sqlx::query("INSERT OR IGNORE INTO deleted_entities (id) VALUES (?)")
        .bind(&id)
        .execute(&state.db)
        .await
        .map_err(|e| e.to_string())?;

    // 3. Delete associated relationships from custom_relationships
    sqlx::query("DELETE FROM custom_relationships WHERE from_id = ? OR to_id = ?")
        .bind(&id)
        .bind(&id)
        .execute(&state.db)
        .await
        .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub async fn add_custom_relationship(
    from_id: String,
    to_id: String,
    relationship_type: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    // 1. Remove from deleted_relationships if it was previously deleted
    sqlx::query("DELETE FROM deleted_relationships WHERE from_id = ? AND to_id = ? AND relationship_type = ?")
        .bind(&from_id)
        .bind(&to_id)
        .bind(&relationship_type)
        .execute(&state.db)
        .await
        .map_err(|e| e.to_string())?;

    // 2. Insert into custom_relationships
    sqlx::query("INSERT OR REPLACE INTO custom_relationships (from_id, to_id, relationship_type, weight, active) VALUES (?, ?, ?, 1.0, 1)")
        .bind(from_id)
        .bind(to_id)
        .bind(relationship_type)
        .execute(&state.db)
        .await
        .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub async fn delete_custom_relationship(
    from_id: String,
    to_id: String,
    relationship_type: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    // 1. Delete from custom_relationships
    sqlx::query("DELETE FROM custom_relationships WHERE from_id = ? AND to_id = ? AND relationship_type = ?")
        .bind(&from_id)
        .bind(&to_id)
        .bind(&relationship_type)
        .execute(&state.db)
        .await
        .map_err(|e| e.to_string())?;

    // 2. Add to deleted_relationships so base relationships are filtered out
    sqlx::query("INSERT OR IGNORE INTO deleted_relationships (from_id, to_id, relationship_type) VALUES (?, ?, ?)")
        .bind(from_id)
        .bind(to_id)
        .bind(relationship_type)
        .execute(&state.db)
        .await
        .map_err(|e| e.to_string())?;

    Ok(())
}

/// Restore every soft-deleted node and relationship.
///
/// Deletions are tombstones layered over the cognee graph — nothing is ever
/// hard-deleted from memory — so clearing the tombstone tables brings the
/// full extracted graph back. Returns how many tombstones were removed.
#[tauri::command]
pub async fn restore_deleted_graph(state: State<'_, AppState>) -> Result<u64, String> {
    let nodes = sqlx::query("DELETE FROM deleted_entities")
        .execute(&state.db)
        .await
        .map_err(|e| e.to_string())?;
    let rels = sqlx::query("DELETE FROM deleted_relationships")
        .execute(&state.db)
        .await
        .map_err(|e| e.to_string())?;
    Ok(nodes.rows_affected() + rels.rows_affected())
}
