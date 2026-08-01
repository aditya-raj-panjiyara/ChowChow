//! Tabular (CSV/TSV) source loading.
//!
//! A spreadsheet is not prose. Handing raw comma-separated bytes to cognee's
//! text pipeline splits it on paragraph boundaries that do not exist, so rows
//! get cut in half and every ~512-token slice costs an LLM extraction call
//! plus a summarization call. A 40 MB export is ~20,000 such chunks —
//! hours of work against a local Ollama for a graph that only ever needed the
//! distinct entities the rows describe.
//!
//! This module streams the file instead and emits a *bounded* number of
//! record-shaped documents: one `column: value` line per row, batched so each
//! document lands as a couple of semantically coherent chunks. Exact duplicate
//! rows — the norm in ERP exports, where one supplier repeats across thousands
//! of line items — are collapsed, because they contribute nothing the first
//! occurrence did not already state.

use std::collections::hash_map::DefaultHasher;
use std::collections::HashSet;
use std::fs::File;
use std::hash::{Hash, Hasher};
use std::io::BufReader;
use std::path::Path;

/// Rows folded into a single `DataInput::Text` document. Sized so one
/// document is a small multiple of the ~512-token chunk window rather than
/// hundreds of chunks.
const ROWS_PER_DOC: usize = 40;

/// Ceiling on distinct rows sent through entity extraction.
///
/// Override with `INGEST_MAX_CSV_ROWS`. Every row past this costs real LLM
/// time, so the default trades exhaustiveness for an ingest that finishes
/// while the user is still watching. Truncation is always reported — never
/// silent.
const DEFAULT_MAX_ROWS: usize = 2_000;

/// 1 MiB read buffer — a 40 MB file is ~40 syscalls instead of thousands.
const READ_BUFFER: usize = 1 << 20;

/// Result of streaming a tabular file.
pub struct TabularLoad {
    /// Record-shaped documents, ready to become `DataInput::Text`.
    pub documents: Vec<String>,
    /// Column names taken from the header row.
    pub columns: Vec<String>,
    /// Data rows actually read off disk (stops early when truncated).
    pub rows_scanned: u64,
    /// Distinct rows carried into the documents.
    pub rows_used: usize,
    /// Rows dropped as byte-identical repeats of an earlier row.
    pub duplicates_skipped: u64,
    /// True when the row budget stopped the read before end-of-file.
    pub truncated: bool,
    /// The row budget this load ran under.
    pub budget: usize,
}

impl TabularLoad {
    /// One-line human summary for the Cognition Trace and the job record.
    pub fn summary(&self, file_name: &str) -> String {
        let mut s = format!(
            "{} rows → {} distinct records in {} documents from {file_name}",
            self.rows_scanned,
            self.rows_used,
            self.documents.len()
        );
        if self.duplicates_skipped > 0 {
            s.push_str(&format!(" ({} duplicate rows collapsed)", self.duplicates_skipped));
        }
        if self.truncated {
            s.push_str(&format!(
                " — stopped at the {}-row budget; raise INGEST_MAX_CSV_ROWS to ingest more",
                self.budget
            ));
        }
        s
    }
}

/// Does this path look like a delimited table we should load row-wise?
pub fn is_tabular(path: &str) -> bool {
    matches!(extension(path).as_deref(), Some("csv" | "tsv" | "tab"))
}

fn extension(path: &str) -> Option<String> {
    Path::new(path)
        .extension()
        .map(|e| e.to_string_lossy().to_lowercase())
}

fn max_rows() -> usize {
    std::env::var("INGEST_MAX_CSV_ROWS")
        .ok()
        .and_then(|v| v.parse().ok())
        .filter(|n| *n > 0)
        .unwrap_or(DEFAULT_MAX_ROWS)
}

fn hash_of(s: &str) -> u64 {
    let mut h = DefaultHasher::new();
    s.hash(&mut h);
    h.finish()
}

/// Stream a CSV/TSV file into bounded, record-shaped documents.
///
/// Blocking — call from `spawn_blocking`, never on an async worker.
pub fn load(path: &str) -> Result<TabularLoad, String> {
    load_with_budget(path, max_rows())
}

/// [`load`] with an explicit row budget, so tests don't have to mutate the
/// process environment.
pub fn load_with_budget(path: &str, budget: usize) -> Result<TabularLoad, String> {
    let delimiter = match extension(path).as_deref() {
        Some("tsv" | "tab") => b'\t',
        _ => b',',
    };

    let file = File::open(path).map_err(|e| format!("cannot open file: {e}"))?;
    let mut reader = csv::ReaderBuilder::new()
        .delimiter(delimiter)
        // Real exports have ragged rows; a hard error on row 40,000 would
        // throw away everything read so far.
        .flexible(true)
        .from_reader(BufReader::with_capacity(READ_BUFFER, file));

    let columns: Vec<String> = reader
        .headers()
        .map_err(|e| format!("cannot read header row: {e}"))?
        .iter()
        .enumerate()
        .map(|(i, h)| {
            let h = h.trim_start_matches('\u{feff}').trim();
            if h.is_empty() {
                format!("column_{}", i + 1)
            } else {
                h.to_string()
            }
        })
        .collect();

    if columns.is_empty() {
        return Err("file has no header row".to_string());
    }

    let file_name = Path::new(path)
        .file_name()
        .map(|f| f.to_string_lossy().to_string())
        .unwrap_or_else(|| path.to_string());
    let column_list = columns.join(", ");

    let mut documents = Vec::new();
    let mut batch: Vec<String> = Vec::with_capacity(ROWS_PER_DOC);
    let mut seen: HashSet<u64> = HashSet::new();
    let mut rows_scanned: u64 = 0;
    let mut rows_used: usize = 0;
    let mut duplicates_skipped: u64 = 0;
    let mut truncated = false;
    let mut first_in_batch: usize = 1;

    for record in reader.records() {
        let record = match record {
            Ok(r) => r,
            // Skip the malformed row rather than abandoning the file.
            Err(e) => {
                eprintln!("[csv] skipping unreadable row {}: {e}", rows_scanned + 1);
                rows_scanned += 1;
                continue;
            }
        };
        rows_scanned += 1;

        // `field: value` pairs, empty cells dropped — a blank column tells the
        // extractor nothing and costs tokens in every chunk it appears in.
        let pairs: Vec<String> = record
            .iter()
            .enumerate()
            .filter_map(|(i, value)| {
                let value = value.trim();
                if value.is_empty() {
                    return None;
                }
                let key = columns.get(i).map(String::as_str).unwrap_or("extra");
                Some(format!("{key}: {value}"))
            })
            .collect();

        if pairs.is_empty() {
            continue;
        }

        let line = pairs.join(" | ");
        if !seen.insert(hash_of(&line)) {
            duplicates_skipped += 1;
            continue;
        }

        rows_used += 1;
        batch.push(format!("{rows_used}. {line}"));

        if batch.len() == ROWS_PER_DOC {
            documents.push(render_doc(&file_name, &column_list, first_in_batch, &batch));
            first_in_batch = rows_used + 1;
            batch.clear();
        }

        if rows_used >= budget {
            truncated = true;
            break;
        }
    }

    if !batch.is_empty() {
        documents.push(render_doc(&file_name, &column_list, first_in_batch, &batch));
    }

    Ok(TabularLoad {
        documents,
        columns,
        rows_scanned,
        rows_used,
        duplicates_skipped,
        truncated,
        budget,
    })
}

/// Wrap a batch of rows in enough context that any chunk cut from it still
/// says where the records came from and what the columns mean.
fn render_doc(file_name: &str, column_list: &str, first: usize, rows: &[String]) -> String {
    let last = first + rows.len() - 1;
    let mut doc = String::with_capacity(rows.iter().map(|r| r.len() + 1).sum::<usize>() + 160);
    doc.push_str(&format!(
        "Records {first}–{last} from {file_name} (columns: {column_list}).\n"
    ));
    for row in rows {
        doc.push_str(row);
        doc.push('\n');
    }
    doc
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn write_temp(name: &str, body: &str) -> String {
        let path = std::env::temp_dir().join(name);
        let mut f = File::create(&path).unwrap();
        f.write_all(body.as_bytes()).unwrap();
        path.to_string_lossy().to_string()
    }

    #[test]
    fn recognizes_tabular_extensions() {
        assert!(is_tabular("/tmp/orders.csv"));
        assert!(is_tabular("/tmp/orders.TSV"));
        assert!(!is_tabular("/tmp/memo.txt"));
        assert!(!is_tabular("/tmp/report.pdf"));
    }

    #[test]
    fn rows_become_labeled_records() {
        let path = write_temp(
            "tabular_basic.csv",
            "supplier,material\nAcme,Copper\nBolt Co,Steel\n",
        );
        let load = load(&path).unwrap();

        assert_eq!(load.columns, vec!["supplier", "material"]);
        assert_eq!(load.rows_used, 2);
        assert_eq!(load.documents.len(), 1);
        assert!(load.documents[0].contains("supplier: Acme | material: Copper"));
        assert!(load.documents[0].contains("columns: supplier, material"));
        assert!(!load.truncated);
    }

    #[test]
    fn identical_rows_collapse() {
        let path = write_temp(
            "tabular_dupes.csv",
            "supplier,material\nAcme,Copper\nAcme,Copper\nAcme,Copper\n",
        );
        let load = load(&path).unwrap();

        assert_eq!(load.rows_scanned, 3);
        assert_eq!(load.rows_used, 1);
        assert_eq!(load.duplicates_skipped, 2);
    }

    #[test]
    fn empty_cells_are_dropped() {
        let path = write_temp("tabular_sparse.csv", "supplier,material\nAcme,\n");
        let load = load(&path).unwrap();

        assert!(load.documents[0].contains("supplier: Acme"));
        assert!(!load.documents[0].contains("material:"));
    }

    #[test]
    fn row_budget_truncates_and_reports() {
        let mut body = String::from("supplier,material\n");
        for i in 0..50 {
            body.push_str(&format!("Supplier {i},Material {i}\n"));
        }
        let path = write_temp("tabular_budget.csv", &body);

        let load = load_with_budget(&path, 10).unwrap();

        assert!(load.truncated);
        assert_eq!(load.rows_used, 10);
        assert!(load.summary("tabular_budget.csv").contains("stopped at the 10-row budget"));
    }
}
