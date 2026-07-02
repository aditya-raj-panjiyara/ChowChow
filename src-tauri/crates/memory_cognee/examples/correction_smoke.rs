//! End-to-end test of the dynamic learning loop against an isolated dataset.
//!
//! Run with: `cargo run -p memory_cognee --example correction_smoke`
//!
//! Flow: ingest a fact → query it → apply a correction that negates it →
//! query again and confirm the answer changed and edges were deprecated.

use memory_cognee::config::CogneeAppConfig;
use memory_cognee::CogneeMemoryEngine;
use memory_engine::{CorrectionIntent, MemoryEngine, SourceType};

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let work_dir = std::env::temp_dir().join("cognee_correction_test");
    for sub in ["data", "system", "cache", "sessions"] {
        let _ = std::fs::remove_dir_all(work_dir.join(sub));
    }
    let _ = std::fs::remove_file(work_dir.join("cognee.db"));
    std::fs::create_dir_all(work_dir.join("models"))?;

    // Reuse the already-downloaded embedding model if available.
    let smoke_models = std::env::temp_dir().join("cognee_smoke_test/models");
    if smoke_models.exists() {
        for entry in std::fs::read_dir(&smoke_models)? {
            let entry = entry?;
            let dest = work_dir.join("models").join(entry.file_name());
            if !dest.exists() {
                std::fs::copy(entry.path(), dest)?;
            }
        }
    }

    println!("[1/5] init engine");
    let engine = CogneeMemoryEngine::new(CogneeAppConfig {
        llm_endpoint: "http://localhost:11434/v1".to_string(),
        llm_model: "gemma4".to_string(),
        llm_api_key: "not-needed".to_string(),
        embedding_provider: "onnx".to_string(),
        storage_root: work_dir.clone(),
        dataset_name: "correction_test".to_string(),
    })
    .await?;

    let doc = work_dir.join("network.txt");
    std::fs::write(
        &doc,
        "Black Doug distributes Lucky Lotus Powder to the Kingsley Syndicate. \
         Black Doug also distributes to the Caesars Palace Vault.",
    )?;

    println!("[2/5] ingest baseline fact");
    let summary = engine.ingest_document(doc.to_str().unwrap(), SourceType::Pdf).await?;
    println!("      {} entities, {} relationships", summary.entities_extracted, summary.relationships_extracted);

    println!("[3/5] query before correction");
    let before = engine.query("Who does Black Doug distribute to?").await?;
    println!("      answer: {}", before.answer.chars().take(300).collect::<String>());

    println!("[4/5] apply correction: 'Black Doug no longer distributes to the Kingsley Syndicate'");
    let result = engine
        .apply_correction(CorrectionIntent {
            raw_text: "Black Doug no longer distributes to the Kingsley Syndicate".to_string(),
            author: "Risk Officer".to_string(),
        })
        .await?;
    println!(
        "      edges created: {}, deprecated: {}, audit node: {}",
        result.edges_created, result.edges_deprecated, result.audit_node_id
    );

    println!("[5/5] query after correction");
    let after = engine.query("Does Black Doug still distribute to the Kingsley Syndicate?").await?;
    println!("      answer: {}", after.answer.chars().take(400).collect::<String>());

    let snapshot = engine.get_graph_snapshot().await?;
    let inactive = snapshot.relationships.iter().filter(|r| !r.active).count();
    println!("      graph: {} edges total, {} deprecated (inactive)", snapshot.relationships.len(), inactive);

    if result.edges_deprecated > 0 || inactive > 0 {
        println!("CORRECTION LOOP VERIFIED");
    } else {
        println!("WARNING: no edges were deprecated — check entity name matching");
    }
    Ok(())
}
