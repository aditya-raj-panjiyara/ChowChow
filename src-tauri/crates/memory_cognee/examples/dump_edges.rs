//! Dump all edges touching entities whose name matches a filter.
//! Usage: `cargo run -p memory_cognee --example dump_edges -- <storage_root> <name_filter>`

use memory_cognee::config::CogneeAppConfig;
use memory_cognee::CogneeMemoryEngine;
use memory_engine::MemoryEngine;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let storage_root = std::env::args().nth(1).expect("arg 1: storage root").into();
    let filter = std::env::args().nth(2).unwrap_or_default().to_lowercase();

    let engine = CogneeMemoryEngine::new(CogneeAppConfig {
        llm_endpoint: "http://localhost:11434/v1".to_string(),
        llm_model: "gemma3".to_string(),
        llm_api_key: "not-needed".to_string(),
        embedding_provider: "onnx".to_string(),
        storage_root,
        dataset_name: "supply_chain_main".to_string(),
    })
    .await?;

    let snapshot = engine.get_graph_snapshot().await?;
    let name_of = |id: &str| {
        snapshot
            .entities
            .iter()
            .find(|e| e.id == id)
            .map(|e| e.name.clone())
            .unwrap_or_else(|| id.to_string())
    };

    let matching: Vec<&memory_engine::MemoryEntity> = snapshot
        .entities
        .iter()
        .filter(|e| e.name.to_lowercase().contains(&filter))
        .collect();
    println!("=== entities matching \"{filter}\" ===");
    for e in &matching {
        println!("  [{}] {} ({})", e.id, e.name, e.entity_type);
    }

    println!("\n=== edges touching those entities ===");
    let ids: Vec<&str> = matching.iter().map(|e| e.id.as_str()).collect();
    let mut count = 0;
    for r in &snapshot.relationships {
        if ids.contains(&r.from_id.as_str()) || ids.contains(&r.to_id.as_str()) {
            count += 1;
            println!(
                "  {} —{}→ {}   active={} weight={}",
                name_of(&r.from_id),
                r.relationship_type,
                name_of(&r.to_id),
                r.active,
                r.weight
            );
        }
    }
    println!("\n{count} edge(s) total · {} matching entities", matching.len());
    Ok(())
}
