//! End-to-end smoke test for the cognee engine against local Ollama.
//!
//! Run with: `cargo run -p memory_cognee --example smoke`
//! Requires Ollama running at localhost:11434 with the `gemma4` model.

use memory_cognee::config::CogneeAppConfig;
use memory_cognee::CogneeMemoryEngine;
use memory_engine::{MemoryEngine, SourceType};

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    // Print the live cognition trace alongside the smoke run — verifies the
    // same event stream the UI panel consumes.
    let mut trace_rx = memory_cognee::trace::subscribe();
    tokio::spawn(async move {
        while let Ok(ev) = trace_rx.recv().await {
            println!(
                "      [trace:{:<8}] {} {}",
                ev.kind,
                ev.label,
                ev.detail.lines().next().unwrap_or("")
            );
        }
    });

    let work_dir = std::env::temp_dir().join("cognee_smoke_test");
    // Wipe previous state but keep downloaded embedding models — they are
    // immutable, and re-downloading every run trips upstream rate limits.
    for sub in ["data", "system", "cache", "sessions"] {
        let _ = std::fs::remove_dir_all(work_dir.join(sub));
    }
    let _ = std::fs::remove_file(work_dir.join("cognee.db"));
    std::fs::create_dir_all(&work_dir)?;

    println!("[1/4] initializing CogneeMemoryEngine (storage: {})", work_dir.display());
    let engine = CogneeMemoryEngine::new(CogneeAppConfig {
        llm_endpoint: "http://localhost:11434/v1".to_string(),
        llm_model: "gemma4".to_string(),
        llm_api_key: "not-needed".to_string(),
        embedding_provider: "onnx".to_string(),
        storage_root: work_dir.clone(),
        dataset_name: "smoke_test".to_string(),
    })
    .await?;
    println!("      engine initialized OK");

    let doc = work_dir.join("shipment.txt");
    std::fs::write(
        &doc,
        "Vale Mineracao ships lithium carbonate from the Port of Santos to the \
         Wolfsburg Assembly Plant, which fulfills orders for Stellantis NV.",
    )?;

    println!("[2/4] ingest_document (this runs real LLM extraction — may take a minute)");
    let summary = engine.ingest_document(doc.to_str().unwrap(), SourceType::Pdf).await?;
    println!(
        "      ingested: {} entities, {} relationships",
        summary.entities_extracted, summary.relationships_extracted
    );

    println!("[3/4] query");
    let result = engine.query("What does Vale Mineracao ship and where does it go?").await?;
    println!("      confidence: {:?}", result.confidence);
    println!("      reasoning path: {} entities", result.reasoning_path.len());
    println!("      answer: {}", result.answer.chars().take(400).collect::<String>());

    println!("[4/4] get_graph_snapshot");
    let snapshot = engine.get_graph_snapshot().await?;
    println!(
        "      graph: {} nodes, {} edges",
        snapshot.entities.len(),
        snapshot.relationships.len()
    );

    println!("SMOKE TEST PASSED");
    Ok(())
}
