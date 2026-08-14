# Kalaido — Core Concepts

*An orientation to the domain model. This covers the main mechanics and the reasoning behind them; it deliberately leaves out edge cases. Pointers to the full spec appear throughout.*

---

## The idea in one paragraph

You pour raw material into a workspace — emails, notes, Slack messages, commits. Kalaido labels it, then lets you define **synthesised views** over it: "summarise everything tagged *hiring* from the last week." Those views are living things: their inputs keep arriving, so their output would keep changing underneath you. To make them stable enough to read, share, and build on top of, you never look at a view directly. You look at a **Snapshot** — a frozen, approved output with a fixed set of inputs. Almost every rule in the model exists to make that trade work: keep the view alive, keep what you're reading still.

---

## The layers

```
Kalaidoscope (workspace)
   ├── Fragments ──── tagged by ──── Colours
   │        ▲
   │        │ selected by
   │   Context Spec  (+ Window Spec, for Reflections)
   │        │
   │        ▼
   ├── Projections   — synthesis over a set of data
   └── Reflections   — synthesis over a set of data, within a time window
            │
            ▼
        Snapshots    — what you actually read
```

A **Kalaidoscope** is the top-level container — think workspace or project. Everything belongs to exactly one, and nothing ever references across the boundary. It rarely comes up again; assume it's the outer wrapper on everything below.

---

## Inputs: Fragments and Colours

A **Fragment** is one piece of source material — an email, a note, a commit message. Fragments are immutable once ingested. Currently text only.

Every Fragment carries two dates, and the distinction matters more than it first appears:

- **Import date** — when it entered the workspace.
- **Event date** — when the thing actually happened (for an email, when it was sent).

**All time filtering uses the event date.** Import a six-month-old email today and it belongs to last spring, not to this week.

A **Colour** is a tag. Under the hood it's a short LLM prompt that looks at one Fragment and answers yes/no, so "tagged *urgent*" really means "a classifier said yes." Fragments can carry any number of Colours. Classification runs at ingest; you can also backfill a new Colour across existing Fragments, and you can add or remove tags by hand when the classifier gets it wrong.

Colours are never deleted, only **archived** — archiving freezes a Colour in place, preserving existing tags rather than ripping them out from under everything that depends on them. Same instinct as the Snapshot rule: don't disturb what's already been built.

> *Full spec: "Inputs & Classification", plus "Deletion & Retention" for archiving.*

---

## Describing inputs: the Context Spec

A **Context Spec** answers "what goes into this synthesis?" The key property: it's a **rule, not a list**. You say "everything tagged *hiring*, plus all Slack messages," not "these 47 Fragment IDs." That's what lets a view stay alive — new matching Fragments flow in automatically.

You can select:

- **Whole Scope** — everything in the workspace, present and future.
- **Filtered Selection** — by Colour, by Fragment type, and/or by pinning specific Fragments explicitly. The result is the **union** of whatever you specify.

Projections can additionally take **other syntheses as input** — the output of another Projection, or the recent windows of a Reflection. This is how multi-stage summaries work: daily standups feeding a weekly digest, say. Reflections cannot do this; see below.

When a Snapshot is generated, the Context Spec is evaluated into a **Resolved Context** — a concrete, frozen list of exactly which Fragments and which upstream Snapshots went in. The spec is the living rule; the Resolved Context is the receipt. It's what makes a Snapshot reproducible.

> *Full spec: "Context Spec", "Resolved Context".*

---

## The two synthesis types

### Projection

A synthesis over a set of data, with no time dimension. "A running summary of everything about the Q3 launch." It's a container holding: its Context Spec, its current Lens (the prompt — see below), its history of approved Snapshots, and whatever is currently queued for review.

### Reflection

The same, plus a **Window Spec** — a time boundary. "A daily standup," "a weekly retro," "everything in January 2024." A Reflection doesn't produce one output; it produces a **time series**, one Snapshot per window.

Windows come in two shapes:

- **Absolute** — fixed start and end. One window, done.
- **Relative (rolling)** — a repeating grid. Two parameters define it: **Duration** (how far back each window looks) and **Period** (how often a new window is generated).

Duration versus Period is worth internalising, because it determines whether your windows overlap:

| Relationship | Behaviour | Example |
|---|---|---|
| Duration = Period | Tumbling — contiguous, no gaps, no overlap | 24h lookback, every 24h |
| Duration > Period | Overlapping — consecutive windows share data | 7-day lookback, every 24h |
| Duration < Period | Gapped — samples slices, ignores the rest | 1h lookback, every 24h |

Evaluated at generation time, a window becomes a **Resolved Window** — fixed start and end timestamps, stored on the Snapshot forever.

### The one structural rule between them

**Reflections are leaves.** They read Fragments only; they can never consume another Projection or Reflection. Only Projections compose. This is what keeps the dependency graph acyclic — with Reflections unable to consume anything, the only loop the shape permits is Projection → Projection, and those are rejected when you try to save the spec.

> *Full spec: "Window Spec", "Projection", "Reflection". Window versioning and materialisation are the deepest parts of the spec — skip them for now.*

---

## Snapshots: how output actually gets published

Every synthesis produces output through the same three-state lifecycle.

**Preview Snapshot** — a live draft. You're in a chat with the system describing what you want; it generates previews as you iterate. Ephemeral.

**Candidate Snapshot** — produced by the background engine, unprompted, when something upstream changed. A proposal: "here's what this would say now."

**Approved Snapshot** — published, immutable, permanent. The only thing users read and the only thing other syntheses can build on.

How Candidates become Approved is set per entity by its **Approval Policy**:

- **Manual Approval** — the engine pre-computes candidates and queues them; a human approves. *Default for Projections.*
- **Automatic Approval** — candidates are promoted the instant they're generated. *Default for Reflections.*

The defaults follow the use case. A Projection is a considered document you curate; a daily standup should just appear.

Two consequences worth carrying forward:

- **Snapshot history is append-only.** Publishing a new Snapshot doesn't overwrite the old one — the old one is *superseded*, still there, still auditable. For a Reflection, supersession is per window: re-running last Tuesday replaces last Tuesday's output and touches nothing else.
- **Composition binds to specific Snapshots, never to living containers.** When a Projection consumes a Reflection, it locks onto particular Snapshot IDs. Re-resolve that Projection's context tomorrow and you get identical inputs.

> *Full spec: "Snapshot Lifecycle & Approval Policies", "Active Snapshot Resolution Rule".*

---

## Staleness: how change propagates

A synthesis becomes **stale** when something it depends on changes. Roughly:

- a new Fragment arrives matching its Context Spec (or one is deleted, or re-tagged);
- time advances into a new window (Reflections);
- an upstream synthesis publishes something that changes what this one would read.

Two things make staleness safe to reason about:

**Staleness is non-destructive.** A stale entity still shows you its last Approved Snapshot, unchanged. The flag means "a fresher version could be generated," not "what you're reading is invalid." Nothing you're looking at ever disappears or degrades.

**Staleness targets are granular.** For a Projection, the target is the whole entity. For a Reflection, the target is an **individual window**. A backdated Fragment landing in last Tuesday marks *that window* stale and leaves the rest of the series alone.

Staleness clears when a new Approved Snapshot is published for that target — either via the background path (candidate generated, then approved) or interactively (you refine it yourself and approve the preview).

One caveat that's easy to assume otherwise: **nothing self-starts.** The system tracks what's stale and exposes that set; something outside the model — a scheduled job, the UI — has to actually ask for regeneration. An idle workspace stays idle. It keeps serving its last approved output, so this costs freshness, never correctness.

> *Full spec: "Staleness Triggers" (the exhaustive list is long), "Engine Execution & Liveness".*

---

## The machinery underneath

**Lens** — the prompt template that turns inputs into output. Users never write or see these. You have a conversation about what you want; the system **distills** it into a Lens on approval. Lenses are immutable and form a version tree, each pointing at its parent, so you can trace how a synthesis's instructions evolved.

**Artifact** — the generated text itself, bound to a Snapshot alongside its provenance (model, tokens, timestamps).

**Refinement Chat** — the interactive session where all of this happens. Used both when creating an entity and when tweaking one later. You talk, you get previews, you approve, and approval does two things at once: publishes a Snapshot and distills a new Lens for future background runs.

Creating either entity type follows the same four steps: **choose context** (and window) → **refine by chat** → **review previews** → **approve**, which distills the Lens and publishes the first Snapshot.

One rule about Lens updates worth knowing early, since the intuition usually runs the other way: a new Lens applies **forward only**. It regenerates the window you were working on, and governs anything generated from that moment on — but it does *not* sweep back through history. A Reflection's time series will legitimately contain Snapshots made under different Lens versions, which is why each one records the version that produced it.

> *Full spec: "Internal Entities", "Forward-Only Lens Scope Rule".*

---

## What's been left out

Everything above is true but incomplete. The main omissions, so you know they exist:

| Topic | What it covers |
|---|---|
| **Window Spec versioning** | Editing a window appends a version rather than rewriting the grid; the old and new versions overlap briefly at the boundary. The most intricate part of the spec. |
| **Materialised windows** | Which windows on the grid actually exist, why materialisation is permanent, and why ingesting a two-year-old Fragment doesn't generate two years of snapshots. Includes **Window Backfill** for filling in history on demand. |
| **`Last N` resolution** | Exactly which Reflection Snapshots a consuming Projection sees, and how N is clamped when fewer windows exist. |
| **Candidate retirement** | When queued candidates are replaced or invalidated, and the audit log they retire into. |
| **Approval sequence numbers** | Why ordering uses a sequence number rather than a wall-clock timestamp. |
| **Deletion & retention** | Fragment tombstones, Colour archiving, and the restrictions on deleting a synthesis others depend on. |
