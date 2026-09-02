> **STALE** — code has changed since this document was generated.

# Lens Distillation — Generated Audit Snapshot

> **Generated:** 2026-08-18, from source at commit `f272f1c`.
> This file is a generated audit snapshot — do not edit it. See `AGENTS.md` § "Generated audit docs". When code described here changes, a stale marker line is prepended above this block; nothing else in the file is ever modified by hand.

**Scope.** The shared machinery that turns an approved refinement into a reusable lens: the durable request marker, the intent timeline, the distillation loop, lens installation, the background worker and its model-drift scan, and model-role aliasing. It is entity-agnostic (`Strategy`-generic) and applies identically to projections and reflections; the per-entity context is in `lifecycle-projection.md` / `lifecycle-reflection.md`.

---

## 1. What a lens is

A lens is an immutable row: a prompt, the context spec it was distilled against, the model that produced it, `iterations` and `converged` from its distillation run, provenance relations (the refinement conversation it came from, `parent_lens_id` = the lens it replaced), and a creation time. An entity points at its current lens; generations execute the lens's prompt against the lens's context spec. Old lenses are never modified or deleted. Lens rows are invisible to API clients (read and write disabled).

## 2. The request marker

A refinement commit with `updateLensAndContext: true` writes its new snapshot with `lens_distill_requested: true` and an **empty** `lens_id`, then signals the worker and returns — committing never waits on a generation; the snapshot is already approved and live, and the lens is only consumed by *future* generations. The pair `requested && lens_id = ''` **is** the worker's worklist: there is no in-memory queue of targets, so a crash loses nothing, nothing resumes at startup, and a newer commit supersedes an abandoned target for free. When distillation lands, the snapshot's `lens_id` is back-filled — removing it from the worklist and recording which lens it produced.

## 3. The intent timeline (generator input)

The generator's seed is every refinement conversation ever held about the entity, oldest first:

- Only plain **text turns** are included. Drafts and tool parts are deliberately excluded — intermediate drafts approximate the approved target, and the generator must never see the target.
- **Context changes render inline** at the point they happened, as deltas against one running context state threading across conversations: the first recorded state renders the initial sources in full, every later one renders as added/removed. After the last conversation, the state is diffed against the target snapshot's `resolved_context`, so the timeline ends at exactly the sources the lens will be applied to.
- Mentions are expanded the same way the refinement chat expanded them, so the timeline reproduces what the refinement model saw.
- If no conversation recorded a context state, the timeline opens with the sources as they stand now.
- The conversation that produced the target is labelled as current; the others as historical.

## 4. The distillation loop

An optimization loop with the target **structurally isolated** from the lens writer — memorizing the target is impossible rather than merely forbidden. Three threads:

| Thread | Sees | Never sees |
|---|---|---|
| **Generator** — one growing conversation seeded with the intent timeline | The critic's diagnoses | The target output; any previous lens |
| **Execute** — a stateless production-apply call per candidate | The candidate lens + the same hydrated sources production uses | The target; the conversation |
| **Critic** — one growing conversation; the only holder of the target | The target and each executed candidate | The lens text it is grading (only its output) |

Rules, in loop order (budget: at most 4 candidates; every returned lens has been executed — a lens is never shipped unverified):

1. Generator produces a candidate. An empty candidate is a hard failure.
2. **Leak tripwire**: a candidate sharing a run of 8 consecutive normalized words (lowercased, alphanumerics only — markdown can't hide a copy) with the target means the critic leaked the target into its diagnosis; the loop stops and keeps the best prior candidate.
3. The candidate is executed. Output identical to the target → return `converged: true`.
4. The critic grades the executed output against the target. A critic-declared match → `converged: true`. Otherwise its score updates the best-so-far and its diagnosis (not the target) feeds the next generator turn.
5. An unparseable critique stops the loop, keeping the best candidate.
6. Budget exhausted → best-scored candidate, `converged: false`. If nothing was ever scored but something executed, the last executed candidate is returned; if no candidate survived at all, the run fails.

Previous lenses are never an input: the refinement conversations and the critic's judgment carry everything earlier refinements established.

## 5. Installation

A successful run writes a new `lens` row (prompt; `context_spec` copied from the target snapshot; `parent_lens_id` = the entity's previous lens, audit lineage only; model; iterations; converged; the originating refinement id), repoints the entity's `current_lens_id`, and back-fills the target snapshot's `lens_id`. Until that moment the previous lens keeps serving all generations.

## 6. The background worker

One goroutine, driven by a coalescing signal (buffered by one — a request during a running pass folds into a single follow-up pass, sound because every pass re-derives its worklist from DB state). Signals come from three places: a refinement commit with `updateLensAndContext`, an entity PATCH that changes its `model` override, and any committed `kalaidoscope_config` change. Every leg runs at background queue priority — interactive work preempts it, and preempted legs retry in place.

Each pass, per entity type:

1. **Requested distillations**: worklist per § 2, ordered newest approval first, one target per entity (an older lens-less snapshot has been superseded and never burns a loop). Targets are independent — a failing entity doesn't end the pass (the next signal retries it). Auth/quota provider failures are recorded durably on the entity (`last_provider_error_kind`, cleared on the next success); transient failures are left unmarked.
2. **Model-drift scan**, for entities not handled above that have a lens: compare the lens's recorded model with the entity's effective distill model. Drift cannot appear in the § 2 worklist — `current_lens_id` stays set the whole time — so it is derived by comparison, which makes it self-healing: no stale marker to set, none to miss. On mismatch, re-distill against the newest approved distill-origin snapshot still pointing at the current lens (installation re-points that snapshot's `lens_id`, so the association survives successive drifts). A pre-provenance lens (empty model) can never be judged drifted. No recoverable target → the old lens keeps serving under the new model until the next refinement.

## 7. Model resolution

The distill role is **structurally aliased to the snapshot role**: the loop verifies a lens by executing it exactly as production will, which is only meaningful if optimizer and executor are the same model. No configuration — static model-set table or workspace role models — can split them. A per-entity `model` override wins outright and applies identically to both roles, so the loop still optimizes against the exact model the entity's production applies will use.
