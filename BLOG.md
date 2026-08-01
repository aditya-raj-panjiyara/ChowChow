# Deprecate, Don't Delete

### What building a self-correcting supply-chain brain taught us about belief

---

There is a particular dread that belongs to anyone who has been confidently, thoroughly wrong. Not wrong about something trivial — wrong about a *load-bearing* fact. You built the plan around it. You told other people. And then, quietly, without announcement, the fact stopped being true, and you went on acting as if it hadn't.

Most of the interesting problems in memory are versions of this dread. How do you hold a belief firmly enough to act on it, but loosely enough to drop it when the world changes? How do you notice that the world *has* changed before it's too late? And when you finally update — do you erase the old belief, or keep it around as evidence of who you used to be?

We spent a stretch of time building a desktop application called **ChowChow**, and somewhere along the way we realized we weren't really building supply-chain software. We were building a small, externalized model of an agent that can be wrong and recover — and nearly every engineering decision turned out to be a disguised version of one of those human questions.

This is the story of the machine, and the ideas it kept bumping into.

---

## The premise, and a man jumping out of a window

ChowChow reads documents — ERP spreadsheets, email chains, intelligence memos — and assembles them into a **knowledge graph**: a web of entities (suppliers, ports, warehouses, customers) connected by relationships (*ships_via*, *distributes_to*, *fulfills*). Once the graph exists, you can ask it questions, find its weak points, and simulate what happens when one node fails.

To make the demo memorable, we populated it not with a sterile fictional corporation but with the supply chain of **Leslie Chow** — the chaos agent from *The Hangover* — running an entirely illicit logistics empire: Lucky Lotus Powder moving from the Golden Tiger Warehouse in Bangkok, through the Port of Long Beach, to a cast of characters known collectively as the Wolfpack. It is funnier than a diagram of widget flows, and it does exactly the same job.

Everything runs locally. The reasoning model is a local LLM. The graph and vector stores sit on your disk. Chow's data — like a real enterprise's vendor margins and shipping routes — never leaves the machine. That constraint, "sovereignty," is not decoration; as you'll see, it shaped some of the most interesting decisions.

The engine underneath is **cognee** (specifically `cognee-rs`, its Rust implementation), embedded directly in-process inside a Tauri app. And the very first real decision we made was about how to relate to it.

---

## The one-way mirror: observe without disturbing

When you build on top of somebody else's engine, you face a temptation: to open it up. Fork it, patch it, reach inside and rewire the parts you want to change. It feels like control. It is almost always a mistake — the moment you modify the thing, you own its bugs, you fall off its upgrade path, and you can no longer tell which failures are yours.

There's an older, quieter move available. Don't change the engine. *Wrap it.*

cognee exposes its internals as **traits** — Rust's version of interfaces, contracts that say "anything shaped like this will do." Its graph database is one trait. Its language model is another. Its embedding engine is a third. Because they're traits, we could slip a thin layer of our own *in front* of each one, a layer that forwards every call to the real thing untouched but takes note of what passed through.

The pattern has a name in software — the *decorator* — but the honest metaphor is a one-way mirror. On cognee's side, nothing looks different; it makes its calls and gets its answers exactly as before. On our side, we can watch everything.

We built three of these mirrors:

- **`TracedLlm`** sits in front of the language model. Every prompt cognee sends, every completion it gets back, is copied out to a live panel we called the **Cognition Trace** — the actual conversation between the engine and the model, streaming in real time.
- **`TracedEmbedding`** does the same for the embedding engine: every batch of text turned into vectors, its size, a sample, the timing.
- **`LiveGraphDb`** wraps the graph database itself. Every node and every edge cognee writes — the instant it lands — is broadcast out.

That last one is why, when you drop a document into ChowChow and switch to the graph view, you don't see a spinner and then a finished diagram. You see the graph *build itself*: nodes springing into place one at a time, each wearing a green halo that says **EXTRACTED**, edges drawing themselves between entities as the model reads the text and realizes they're connected. Nothing is faked or replayed. You are watching cognee think, through a mirror it doesn't know is there.

The human version of this trick is underrated. The best way to understand a system you don't control — a colleague, a market, a mind, including your own — is rarely to pry it open. It's to instrument the boundary. Watch what goes in and what comes out, faithfully, without interfering, and understanding accumulates on your side of the glass while the system carries on undisturbed.

---

## Belief has a blast radius

A knowledge graph is, in the end, a structure of *dependencies*. And the first genuinely useful thing you can ask of any dependency structure is: **where is it fragile?**

Not everything in a network matters equally. Some nodes are leaves — lose them and nothing downstream notices. Others are chokepoints — the single road every shipment crosses, the sole distributor between a supplier and its customers. There's a lovely, exact idea from graph theory for this: an **articulation point**. A node is an articulation point if removing it *disconnects* the graph — if pulling it out doesn't just weaken the network but splits it into pieces that can no longer reach each other. It is, precisely, a load-bearing wall.

ChowChow finds these automatically, using a classic algorithm (Tarjan's) that sweeps the graph once and marks every articulation point. In the interface, those nodes get an amber, pulsing, dashed ring and a blunt label: **SINGLE POINT OF FAILURE**. In Chow's network, the ring lands on Black Doug and the Port of Long Beach — and it's correct. They are exactly the nodes whose loss would sever the operation. The math agrees with the intuition, which is how you know the math is measuring the right thing.

But structure is only half the story. The other half is *propagation* — when a shock hits, how far does it travel, and how much damage does it do along the way?

For that, ChowChow runs a **blast radius** simulation. Pick a node — say, the Port of Long Beach faces a customs crackdown — and the engine does a breadth-first walk outward through the graph, hop by hop. The clever part is a single number: each hop, the impact **decays** by a constant factor (we used 0.75), and once it drops below a floor, the walk stops. This is not arbitrary. It encodes a truth about cascading failure: shocks weaken with distance, buffered by inventory and slack at every step, until somewhere out in the network they fade below the level anyone would notice.

On screen, the failure *ripples*. The origin pulses red. Affected nodes light up in waves — first the direct neighbors, then theirs — each stamped with an impact percentage and a severity color, the propagation edges glowing and flowing while everything untouched fades to grey. You are watching a disruption spread through a supply chain the way you'd watch dye spread through water.

The idea generalizes far past logistics, which is why it's satisfying. Epidemics have a blast radius. So do rumors, financial contagion, and the consequences of a single bad decision. The two questions ChowChow asks of a graph — *what can't we afford to lose,* and *how far does a shock travel* — are the two questions worth asking of any network you depend on, including the invisible one made of the people and systems your own life quietly rests on.

---

## The keyword trap

Here is where the project taught us something by breaking.

The whole point of ChowChow is that it can be *corrected*. The world changes; a route moves; a supplier gets replaced. A human should be able to tell the graph, in plain English, "this is no longer true," and the graph should update. We built that. And for a while, it quietly did nothing.

The first version was seduced by a shortcut. To decide what a correction *meant*, it scanned the text for negation words — "no longer," "stopped," "cut off." See a negation between two entities the correction mentions, deprecate the link between them. It felt reasonable. It handled *"Black Doug no longer distributes to the Kingsley Syndicate"* perfectly.

Then the app's own drift detector started generating corrections phrased like a competent analyst: *"Update the primary distributor for the Kingsley Syndicate to Fat Jesus Logistics."* No negation word anywhere. The keyword scanner shrugged, found nothing to do, and reported — with a completely straight face — *"0 edges created, 0 deprecated."* The correction was logged, audited, and utterly inert. The graph never changed.

This is the **keyword trap**, and it is one of the oldest failure modes in artificial intelligence: mistaking the *surface form* of language for its *meaning*. "Update X to Y" and "X no longer, now Y" are the same instruction wearing different clothes. A system matching words instead of intent sees two unrelated strings. The shortcut works on your examples and fails on reality, because reality doesn't restrict itself to your examples.

The fix was to stop pattern-matching and start *understanding*. We hand the correction to the language model along with the graph's actual vocabulary of entities, and ask it to return **structured operations** — which relationships to deprecate, which to create, which new entities to introduce. "Update the Kingsley distributor to Fat Jesus Logistics" comes back as: *deprecate* the Black Doug → Kingsley edge, *create* a Fat Jesus Logistics → Kingsley edge, and — because Fat Jesus Logistics didn't exist in the graph yet — *bring that node into being*. The keyword heuristic stayed on as a fallback for when the model returns nothing, so a flaky moment degrades to "did less" rather than "did the wrong thing." But the meaning now comes from a system that reads for meaning.

The lesson has a long echo. Whenever something is easy to fake with a shallow rule, the rule will eventually meet an input that shares none of the surface and all of the substance, and it will confidently do nothing. The words are not the meaning. They never were.

---

## Deprecate, don't delete

Now the central idea — the one we ended up naming the whole essay after, because it turned out to be both an engineering principle and something closer to a small piece of wisdom.

When ChowChow applies a correction, it does not delete the old relationship.

It could. The old edge is wrong now; the tidy instinct is to remove it and move on. But ChowChow marks it **deprecated** instead — sets a flag, `active = false`, and leaves the edge exactly where it was. In the graph view it doesn't vanish; it turns amber and dashed, a visible ghost of a fact that used to be true. Alongside it, the engine writes an **audit node** into the graph itself: a permanent record of who made the change, when, and why. And it *memifies* the correction — writes the new, superseding fact into cognee's semantic memory through the same ingestion path any document takes, so future retrievals encounter it as current truth.

There's an immediate practical payoff. Retrieval alone can still surface an old, pre-correction chunk of text buried in memory, so on every query we inject the committed corrections as an **authoritative overlay** — the superseding facts ride along with the question and win at answer time. Ask *"Who distributes to the Kingsley Syndicate now?"* after the correction, and the answer is "Fat Jesus Logistics," even though the original document still says otherwise. The old text isn't erased; it's *overruled*, on the record.

This is Bayesian belief-updating with one crucial refusal: **it will not commit amnesia.** A correct reasoning system, human or machine, doesn't overwrite its past beliefs when the evidence turns. It *supersedes* them and keeps the trail — because the trail is what lets you answer the questions that matter later. Why did we believe the old thing? What changed? Who signed off? A system that deletes its mistakes can never learn from the *shape* of its mistakes, only from the current state, and it can never prove to anyone — an auditor, an insurer, a future version of itself — that it changed for a reason.

"Deprecate, don't delete" is why version control keeps your ugly old commits, why good organizations write postmortems instead of quietly patching, why the honest move when you change your mind is to say *"I used to think X; here's what changed"* rather than to pretend you always thought Y. The past belief wasn't noise. It was a data point about how you come to be wrong, which is exactly the thing worth studying. Mark it superseded. Keep it visible. Move forward with the receipt in hand.

---

## The sentinel: noticing before you're told

Correcting a belief when someone points out the error is good. Noticing the error *yourself* — actively going looking for the contradiction before anyone forces it on you — is rarer and more valuable, and it's the capability we're proudest of.

After every ingestion, a background process we call the **Drift Sentinel** wakes up and does something subtle. It uses cognee's own semantic retrieval — the `recall` machinery normally used to answer questions — as a **cross-examiner**. It takes the freshly ingested document and asks memory: *what prior beliefs are most related to this?* Semantic search is exactly the right tool for that job; it pulls the old facts a new claim might collide with, the way a good auditor instinctively flips to the page most likely to contradict the one in front of them. Then the language model compares them, claim by claim, and reports genuine contradictions — not new detail, not elaboration, but places where the new intel and the old memory cannot both be true.

Ingest a memo saying Chow rerouted production from Bangkok to Macau, and within a minute the Command Center lights up: *memory believed Lucky Lotus Powder originates at the Golden Tiger Warehouse, but new intel says production moved to the Macau Lotus Facility.* Crucially, each alert arrives with a **ready-to-apply correction** already drafted — one click from flagged to fixed, straight into the deprecate-don't-delete machinery from the last section.

What makes this worth dwelling on is the reuse. We didn't build a separate contradiction-detection engine. We pointed the *retrieval* system — the thing built to find what's relevant — at the job of finding what's *inconsistent*, and it turns out those are close cousins. Relevance is "what relates to this?" Contradiction is "what relates to this *and disagrees*?" One is a filter on the other.

The human skill this mirrors is the one almost nobody has: manufactured self-doubt. Most minds, having formed a belief, spend their retrieval budget confirming it. The rare and useful move is to spend that budget *hunting for the belief's enemies* — to pull up, on purpose, the evidence most likely to prove you wrong, and look at it squarely. ChowChow does this automatically, on every new document, forever. It is a machine built to go looking for the ways it might already be mistaken.

---

## How systems stay standing: graceful degradation

One more thread, quieter than the others but running underneath everything, and it's about what happens when things go wrong that *aren't* about belief at all — when a piece of the machine simply isn't there.

Three times during this build, a dependency we assumed would be present turned out not to be, and each time the right answer was the same: **bend, don't break.**

First: cognee's production reasoning engine needs a working setup, and if it can't initialize — the local model isn't running, say — the naive design would refuse to start. ChowChow instead falls back to a simpler built-in engine and logs *why*, so the app always launches and always tells you honestly what mode it's in. Degraded, but standing.

Second: we assumed the local Ollama server would provide text embeddings, the way it provides completions. On the target machine, it didn't — that particular server was built to generate text but not to embed it. Rather than declare the machine unsupported, we moved embeddings *in-process*, running a small ONNX model (BGE-Small) directly inside the app. This turned out *more* sovereign, not less — one fewer external dependency, one less thing that has to be running. A constraint, absorbed, became an improvement.

Third, and my favorite: initializing the real engine is slow the first time, because it downloads that embedding model. The obvious design blocks the window until it's ready, and the user stares at nothing, wondering if the app is broken. We restructured it so the window appears **instantly** on the simple fallback engine, while the real one initializes in the background and — the moment it's ready — is **swapped in atomically** underneath the running application. In Rust terms, the engine lives behind a lock (`RwLock<Arc<dyn MemoryEngine>>`) so it can be replaced live, mid-flight, without the commands that use it ever noticing the substitution. You start working immediately on the modest brain; the better brain slides into place beneath you while you do.

The principle here is one every robust system and every functional person eventually learns. The goal is not to guarantee that nothing ever fails — that guarantee is unavailable, to software and to people alike. The goal is to fail *softly*: to keep the essential thing working when a piece goes missing, to substitute what you can, to tell the truth about what mode you're in, and never to let one absent part take down the whole. A system that only works when everything works, doesn't, for long. A system that bends around its missing pieces stays standing long enough to get them back.

---

## What we were actually building

Step back from the supply chain and the drug jokes and the Rust, and look at what ChowChow actually is.

It ingests evidence and forms beliefs. It shows its work — you can watch it think, and every belief it holds carries a record of where it came from and why. It runs its beliefs forward to find its own weak points and simulate its own failures. When new evidence contradicts what it thought, it *notices*, on its own, and updates — without ever erasing the belief it's leaving behind, keeping the whole trail as evidence of how it came to change its mind. And when a piece of it goes missing, it bends instead of breaking.

That is not, particularly, a description of good supply-chain software. It's a description of a good *epistemic agent* — the kind of reasoner you'd want to be, or to employ, or to trust with a decision that matters. We set out to map Chow's logistics and ended up, almost by accident, building a small working sketch of intellectual honesty: hold your beliefs firmly, wear their provenance openly, hunt for their contradictions eagerly, and when you're finally proven wrong, deprecate — don't delete.

The machine is easier to build than the habit. But it turns out the machine is a decent teacher, because every shortcut it tried to take was one we recognized. The keyword trap is the temptation to match words instead of meaning. The urge to delete the old edge is the urge to pretend you were never wrong. Blocking the window until everything's perfect is the refusal to start until you have every answer. We didn't invent these mistakes. We just watched them fail, in fast-forward, through a one-way mirror — and fixed them one at a time.

*Deprecate, don't delete.* It's a good rule for a graph database. It's a better rule for a mind.
