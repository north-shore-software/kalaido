---
name: generate-audit-docs
description: Generates or regenerates the kalaidoscope audit snapshot docs (kalaidoscope/docs/*.md) from source code, preserving the series' purpose (auditable description of actual behaviour), its stable formats, and the regeneration regime defined in kalaidoscope/AGENTS.md. Encodes process and conventions only — never code facts.
---

# Skill: Generate Audit Docs

Use this skill when asked to generate or regenerate any audit snapshot in `kalaidoscope/docs/`, or to add a new doc to that series. These docs exist so a human can audit the system's intended functionality without reading the code; they are produced by agents, reviewed by the human, and corrected only through code changes followed by regeneration.

## Core Directives

1. **Purely descriptive**: Document the code exactly as it is. No spec comparisons, no divergence flags, no recommendations, no design commentary in the doc. Behaviours worth the auditor's attention (silent failures, one-way checks, missing surfaces) are pointed out in *chat* while writing — never in the doc.
2. **Wholesale from source**: A generation reads the current code and rewrites the entire file. Never reuse the previous generation's content — only its section skeleton. Never patch a doc incrementally, and never "fix" one outside a requested regeneration.
3. **Structure-stable**: Preserve the existing doc's section skeleton (numbering, table shapes, header block) so successive generations diff cleanly. For a new doc, design a skeleton meant to survive many regenerations.
4. **Ground every claim**: State a behaviour only after reading the code that implements it in this generation — handlers, the engine/worker code they call, hook bodies. Wire and field names come from struct tags and the *actually bound* request structs (handlers may bind anonymous structs that differ from declared DTOs; the bound fields are the contract). Nothing comes from memory, prior docs, or exploration summaries.
5. **Harvest hand edits first**: The human requests design changes by editing these docs. Before regenerating, diff-read the current file: if it contains hand edits (anything a prior generation would not have produced), report them to the user as pending design requests and stop for direction — regenerating over them destroys them silently.
6. **Verify mechanically**: Enumerable facts (route registrations, hooks, collections, files) are re-derived by searching the source at generation time, then cross-checked against the finished doc — every hit must appear, and stated counts must match the fresh search, not any earlier one. Each doc's header states its completeness anchor so the audit can re-run the same check.
7. **Respect the regime**: `kalaidoscope/AGENTS.md` governs these files. Regeneration is human-initiated only. It removes the stale marker, refreshes the `Generated:` date and source commit, and touches nothing else about the file's contract.

## The doc series

The series describes the Go backend binary (`kalaidoscope/`) only: the sidecar's HTTP surface, database, background work, and model-facing behaviour. Client code is out of scope.

**Surface docs**

| Doc | Covers | Primary source roots |
|---|---|---|
| `api.md` | Every custom HTTP route and hook-modified collection endpoint, auth posture, wire/error conventions. A route index: the behaviour column points at the owning domain doc rather than re-explaining mechanics. The aggregate status route is indexed here as a composition of per-domain axes, each described in its own doc's status section | Route-registration sites in `server/`; provider-owned route registrations under `llm/providers/`; `internal/handlers/`; `internal/api/`; hook registrations |
| `schema.md` | Collections, fields, indexes, access rules, stored-JSON shapes, cascades, migration mechanics | `schema/` (canonical, baseline, deltas); boot-time schema assertions |
| `boot-and-workers.md` | The asynchronous index: boot order, the worker manager and every background goroutine it owns with its trigger (signal, hook, interval, settle callback), drain/retry semantics, startup sweeps and boot kicks, deferred work (one-shot after-pass callbacks, the detached-task runner), shutdown draining. Domain behaviour of each worker stays in its own doc | `cmd/`; `server/` (runtime, triggers, routes); `internal/workers/`; `internal/workerutil/`; every `Register`/`OnServe` site |

**Entity lifecycle docs**

| Doc | Covers | Primary source roots |
|---|---|---|
| `lifecycle-projection.md` | Projection-specific lifecycle: creation, authoring, generation claims, hand edits, approval, soft deletion and restore | `internal/projections/`; `internal/engine/` (claims, strategy, snapshot, lifecycle); `internal/pbutil/` liveness; projection handlers |
| `lifecycle-reflection.md` | Reflection-specific lifecycle: schedule editing, windowed generation, backfill, pending-window pass, per-window approval, soft deletion and restore | `internal/reflections/` (lifecycle, backfill, cadence); `internal/engine/`; `internal/pbutil/` liveness; reflection handlers |
| `windows.md` | Reflection window calculation: spec versioning, tiling, identity, per-window staleness | `internal/reflections/` window and spec code; window wire types in `internal/api/` |

**Shared machinery docs**

| Doc | Covers | Primary source roots |
|---|---|---|
| `refinement.md` | The refinement conversation shared by projections and reflections: session seeding, lens drafting via tool call and its invariants, the window-reapply leg, the from-scratch preview leg, commit; the lens row (immutability, lineage, stamping on snapshots) and active-lens resolution | `internal/refinement/`; `internal/engine/` lens and commit code; `internal/chat/` (shared persistence, hydration and stream helpers); refinement handlers |
| `context.md` | The context spec as shared machinery: resolution to pinned fragment/snapshot ids, hydration to model text (flat vs summaries), the pinned receipt on snapshots and its diff for staleness, token estimate/guard | `internal/llmcontext/`; `internal/sourcedata/` (read-only accessors); guard error types in `llm/` and their call sites |
| `reconcile.md` | Shared freshness machinery: staleness evaluation across the dependency graph, per-window evaluation for reflections, reconcile waves and every entry point that starts one, the in-process wave state published on the wire, the wave's status axis and the surfaced wave policy flag | `internal/reconcile/` (evaluator, worker); reconcile handlers |
| `models.md` | Model selection: registry (model sets, roles, provider per model, per-role generation options), workspace config record (boot load, update hooks, validation), provider preflight and validation routes, role resolution with overrides, local-model status/pull/preload | `llm/` (registry, selector, provider interface); `llm/providers/`; `internal/config/` |
| `llm-queue-quota.md` | The LLM call runtime: scheduler (priorities, admission, preemption, throttle back-off, progress, published status and its held reason), per-call usage recording and period quota with its exhaustion response, provider error classification and wire envelope, request/failure logging | `llm/queue/`; `llm/quota/`; `internal/usage/`; `llm/` errors and trace; `httpx/`; queue-status publication in `server/` |
| `prompts.md` | Inventory of every prompt template: consuming flow, model role, interpolated inputs, shared blocks; tool schemas at their declaring sites. Never the prompt text itself | `internal/prompts/`; tool declarations wherever they live (follow the code) |
| `tool-loop.md` | The shared model tool loop and the read tools built on it: rounds and their cap, dispatch, the stop rules, how tool calls and results are echoed back into the transcript, the tool-schema helpers; the map reader (its read tools, budget, and the two ways it is constructed) as the shared read surface over the map. Consumers (discover, explore) describe only what they bind and how they use the result | `internal/agent/`; `internal/mapreader/` |

**Flow docs**

| Doc | Covers | Primary source roots |
|---|---|---|
| `ingestion.md` | How content becomes fragments: entry paths, parsers, writer, birth hooks and what they signal, soft delete; the post-import pipeline that sequences mapping then discover (emitted here, so described here); the imports status axis | `internal/ingest/` (+ parsers, pipeline, status); fragment hook registrations |
| `map.md` | The map flow: per-fragment annotation worker and pending set, aggregate/settle loop and consolidate-due rule, whole-scope consolidation of the things document, document shape and version/run records, kick route, settle callbacks; the map status axis (every state and the rule that selects it, which facts come from rows and which from in-flight flags, how a crash leftover is reported as interrupted) | `internal/mapping/`; `internal/mapdoc/` |
| `colours.md` | Colours: colour rows and prompt, the materialised membership join and its match-type precedence, preview and create-time seeding, the judging worker and its watermark and examples, thing rematch on settle and on demand, per-colour provider-error recording, delete-time scrubbing from specs; the colour status axis | `internal/colour/`; colour handlers |
| `discover.md` | The discover flows: run record and states, the tools each flow binds to the shared loop (`tool-loop.md`), the flow kinds and their order, what each proposes vs creates, rhythm detection for reflections, kick/retry behaviour, handoff to refine; the discover status axis (due, pending, interrupted, proposal counts) | `internal/discover/`; `internal/sourcedata/` reads |
| `explore.md` | The explore conversation: persistence, mention expansion, per-turn model resolution, stream shape, token guard; the summaries mode (selection by spec, seeding rows and map digest, the read tools it binds from `tool-loop.md`, read persistence and replay); bookmarks and their save-as-fragments, the projection brief, the conversation form of the prompt estimate | `internal/explore/`; `internal/chat/` (shared persistence, hydration and stream helpers); `internal/llmcontext/` summaries code; explore handlers |

**Cross-cutting docs**

| Doc | Covers | Primary source roots |
|---|---|---|
| `coordination.md` | The system as one state machine, which no single package names or owns: every unit of background work (an annotation drain, a consolidation, a colour drain, a discover run, a reconcile wave, a single generation claim) with the durable state that represents it and the in-process state layered on top, and how each begins, ends, is superseded, is abandoned, or is taken over after a crash; the worker manager as the choreographer between requests and workers; the signal/callback graph between workers; what the wire surfaces about in-flight work; and, above all, the interaction matrix — every user-initiated action (generate, approve, edit, commit a refinement, delete, restore, import, change config, start or stop a wave) crossed with every kind of work that may be in flight, and the outcome of each pairing: joined, queued behind, cancelled, pre-empted, invalidated before write, written then superseded, refused, or unaffected. Cells state outcomes and point at the owning doc for the mechanism; nothing is re-explained | `internal/workers/`; `internal/workerutil/`; `internal/engine/` claims and liveness; the run loops and cancel/pre-empt paths in `internal/reconcile/`, `internal/mapping/`, `internal/discover/`, `internal/colour/`, `internal/reflections/`; `llm/queue/` pre-emption; `internal/usage/` stream interruption; the request-side entry points in `internal/handlers/` |

Shared, entity-agnostic machinery gets its own doc; the lifecycle docs stay per-entity and point to it, and a per-entity asymmetry inside a shared mechanism is stated once, in the shared doc. A signal or callback between subsystems (a worker kicked by a hook, a settle callback another package subscribes to) is described once, in the doc of the *emitting* side; the receiving doc names the trigger and points there. Source roots above are discovery seeds, not boundaries — follow the code wherever it goes; when a package in the table has moved or been split, find its successor by the mechanism it implemented and update the table.

**Cross-cutting vs mechanism docs.** `coordination.md` cuts across the series by *interaction* rather than by mechanism. The mechanism docs own the pieces (a claim row, a signal, a settle callback, a cancel) and each states its own local rule once; the coordination doc owns what happens when pieces meet — which check fires, in what order, and what the user observes. A mechanism doc says what a check does; the coordination doc says when it is reached and what outcome it produces. When a new kind of work or a new user action appears, the coordination doc gains a row or column; the mechanism doc gains the mechanism. If a regeneration finds an interaction the code handles but the matrix has no cell for (or a cell the code no longer handles), that is the finding to report in chat.

**Retirement.** When the mechanism a doc describes no longer exists in source, the doc is retired: it is not regenerated as empty or as a description of its replacement. Retirement is reported to the user, the series table here and in `kalaidoscope/AGENTS.md` is updated, and the file is deleted (the human commits the deletion). Retired so far: `lens-distillation.md`, whose subject was replaced by the refinement conversation described in `refinement.md`. Retirement pending (file still on disk): `organize.md` — the organise concept no longer exists as a unit in source; its post-import pipeline now belongs to `ingestion.md`, and the status it served is now an aggregate of per-domain axes, each described in the owning domain doc and indexed in `api.md`.

**Renaming.** When the codebase's own name for a mechanism changes (its route, package, or type vocabulary) but the mechanism survives, the doc is renamed, not retired. The rename happens at the doc's next regeneration: `git mv` to the new name (so history follows), skeleton kept, header title and scope refreshed, both series tables updated. Because sibling docs may cross-reference the old name and are never patched outside their own regeneration, a rename is done inside a regeneration that also covers every doc referencing it — the Verify step's cross-reference check catches any that were missed. The human commits the rename. Pending renames (the files on disk still carry the old names): `chat.md` → `explore.md`, `rotation.md` → `reconcile.md`.

## Format conventions

- **Header block**, identical shape in every doc:

  ```markdown
  # <Title> — Generated Audit Snapshot

  > **Generated:** <YYYY-MM-DD>, from source at commit `<short-hash>`.
  > This file is a generated audit snapshot — do not edit it. See `AGENTS.md` § "Generated audit docs". When code described here changes, a stale marker line is prepended above this block; nothing else in the file is ever modified by hand.

  **Scope.** <one paragraph: what this doc covers and which sibling docs hold adjacent detail>

  **Completeness anchor.** <where enumerable: the re-checkable claim, e.g. "N routes registered at exactly these sites">
  ```

- **Section shapes**: endpoint docs use tables with columns `Endpoint | Request | Behaviour & side effects | Response / errors`; the schema doc uses per-collection field tables (`Field | Type | Notes`) plus index and rule notes; lifecycle/mechanism docs use short numbered prose sections with small tables only for genuinely tabular facts (e.g. status-at-birth by path); the coordination doc uses one lifecycle section per unit of work (its states, transitions, and who drives each) and one matrix — user actions as rows, in-flight work as columns, one outcome word per cell with a pointer to the section or sibling doc that holds the mechanism. Every cell is filled, including "unaffected": an empty cell is indistinguishable from an unchecked one.
- **Precision register**: behavioural statements name exact statuses, field names, and rejection conditions ("rejects `400` when X", "sets `<field>` to now", "silently ignored"). Silence, no-ops, and accepted-but-unused inputs are stated explicitly — absences are audit findings too.
- **Cross-references**: `` `other-doc.md` § N ``. Referenced docs must exist.
- **Naming**: category-first filenames (`lifecycle-<entity>`); no entity suffix when only one entity has the concept; mechanism names use the codebase's own vocabulary (the collection/route/package names), not invented synonyms. A cross-cutting doc whose subject no package names (`coordination.md`) takes a plain descriptive name and says so in its scope paragraph.

## Workflow

### 1. Scope
Map the request to docs via the series table. A code-area request ("the engine changed") may touch several docs; confirm the set with the user if ambiguous. If the source no longer contains the mechanism a targeted doc describes, retire it (§ "The doc series") instead of regenerating; if the mechanism survives under a new name, rename it as part of this regeneration. Stale markers are a lower bound, not the scope: a refactor that moved packages can leave a doc unmarked while everything it cites has changed, so check each candidate doc's roots against the tree rather than trusting the markers alone.

### 2. Harvest
Read each target doc as it stands. Note a stale marker (expected; it will be removed). If the content contains hand edits, stop and report them as pending design requests (Core Directive 5).

### 3. Read source
Search out the enumerable anchors first (registrations, definitions), then read every implementation the doc will make claims about. Do not write ahead of what has been read this pass.

### 4. Write
Rewrite the file completely: fresh header (today's date, current commit), stale marker gone, skeleton preserved, every claim grounded per Core Directive 4.

### 5. Verify
Re-run the anchor searches and check every hit appears in the doc and counts match. Confirm no placeholder/stub text remains, all cross-referenced docs exist, and the series table in `kalaidoscope/AGENTS.md` matches the actual contents of `docs/` (update it when adding, renaming or retiring a doc).

### 6. Deliver
Send the finished file(s) to the user. New or large docs go in reviewable slices (pause after the first slice for format/altitude feedback); regenerations of an existing doc go whole. Audit-notable behaviours are summarized in chat, never written into the doc.

## Non-content rule

This skill encodes purpose, format, and process only. It must never contain route paths, counts, collection or field names, or behaviour claims — those live in the docs and are re-derived from source every generation. If such facts are found in this file, that is a defect in the skill: remove them.
