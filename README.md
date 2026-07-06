# ChowChow

> **The Sovereign Supply Chain Risk Engine**
> 
> A desktop-native application designed to map, analyze, and protect complex supply chains in a completely local, private environment. Built for the **Cognee** hackathon.

---

## What is ChowChow?

Modern supply chains are fragile and opaque. A bottleneck at a single port or a sudden insolvency at a tier-2 supplier can trigger a massive cascade of disruptions downstream. ChowChow solves this by constructing a local, semantic Knowledge Graph of your supply chain network. It automatically identifies single points of failure (SPOFs), maps how risks propagate, and simulates real-world crises.

Because it's built using **cognee-rs** (the native Rust implementation of Cognee) and local LLMs via Ollama, ChowChow runs entirely on your own machine. Your sensitive vendor emails, proprietary ERP data, and shipment logs never leave your local environment.

---

## Cognee Integration

Cognee isn't just a third-party API we call—it's the core engine of the entire application. We embedded `cognee-rs` directly in-process inside a Tauri desktop app, connecting it to a local Ollama instance and ONNX embeddings. The entire memory lifecycle runs completely on-device.

### Mapping Cognee Primitives to Features

* **`remember()` powers Ingestion:** Raw files (ERP CSVs, email chains, intelligence reports) flow through Cognee’s `add` → `cognify` → `embed` pipeline. The local LLM extracts entities and relationships into Cognee’s graph store (Ladybug) and vector store (LanceDB). We resolve Cognee's internal `is_a` structures to render our visual domain graph.
* **`recall()` powers natural-language Querying:** Search queries are auto-routed through graph traversals to provide answers alongside a clear, visible reasoning path. We layer manual edits and committed corrections on top as authoritative context, ensuring retrievals reflect current ground truth rather than outdated historical text.
* **`recall()` as our Drift Sentinel:** Every time a new document is ingested, the application uses semantic retrieval to pull prior graph states and cross-examines the incoming data claim-by-claim. Any contradictions are instantly flagged as drift alerts.
* **`improve()` powers Answer Feedback:** Every Q&A pair is saved alongside the exact graph node IDs used to generate it. Giving an answer a thumbs-up or thumbs-down triggers Cognee’s four-stage improvement bridge, propagating weight adjustments back to the exact graph elements responsible for the response.
* **`forget()` powers the Danger Zone:** When you need data wiped, Cognee’s `DeleteService` executes a hard, cascading delete across relational, graph, vector, and file storage, completely clearing the footprint.

### Extensibility & Custom Trait Boundaries

Because `cognee-rs` exposes its core components as swappable traits, we were able to extend its boundaries to handle live observability and edge-case resilience:

1. **`LiveGraphDb`:** A decorator wrapping `GraphDBTrait` that intercepts internal graph writes and broadcasts them as Tauri IPC events. This lets users watch the knowledge graph build itself node-by-node in real time.
2. **`TracedLlm` & `TracedEmbedding`:** Wrappers intercepting all LLM prompts and embedding operations, piping them directly into a live Cognition Trace panel for debugging.
3. **Schema-Repair Layer:** Local LLMs can sometimes output slightly malformed JSON. We built a resilient interceptor layer that catches these near-misses and automatically repairs them against Cognee’s expected schema before deserialization, preventing pipeline crashes.
4. **`MutedGraphDb`:** A specialized wrapper that allows us to `memify` correction statements into vector memory while intentionally suppressing graph side-effects to keep our visual topology clean.
5. **Human-in-the-loop Correction:** Free-text human corrections are parsed into `deprecate`/`create`/`retire`/`restore` operations and applied as edge-level adjustments to maintain a clean historical audit log.

---

## Key Features

### 1. Ingestion Command Center
Drag and drop unstructured text files, ERP logs, or email threads. ChowChow automatically handles chunking, entity extraction, and vector indexing on the fly.

### 2. Interactive Graph Explorer
Visualize your entire supply chain network. 
* **Criticality Scoring:** Automatically ranks nodes by their dependency weight.
* **SPOF Detection:** Identifies critical chokepoints (like a single-source distributor or bottleneck harbor) and highlights them with an amber-dashed halo.
* **Spotlight Mode:** Hover over any node to isolate its immediate upstream suppliers and downstream customers.

### 3. Blast Radius Simulator
Simulate disruption cascades across your network. Select a vulnerable node (e.g., a port facing a strike or a supplier facing insolvency) and trigger a blast radius trace to watch the failure propagate hop-by-hop, highlighting exposure levels and severity risks for end customers.

### 4. Drift Sentinel (Continuous Verification)
A background worker that cross-examines incoming documents against established facts in the knowledge graph. If an incoming email contradicts an existing route or relationship, it surfaces a drift alert in the UI.

### 5. Closed-Loop Correction
Resolve data drift with a single click. ChowChow extracts intent from natural language updates and translates them into structured graph mutations—deprecating invalid relationships and establishing new paths seamlessly.

---

## Architecture

<img width="968" height="803" alt="Architecture Diagram" src="https://github.com/user-attachments/assets/29175bfd-cc4e-42ef-b13f-43d8b3ef0002" />

---

## Quick Start

### Prerequisites
1. **Rust:** Install via [rustup](https://rustup.rs/)
2. **Node.js / Bun:** Install Node.js or [Bun](https://bun.sh/)
3. **Ollama:** Install [Ollama](https://ollama.com/) and download the required model:
   ```bash
   ollama run gemma4
   ```

### Installation
1. Clone the repository and install dependencies:
   ```bash
   bun install   # or: npm install
   ```
2. Set up your environment files (optional, for Google integration):
   ```bash
   cp .env.example .env
   ```
3. Start the application in development mode:
   ```bash
   bun run tauri dev   # or: npm run tauri dev
   ```

---

## 🧪 Testing

The codebase includes a three-tier testing strategy:

```bash
# Tier 1: Rust unit & service tests (no LLM required)
cd src-tauri && cargo test

# Tier 2: Frontend unit tests (graph analytics, SPOF detection)
bun test   # or: npm test

# Tier 3: E2E smoke tests against real Cognee + Ollama
cd src-tauri
cargo run -p memory_cognee --example smoke             # Ingest & Query
cargo run -p memory_cognee --example correction_smoke  # Feedback loop
cargo run -p memory_cognee --example sentinel_smoke    # Drift detection
```

For more testing details, see [TESTING.md](file:///Users/adityarajpanjiyara/projects/AwsmThreesome/TESTING.md).

---

## 📽 Demo Walkthrough (The Golden Path)

To experience the full capability of ChowChow and Cognee:

1. **Open Cognition Trace:** Click the trace icon in the header to view live pipeline logs.
2. **Ingest Seed Data:** Go to *Ingestion* and upload `demo_data/vegas_intel_report.txt` and `chow_shipments_erp.csv`. Watch the trace capture LLM entity extraction and vector writes.
3. **Analyze SPOFs:** Open *Graph Explorer*. Notice the amber-dashed halo around **Port of Long Beach** (detected SPOF).
4. **Simulate a Crisis:** Click on *Port of Long Beach* and select **Trace blast radius**. See the impact cascade across the network.
5. **Query the Graph:** Go to *Query* and ask: *"Who supplies Lucky Lotus Powder and how does it reach the Wolfpack?"* View the answer and its reasoning path.
6. **Detect Drift:** Ingest `demo_data/chow_route_update_email.txt` (states shipment routes have changed). Check the Command Center for a **Drift Sentinel Alert**.
7. **Apply Correction:** Click **Review & apply correction**. Confirm the change. Cognee will deprecate the old path and establish the new route.
8. **Verify Learning:** Re-run your query from Step 5. Notice that the answer has successfully updated to reflect the new route!
