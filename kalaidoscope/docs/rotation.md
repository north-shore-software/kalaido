# Rotation & Reconcile — Generated Audit Snapshot

> **Generated:** 2026-09-02, from source at commit `3998ebd`.
> This file is a generated audit snapshot — do not edit it. See `AGENTS.md` § "Generated audit docs". When code described here changes, a stale marker line is prepended above this block; nothing else in the file is ever modified by hand.

**Scope.** The shared freshness machinery: how staleness ("rotation") is evaluated across the dependency graph, how windowed reflections are evaluated per window, and the speculative reconcile wave that would drain the stale set. Entity-agnostic; per-entity context is in `lifecycle-projection.md` / `lifecycle-reflection.md`, resolution in `context.md`. The HTTP surface (`GET /api/rotation`, `POST /api/reconcile`) is in `api.md` § 9.

---

## 1. The evaluation pass

One pass (`status.Evaluator.EvaluateAll`, constructed with `now`) evaluates **every `active`** projection and reflection together; `proposed` entities are not loaded and cannot be nodes or edges:

1. **Graph build.** Each entity is a node; edges come from its `current_context_spec`'s `sourceProjectionIds` / `sourceReflectionIds`. References to entities that do not exist or are not active produce no edge.
2. **Topological order.** Dependencies are evaluated before dependents. A cycle does not fail the pass: the depth-first visit stops at a node already on the stack, so cyclic members are evaluated in whatever order the traversal reached them.
3. **Per-node evaluation** (§ 2), producing one `EntityStatus{id, type, upToDateSnapshotId?, newFragmentIds?, staleDependencies?, blockedBy?, pendingWindows?, staleWindows?}` per entity.

The pass runs on every `GET /api/rotation`, on every generate request (for the `blockedBy` check), on every windows listing, and at the start of a wave. Nothing caches or schedules it.

## 2. Per-entity verdict

1. **Live snapshot.** The approved snapshot with the highest `approval_sequence_number` for the entity — for reflections across **all** window keys. None → a *draft*: the status carries only `id` and `type` (no `upToDateSnapshotId`, nothing stale). Drafts never block dependents.
2. **Reflections with a windowed approved snapshot** → § 2.1, and evaluation ends there.
3. **Context diff.** The `current_context_spec` (the entity's, **not** the lens's) is resolved now, unwindowed, in ordinary approved-only mode, and diffed one way against the live snapshot's `resolved_context`: `newFragmentIds` = fragments now in scope that the snapshot did not consume. New snapshot ids are mapped back to their parent entities as `staleDependencies` (upstreams that have published newer output).
4. **Blocked.** Each direct upstream that has an approved snapshot but whose own verdict has no `upToDateSnapshotId` is `blockedBy` (regenerating now would consume output about to be superseded). An upstream that is both stale and blocked is reported only as blocked.
5. **Reflections with only windowless snapshots** additionally report `pendingWindows` = the grid's pending windows.
6. **Up to date** ⇔ no new fragments, no stale dependencies, no blockers, no pending windows; then `upToDateSnapshotId` = the live snapshot's id.

Removed fragments (in the snapshot's receipt but no longer in scope, e.g. soft-deleted) do **not** make an entity stale: the diff is one-directional. A model or lens change does not make an entity stale either; those are `lensOutdated` in the windows route and `SnapshotIsCurrent` in the wave only.

### 2.1 Windowed reflections

For each window of the series (`windows.md` § 6): without an approved snapshot and not generating → `pendingWindows`; with one → that window's approved snapshot (highest sequence within the key) is loaded, the spec resolved **inside the window**, and diffed one way against its `resolved_context`; any new fragment marks the window `staleWindows` and its ids join `newFragmentIds` (sorted, deduplicated). No dependency edges are considered on this path (a reflection's spec cannot hold upstreams). Up to date ⇔ no new fragments, no stale windows, no pending windows; `upToDateSnapshotId` = the approved snapshot of the window with the latest end.

## 3. The reconcile wave

`POST /api/reconcile` → `EnqueueWave()` → 202. **The wave is disabled**: `waveEnabled` is the constant `false`, so `EnqueueWave` logs `reconcile wave: disabled; ignoring request` and returns. The same applies to the wave a refinement commit requests through `engine.RequestWave`. Nothing else generates speculatively.

What the code would do if enabled: the worker (`boot-and-workers.md` § 2) runs one pass (§ 1) and, in topological order, for every entity that needs work (new fragments, stale dependencies, blockers, pending or stale windows) generates under a context marked `ChainOriginGenerateAll` at **Background** priority — which switches upstream resolution to "newest pending-or-approved snapshot" (`context.md` § 3) and stamps `chain_origin` on the produced rows. Projections produce `pending` candidates; reflections produce approved snapshots for each pending and stale window. An entity with nothing owed is skipped when `SnapshotIsCurrent` (newest pending-or-approved snapshot has the current lens, the effective model, and an identical resolved context). `ErrPreempted` retries; `ErrLensNotReady`/`ErrGenerationInFlight` skip the entity; any other error **ends the wave** (later entities would consume output the failure left missing). A wave requested while one runs coalesces into one follow-up. Approval of a chain candidate promotes it in place, so dependents that consumed it become consistent without regeneration; a refinement committed on a still-pending chain candidate carries `chain_origin` forward and re-requests a wave.
