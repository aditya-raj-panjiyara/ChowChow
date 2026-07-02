//! Seed the app's real cognee dataset with demo documents.
//!
//! Usage: `cargo run -p memory_cognee --example seed_demo -- <storage_root> <file> [<file>...]`
//!
//! Ingests each file into the same storage root + dataset the Tauri app uses,
//! so the seeded graph shows up in Graph Explorer / Query / Blast Radius.
//! Stop the app before running this — both processes must not share the
//! embedded databases.

use memory_cognee::config::CogneeAppConfig;
use memory_cognee::CogneeMemoryEngine;
use memory_engine::{MemoryEngine, SourceType};
use std::path::PathBuf;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let mut args = std::env::args().skip(1);
    let storage_root = PathBuf::from(args.next().expect("first arg: storage root"));
    let files: Vec<String> = args.collect();
    assert!(!files.is_empty(), "pass at least one file to ingest");

    println!("[seed] initializing engine (storage: {})", storage_root.display());
    let engine = CogneeMemoryEngine::new(CogneeAppConfig {
        llm_endpoint: "http://localhost:11434/v1".to_string(),
        llm_model: "gemma4".to_string(),
        llm_api_key: "not-needed".to_string(),
        embedding_provider: "onnx".to_string(),
        storage_root,
        dataset_name: "supply_chain_main".to_string(),
    })
    .await?;

    for file in &files {
        let source_type = if file.ends_with(".csv") || file.ends_with(".xlsx") {
            SourceType::Erp
        } else if file.contains("email") {
            SourceType::Email
        } else {
            SourceType::Pdf
        };
        println!("[seed] ingesting {file} (LLM extraction — may take a minute)");
        let summary = engine.ingest_document(file, source_type).await?;
        println!(
            "[seed]   -> {} entities, {} relationships",
            summary.entities_extracted, summary.relationships_extracted
        );
    }

    let snapshot = engine.get_graph_snapshot().await?;
    println!(
        "[seed] graph now holds {} nodes, {} edges",
        snapshot.entities.len(),
        snapshot.relationships.len()
    );

    println!("[seed] sample query: 'Who supplies Lucky Lotus Powder and how does it reach the Wolfpack?'");
    let result = engine
        .query("Who supplies Lucky Lotus Powder and how does it reach the Wolfpack?")
        .await?;
    println!("[seed]   confidence: {:?}", result.confidence);
    println!("[seed]   reasoning path: {} entities", result.reasoning_path.len());
    println!("[seed]   answer: {}", result.answer.chars().take(500).collect::<String>());

    println!("SEED COMPLETE");
    Ok(())
}
