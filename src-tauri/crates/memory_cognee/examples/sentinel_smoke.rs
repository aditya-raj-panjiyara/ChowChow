//! End-to-end test of the Drift Sentinel against an isolated dataset.
//!
//! Run with: `cargo run -p memory_cognee --example sentinel_smoke`
//!
//! Flow: ingest a baseline fact → detect_drift on a contradicting document →
//! expect at least one finding with a usable suggested correction.

use memory_cognee::config::CogneeAppConfig;
use memory_cognee::CogneeMemoryEngine;
use memory_engine::{MemoryEngine, SourceType};

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let work_dir = std::env::temp_dir().join("cognee_sentinel_test");
    for sub in ["data", "system", "cache", "sessions"] {
        let _ = std::fs::remove_dir_all(work_dir.join(sub));
    }
    let _ = std::fs::remove_file(work_dir.join("cognee.db"));
    std::fs::create_dir_all(work_dir.join("models"))?;

    // Reuse the cached embedding model.
    for cache in ["cognee_smoke_test/models", "cognee_correction_test/models"] {
        let src = std::env::temp_dir().join(cache);
        if src.exists() {
            for entry in std::fs::read_dir(&src)? {
                let entry = entry?;
                let dest = work_dir.join("models").join(entry.file_name());
                if !dest.exists() {
                    std::fs::copy(entry.path(), dest)?;
                }
            }
            break;
        }
    }

    println!("[1/3] init engine");
    let engine = CogneeMemoryEngine::new(CogneeAppConfig {
        llm_endpoint: "http://localhost:11434/v1".to_string(),
        llm_model: "gemma4".to_string(),
        llm_api_key: "not-needed".to_string(),
        embedding_provider: "onnx".to_string(),
        storage_root: work_dir.clone(),
        dataset_name: "sentinel_test".to_string(),
    })
    .await?;

    let doc = work_dir.join("baseline.txt");
    std::fs::write(
        &doc,
        "Black Doug distributes Lucky Lotus Powder to the Kingsley Syndicate. \
         Lucky Lotus Powder ships through the Port of Long Beach.",
    )?;

    println!("[2/3] ingest baseline beliefs");
    let summary = engine.ingest_document(doc.to_str().unwrap(), SourceType::Pdf).await?;
    println!("      {} entities, {} relationships", summary.entities_extracted, summary.relationships_extracted);

    println!("[3/3] detect_drift on contradicting intel");
    let new_intel = "URGENT network update: Black Doug no longer distributes to the \
                     Kingsley Syndicate — all Kingsley deliveries are now handled by \
                     Fat Jesus Logistics. Lucky Lotus Powder has been rerouted through \
                     the Port of Oakland instead of the Port of Long Beach.";
    let findings = engine.detect_drift(new_intel).await?;

    println!("      {} finding(s):", findings.len());
    for f in &findings {
        println!(
            "      [{}] {} — prior: \"{}\" / new: \"{}\"\n            correction: \"{}\"",
            f.severity,
            f.entity_name.as_deref().unwrap_or("?"),
            f.prior_belief,
            f.new_claim,
            f.suggested_correction
        );
    }

    if findings.is_empty() {
        println!("SENTINEL SMOKE: NO FINDINGS — investigate prompt/model behavior");
    } else {
        println!("SENTINEL SMOKE PASSED");
    }
    Ok(())
}
