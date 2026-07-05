# 🐶 ChowChow

> **The Sovereign Supply Chain Risk Engine**
> 
> *A desktop-native application designed to map, analyze, and protect complex supply chains in a completely local, private environment. Built for the **Cognee** hackathon.*

---

## 💡 Overview

Modern supply chains are highly fragile, opaque, and constantly shifting. A delay at a single port or a failure at a tier-2 supplier can cascade into a catastrophic disruption. **ChowChow** solves this by constructing a local, semantic Knowledge Graph of your supply chain network, automatically identifying single points of failure (SPOFs), and mapping risk propagation.

By leveraging **cognee-rs** (the Rust implementation of Cognee) and local LLMs (via Ollama), ChowChow runs entirely on the operator's machine. None of your sensitive supply chain data, vendor emails, or shipment logs ever leave your local environment.

---

## 🧠 Cognee Integration

Cognee is the memory engine of ChowChow—not just a library we call, but the foundation every feature is built upon. We embedded `cognee-rs` directly in-process inside a Tauri desktop app (no server, no cloud required), wired to a local Ollama LLM and ONNX embeddings, so the entire `remember` → `recall` → `improve` → `forget` lifecycle runs completely on-device.

### How Cognee Primitives Map to Features

*   **`remember()` powers Ingestion:** Every document (ERP CSVs, email chains, intel reports) flows through Cognee's `add` → `cognify` → `embed` pipeline, where the local LLM extracts entities and relationships into Cognee's graph store (Ladybug) and vector store (LanceDB). We resolve Cognee's `is_a`/`EntityType` structure into semantic types to render the visual supply-chain domain graph.
*   **`recall()` powers natural-language Querying:** Auto-routed search with graph traversal produces answers with a visible reasoning path. We layer committed corrections and manual graph edits on top as authoritative context, so answers reflect the current state of belief, not just raw historical text.
*   **`recall()` also doubles as our Drift Sentinel:** After every ingestion, we use `recall`'s semantic retrieval to pull prior beliefs related to the new document and cross-examine them claim-by-claim, turning contradictions into alerts with ready-to-apply corrections.
*   **`improve()` powers Answer Feedback:** Every Q&A pair is saved as a session entry carrying the reasoning-path node IDs as `used_graph_element_ids`. A thumbs-up/down triggers Cognee's four-stage improve bridge: feedback weights propagate onto the exact graph elements that produced the answer, the Q&A is persisted into the graph, and `memify` re-embeds triplets. The memory literally learns from the analyst's judgment.
*   **`forget()` powers the Danger Zone:** Cognee's `DeleteService` cascades a hard delete across relational → graph → vector → file storage, providing a provable "right to be forgotten" with a receipt of exactly what was erased.

### 🛠 Extensibility & Custom Trait Boundaries

Because `cognee-rs` exposes its components as swappable traits, we extended Cognee at its boundaries to drive live observability and error-resilience:
1.  **`LiveGraphDb`:** A decorator around `GraphDBTrait` that intercepts every graph write Cognee makes internally and broadcasts it as an IPC event—allowing users to watch the knowledge graph grow node-by-node in real time with provenance attached to every mutation.
2.  **`TracedLlm` & `TracedEmbedding`:** Wrappers that intercept all LLM prompts and embedding operations, piping them into a live **Cognition Trace** panel.
3.  **Schema-Repair Layer:** A resilient layer inside the LLM interceptor. When the local LLM returns almost-valid structured JSON output (e.g. missing name, wrapper keys, aliased fields), we automatically repair it against Cognee's JSON schema before deserialization, turning pipeline-fatal errors into logged auto-fixes.
4.  **`MutedGraphDb`:** Allows us to `memify` correction statements into vector memory while suppressing graph side-effects to keep the graph topology clean.
5.  **Human-in-the-loop Correction:** Free-text corrections are parsed into `deprecate`/`create`/`retire`/`restore` operations, applied as edge-level surgery (audit-preserved, never deleted), and memified so future retrievals honor the superseding fact.

---

## 🎤 60-Second Pitch & Talk Track

Use this guide to walk through the architecture diagram bottom-up, following the data flow:

> *"Here's how that actually works—one slide, and the data never leaves this box."*

*   **Beat 1 — Sources & Queue (Bottom):** *"Everything starts as messy reality: ERP exports, email chains, PDFs. They land in a queue and get processed one by one—no batch magic, you can watch each document arrive."*
*   **Beat 2 — The Engine (The Core/Middle):** *"Each document flows through Cognee's memory verbs—this is the heart. **Remember** extracts entities and relationships using a local LLM. **Recall** answers questions over that memory. **Improve** re-weights the memory when an analyst rates an answer or corrects a fact. **Forget** erases provably, across every store. We wrapped the engine with our own interceptors—`TracedLlm` and `LiveGraphDb`—so every internal step the AI takes is observable, and broken model output gets repaired instead of crashing the pipeline."*
*   **Beat 3 — Storage (Left Column):** *"Underneath: a graph database, a vector store, SQLite, and the models themselves—all embedded, all on this machine. That's the sovereignty claim, physically."*
*   **Beat 4 — Event Stream (Right Column):** *"And here's the part we're proud of: every write the engine makes broadcasts on a live event stream. That's why you'll see the graph grow node-by-node during ingestion, the trace panel narrate the AI's reasoning, and the topology strip pulse when something drifts. Nothing in this UI is polling—you're watching the memory think."*
*   **Beat 5 — Close the Loop (Top):** *"The analyst isn't just a consumer—corrections and answer ratings flow back down and restructure the memory. It's a loop, not a pipeline."*

#### 💡 Presentation & Demo Tips
1.  **Trace one story, not just the boxes:** *"This CSV → becomes these nodes → contradicts an old belief → raises this alert → analyst fixes it → graph rewires."*
2.  **The 15-second elevator summary:** *"Documents in at the bottom, Cognee memory in the middle, everything stored locally on the left, and a live event stream on the right that makes the UI show the memory working in real time."*
3.  **The Hand-off:** End the architecture slide by switching to the app mid-sentence: *"...and instead of telling you about the event stream, let me show you"* → immediately drop a file on Ingestion with the Graph Explorer open to prove the diagram.

---

## ✨ Key Features

### 1. Ingestion Command Center
Drag and drop unstructured text files, ERP CSVs, and email chains. ChowChow automatically chunks, extracts, embeds, and indexes them into the knowledge graph.

### 2. Interactive Graph Explorer
Visualize the entire supply chain network. 
* **Criticality Scoring:** Automatically ranks nodes by dependency weight.
* **Single Points of Failure (SPOFs):** Graph analytics identify articulation points (e.g. a chokepoint harbor or a single-source distributor) and highlights them with an amber-dashed halo.
* **Spotlight Mode:** Hover over any node to highlight its immediate upstream suppliers and downstream customers.

### 3. Blast Radius Simulator
Simulate disruption cascades:
* Select any node (e.g. *Port of Long Beach* or a supplier facing insolvency).
* Click **Trace Blast Radius** to see the failure cascade hop-by-hop.
* View exposure bars and decay-mapped severity alerts showing exactly which end customers and factories will feel the impact.

### 4. Drift Sentinel (Continuous Verification)
When new documents (like route update emails) are ingested, the **Drift Sentinel** background worker cross-examines the new claims against the existing knowledge graph. If contradictions are found, it generates a **Drift Alert** in the command center.

### 5. Closed-Loop Correction
Resolve drift alerts in one click. ChowChow uses LLM intent extraction to translate natural language updates into structured graph operations—deprecating invalid relationships and creating new nodes/edges to reflect reality.

---

## 📐 Architecture

<img width="968" height="803" alt="image" src="https://github.com/user-attachments/assets/29175bfd-cc4e-42ef-b13f-43d8b3ef0002" />

---

## 🚀 Quick Start

### Prerequisites
1. **Rust:** Install via [rustup](https://rustup.rs/)
2. **Node.js / Bun:** Install Node.js or [Bun](https://bun.sh/)
3. **Ollama:** Install [Ollama](https://ollama.com/) and run the model:
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
