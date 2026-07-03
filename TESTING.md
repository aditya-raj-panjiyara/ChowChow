# Testing Guide

Three tiers, fastest first. Tiers 1–2 need nothing running; tier 3 exercises
the real cognee + Ollama stack.

---

## Tier 1 — Rust unit & service tests (milliseconds, no LLM)

```bash
cd src-tauri
cargo test
```

Covers:
- **Blast radius engine** — hop ordering, impact decay, deprecated-edge exclusion, unknown-origin errors (`crates/domain/src/blast_radius_service.rs`)
- **Correction lifecycle** — submit → confirm (commits + audit id), double-confirm blocked, reject keeps the audit trail and blocks apply (`crates/domain/tests/services.rs`)
- **Drift Sentinel alerts** — findings become alerts with severity mapping and suggested corrections, newest-first ordering
- **Ingestion jobs** — success records counts + completion, failure records the error message
- **Engine defaults** — engines without semantic memory stay sentinel-silent

## Tier 2 — Frontend unit tests (milliseconds)

```bash
npm test          # or: bun run test
```

Covers `src/pages/GraphExplorer/graphAnalytics.test.ts`:
- The chokepoint of a chain scores highest criticality
- Articulation points flagged as single points of failure; closing the loop un-flags them
- Deprecated (corrected) edges stop counting toward reach/SPOF
- Empty/disconnected graphs, top-N ranking

## Tier 3 — End-to-end against real cognee + gemma4 (minutes)

Requires Ollama running with `gemma4`. Each ingests into an isolated temp
dataset — your app data is never touched.

```bash
cd src-tauri

# Ingest → query round trip, with the live Cognition Trace printed
cargo run -p memory_cognee --example smoke

# Full learning loop: ingest → query → "Update X to Y" correction →
# edge deprecated + replacement created → answer changes
cargo run -p memory_cognee --example correction_smoke

# Drift Sentinel: baseline beliefs → contradicting intel → findings
cargo run -p memory_cognee --example sentinel_smoke
```

Each prints a final `... PASSED` / `... VERIFIED` verdict.

---

## Manual demo checklist (the full arc, in the app)

Start: `bun run tauri dev` — window appears instantly; watch the terminal for
`[memory] cognee-rs engine active`.

1. **Open Cognition Trace** (header button) — keep it open for everything below.
2. **Ingest** — drop `demo_data/vegas_intel_report.txt`, `chow_shipments_erp.csv`,
   `wolfpack_email_chain.txt` into Ingestion. Watch the trace: KnowledgeGraph
   extraction calls, embed batches, graph writes. (Skip if already seeded.)
3. **Graph Explorer** — biggest cards = most depended-on; amber dashed ring =
   single point of failure (expect Black Doug / Port of Long Beach). Hover a
   node → neighborhood spotlight. Critical Dependencies panel → click to fly.
4. **Blast radius** — select Port of Long Beach → "⚡ Trace blast radius from
   here" → hop-by-hop ripple, severity halos, exposure bar → "Full report →".
5. **Query** — ask *"Who supplies Lucky Lotus Powder and how does it reach the
   Wolfpack?"* → answer + clickable reasoning path; the trace shows the actual
   graph-triplet prompt sent to gemma4.
6. **Drift Sentinel** — ingest `demo_data/chow_route_update_email.txt`. Within
   ~a minute, Command Center lights up: "SENTINEL LIVE" + drift alerts.
7. **Close the loop** — expand a drift alert → "Review & apply correction →"
   (lands prefilled) → Confirm & Apply (~1 min, LLM intent extraction) →
   expect `N created, M deprecated`.
8. **Prove the learning** — Graph Explorer: old edge is amber-dashed, the new
   distributor node exists. Re-ask the query from step 5 → the answer changed.

That sequence — ingest → reason → detect drift → correct → provably different
answer — is the judging arc, and every step of it shows in the Cognition Trace.
