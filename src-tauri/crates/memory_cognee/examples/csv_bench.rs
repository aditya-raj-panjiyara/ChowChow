//! Measure the tabular loader against a real file.
//!
//! `cargo run -p memory_cognee --example csv_bench --release -- <path> [budget]`

fn main() {
    let mut args = std::env::args().skip(1);
    let path = args.next().expect("usage: csv_bench <path> [budget]");
    let budget: usize = args.next().and_then(|b| b.parse().ok()).unwrap_or(2_000);

    let started = std::time::Instant::now();
    let load = memory_cognee::tabular::load_with_budget(&path, budget).expect("load");
    let elapsed = started.elapsed();

    let file_name = std::path::Path::new(&path)
        .file_name()
        .map(|f| f.to_string_lossy().to_string())
        .unwrap_or_else(|| path.clone());

    println!("{}", load.summary(&file_name));
    println!("elapsed: {elapsed:?}");
    println!(
        "documents: {} · total chars: {}",
        load.documents.len(),
        load.documents.iter().map(String::len).sum::<usize>()
    );
    if let Some(first) = load.documents.first() {
        let preview: String = first.lines().take(3).collect::<Vec<_>>().join("\n");
        println!("--- first document ---\n{preview}");
    }
}
