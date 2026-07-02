//! Print the distinct node types and sample properties cognee produces.
//! Usage: `cargo run -p memory_cognee --example inspect_types -- <storage_root>`

use memory_cognee::config::CogneeAppConfig;
use memory_cognee::CogneeMemoryEngine;
use memory_engine::MemoryEngine;
use std::collections::BTreeMap;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let storage_root = std::env::args().nth(1).expect("arg: storage root").into();
    let engine = CogneeMemoryEngine::new(CogneeAppConfig {
        llm_endpoint: "http://localhost:11434/v1".to_string(),
        llm_model: "gemma4".to_string(),
        llm_api_key: "not-needed".to_string(),
        embedding_provider: "onnx".to_string(),
        storage_root,
        dataset_name: "correction_test".to_string(),
    })
    .await?;

    let snapshot = engine.get_graph_snapshot().await?;
    let mut by_type: BTreeMap<String, Vec<String>> = BTreeMap::new();
    for e in &snapshot.entities {
        by_type.entry(e.entity_type.clone()).or_default().push(e.name.clone());
    }
    for (t, names) in &by_type {
        println!("type={t}  count={}  e.g. {:?}", names.len(), &names[..names.len().min(3)]);
    }
    if let Some(e) = snapshot.entities.iter().find(|e| e.entity_type != "TextChunk") {
        println!("\nsample attributes for '{}': {}", e.name, e.attributes);
    }
    Ok(())
}
