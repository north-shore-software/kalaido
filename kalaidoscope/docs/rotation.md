# Rotation & Reconcile — Generated Audit Snapshot

> **Generated:** 2026-08-18, from source at commit `f272f1c`.
> This file is a generated audit snapshot — do not edit it. See `AGENTS.md` § "Generated audit docs". When code described here changes, a stale marker line is prepended above this block; nothing else in the file is ever modified by hand.

**Scope.** The shared freshness machinery: how staleness ("rotation") is evaluated across the dependency graph, and how the speculative reconcile wave drains the stale set. Entity-agnostic; per-entity context is in `lifecycle-projection.md` / `lifecycle-reflection.md`. The HTTP surface (`GET /api/rotation`, `POST /api/reconcile`) is in `api.md` § 9.

---

## 1. The evaluation pass

One pass evaluates **every** projection and reflection together:

1. **Graph build.** Each entity is a node; edges come from its `current_context_spec`'s `sourceProjectionIds` / `sourceReflectionIds`. References to entities that no longer exist produce no edge.
2. **Topological order.** Dependencies are evaluated before dependents (a dependent's verdict reads its upstreams' already-computed verdicts). Cycles do not fail the pass — recursion simply stops at a repeated node.
3. **Per-node evaluation** (§ 2), in that order, producing one `EntityStatus` per entity.

## 2. Per-entity verdict

The **live snapshot** is the approved snapshot with the highest `approval_sequence_number` — for reflections, across all windows. An entity with **no approved snapshot is a draft**: reported with only `id`/`type`, never stale, and never blocking its dependents.

For a non-draft, the entity's `current_context_spec` is resolved *now* and diffed against the live snapshot's `resolved_context` receipt. **The diff is one-way — only additions count.** Consequences: a fragment that left the context (soft-deleted or untagged), or a colour whose criteria changed, never flags staleness by itself.

- `newFragmentIds` — fragments the spec matches now that the receipt lacks.
- `staleDependencies` — upstreams whose latest approved snapshot differs from the one consumed: work that can be done now.
- `blockedBy` — upstreams that are not themselves up to date (and are not drafts): regenerating now would consume output about to be superseded, so this entity should wait. An upstream qualifying as both is reported only here — blocked wins as the stronger verdict.
- `pendingWindows` — never-materialized schedule windows (reflections only; calculation in `windows.md`). Already-materialized windows are never re-flagged.
- `upToDateSnapshotId` — set to the live snapshot's id only when all four lists are empty.

Both dependency lists are sorted for response stability.

## 3. The reconcile wave

A wave is requested by `POST /api/reconcile` or re-triggered by a refinement commit of a still-pending chain candidate. The signal coalesces (buffered by one); every wave re-derives the stale set from scratch with the § 1 evaluation — its worklist is exactly the dashboard's "needs action" set.

The wave walks entities in dependency order and generates for each one that needs work (any of the four § 2 lists non-empty):

- **Speculative resolution.** Inside the wave, an upstream reference resolves to the upstream's **newest snapshot regardless of approval status** (ordinary resolution takes the latest *approved* one). The wave bets that pending candidates will be approved as-is; because approval promotes a snapshot record **in place** (same id), approving a chain top-down settles every pre-generated dependent with zero further generations.
- **Chain marking.** Wave-generated snapshots carry a `chain_origin` marker. Refining a still-pending chain candidate instead of approving it supersedes what its dependents consumed: the commit inherits the mark and re-requests a wave, regenerating the downstream subtree.
- **Status at birth** (the one per-entity asymmetry, stated here once): a wave generates a projection snapshot as a **pending candidate** for review, but a reflection snapshot **directly approved** — reflections publish live, as they do everywhere else.
- **Dedup guard.** An entity with no pending windows is skipped when its newest snapshot — any status — already matches the current lens, the effective model (unknown models on legacy rows never read as stale), and a fresh resolution of the lens's context spec. A repeated "generate all" therefore reproduces nothing.
- **Priority & failure.** Generation runs at background queue priority; interactive work preempts it and preempted calls retry in place. The **first failure ends the wave**: topological order means everything upstream of the failure is done, and a dependent generated now would consume output the failure left missing. The next wave resumes from a fresh evaluation.

No run state is reported anywhere: candidates land through PocketBase realtime, and queue activity is visible via `llm_queue_status`.
