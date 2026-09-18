# Rotation & Reconcile — Generated Audit Snapshot

> **Generated:** 2026-09-17, from source at commit `895984c`.
> This file is a generated audit snapshot — do not edit it. See `AGENTS.md` § "Generated audit docs". When code described here changes, a stale marker line is prepended above this block; nothing else in the file is ever modified by hand.

**Scope.** The shared freshness machinery: how staleness ("rotation") is evaluated across the dependency graph (`internal/status/`), how windowed reflections are evaluated per window, and the reconcile wave that drains the stale set (`internal/reconcile/`): one wave's run, its per-entity generation rules, every entry point that starts a wave, and the in-process wave status that `GET /api/organize` publishes. Entity-agnostic; per-entity context is in `lifecycle-projection.md` / `lifecycle-reflection.md`, resolution in `context.md`, window calculation in `windows.md`. The HTTP surface (`GET /api/rotation`, `POST /api/reconcile`, `GET /api/organize`) is in `api.md` § 9; the worker's place in the boot order is in `boot-and-workers.md` § 2.

**Completeness anchor.** The evaluator is constructed at exactly 3 sites (`status.NewEvaluator(`: the rotation route, the handlers' shared `entityStatus`, the wave), all listed in § 1. A wave is requested at exactly 11 sites: 1 call to `reconcile.StartWave` and 10 requests through `reconcile.EnqueueWave` (9 direct calls or hook registrations plus the `engine.RequestWave` hook it is assigned to), all listed in § 4.

---

## 1. The evaluation pass

One pass (`status.Evaluator.EvaluateAll`, constructed with a `now`) evaluates **every live `active`** projection and reflection together. Both loads filter `status = 'active' && deleted_at = ''`: a `proposed` entity or a soft-deleted one is not loaded, so it is neither a node nor an edge endpoint, can be neither stale nor blocking, and is absent from the response.

1. **Graph build.** Each entity is a node carrying its own `current_context_spec` (a spec that fails to decode is treated as empty — an isolated node). Edges come from the spec's `sourceProjectionIds` / `sourceReflectionIds`; a reference to an id that is not a node (non-existent, `proposed`, or soft-deleted) produces no edge. Edges are built from every node's spec regardless of entity type.
2. **Topological order.** A depth-first visit appends each node after its dependencies, so dependencies precede dependents in the result. The visit never fails: on reaching a node already on the visiting stack (a cycle) it returns without error, so cyclic members are emitted in whatever order the traversal reached them. Root iteration is over a Go map, so the relative order of independent nodes is not stable between passes.
3. **Per-node evaluation** (§ 2), in that order, producing one `EntityStatus{id, type, upToDateSnapshotId?, newFragmentIds?, staleDependencies?, blockedBy?, pendingWindows?, staleWindows?}` per entity (`type` is `projection` or `reflection`). A resolution error in any node aborts the whole pass with that error; nothing partial is returned.

The pass runs on demand at three construction sites and is never cached or scheduled:

| Site | Caller | On evaluation error |
|---|---|---|
| `handlers.HandleGetRotation` | `GET /api/rotation` (`api.md` § 9) | `500 failed to evaluate staleness` |
| `handlers.entityStatus` | every generate request, for the `blockedBy` refusal and the reflection's stale-window candidates (`lifecycle-projection.md` § 4, `lifecycle-reflection.md` § 5.1); every windows listing, for the per-window `stale` flag (`lifecycle-reflection.md` § 9) | the request proceeds with a zero status (no refusal, no stale-window candidates / all `stale: false`): the generate handler logs `<type>.generate: staleness check: …`; the windows listing discards the error without logging |
| `reconcile.runWave` | the start of every wave (§ 3) | the wave ends with error `evaluate: …` (§ 5) |

`entityStatus` runs the full pass and picks one row; an id not in the results (not live-active) yields a zero status.

## 2. Per-entity verdict

1. **Live snapshot.** The `approved` snapshot with the highest `approval_sequence_number` for the entity — for reflections across **all** window keys. A query error counts as none. None → a *draft*: the status carries only `id` and `type` (no `upToDateSnapshotId`, nothing stale). Drafts never block dependents (step 4).
2. **Reflections with a windowed approved snapshot** → § 2.1, and evaluation ends there.
3. **Context diff.** The entity's `current_context_spec` (the entity's, **not** the lens's) is resolved now, unwindowed, in ordinary approved-only mode (`context.md` § 2–3: live fragments only, live upstreams only, newest approved snapshot per upstream) and diffed one way against the live snapshot's `resolved_context` (`PinnedIDs.Diff`, `context.md` § 5; `expandedIds` is ignored): `newFragmentIds` = fragments now in scope that the snapshot did not consume. Each snapshot id now in scope but not consumed is looked up in `projection_snapshot`, then `reflection_snapshot`, and mapped to its parent entity as a candidate `staleDependencies` entry; an id found in neither is dropped silently.
4. **Blocked.** Each direct upstream (edge) whose own verdict has no `upToDateSnapshotId` **and** that has at least one `approved` snapshot (a fresh query; a query error counts as none) is `blockedBy`. A draft upstream never blocks. In a cycle, the member evaluated first reads its not-yet-evaluated upstream's zero verdict, so that upstream is reported as blocking whenever it has an approved snapshot, whatever its own freshness.
5. **Precedence.** An upstream that is both a stale dependency and blocking is reported only in `blockedBy`. Both lists are sorted.
6. **Reflections with only windowless snapshots** additionally report `pendingWindows` = `engine.PendingWindows`: every materialised window of the series with no approved snapshot and no open generation claim (`windows.md` § 3, § 6). No `staleWindows` are produced on this path.
7. **Up to date** ⇔ no new fragments, no stale dependencies, no blockers, no pending windows; then `upToDateSnapshotId` = the live snapshot's id.

Consequences of the one-way diff and the live filters:

- Fragments in the snapshot's receipt that are no longer in scope — soft-deleted, dropped from a colour, unpinned, or of a type removed from the spec — do **not** make an entity stale. Explicitly pinned `fragmentIds` are a static set: a new fragment makes a pin-only entity stale only when it is added to the spec.
- A soft-deleted upstream is excluded three ways: it is not a node (no edge, cannot block or be a stale dependency), its snapshots are excluded from resolution (`projection_id.deleted_at = ''` / `reflection_id.deleted_at = ''`), and because the diff is one-way its disappearance from scope flags nothing. Restoring it reinstates all three.
- A lens change or a model change does not make an entity stale here. Those surface only as `lensOutdated` in the windows listing (`lifecycle-reflection.md` § 9) and as non-current in the wave's `SnapshotIsCurrent` guard (§ 3.1).
- A `pending_review` candidate is invisible to the verdict: only approved rows are compared, and an entity whose only newer output is a candidate stays stale until that candidate is approved.

### 2.1 Windowed reflections

The series is `engine.SeriesWindows` (`windows.md` § 6): the governing grid, backfilled windows, and every window holding an approved or generating snapshot. The path applies when any series window has an approved snapshot. For each window, oldest first:

- **No approved snapshot**: `pendingWindows` unless a generation claim is open for it (a generating window appears in neither list).
- **Approved snapshot**: that window key's approved snapshot with the highest `approval_sequence_number` is loaded (a query error or an empty result skips the window silently); the spec is resolved **inside the window** (`context.md` § 2.1); a resolution error skips the window silently. The one-way diff's new fragments mark the window `staleWindows` and join `newFragmentIds` (deduplicated, then sorted). New snapshot ids in the diff are ignored on this path.

No `staleDependencies` or `blockedBy` are computed on this path even when the reflection's spec names upstreams (its edges still exist, and its verdict still decides whether *it* blocks its dependents). Up to date ⇔ no new fragments, no stale windows, no pending windows; `upToDateSnapshotId` = the approved snapshot of the window whose `end` is greatest (string comparison of the RFC3339 bounds).

## 3. The reconcile wave

A wave is one call of `reconcile.runWave`, executed by the single worker goroutine (`workerLoop`) each time the wave signal fires (§ 4). It:

1. Runs one evaluation pass (§ 1) with `time.Now()` and a plain background context — ordinary approved-only resolution, so the worklist is exactly what `GET /api/rotation` reports. An evaluation error ends the wave.
2. Builds the generation context: `llmq.Background` priority (`llm-queue-quota.md` § 2.1) and the generation trigger `generate_all` (`llmcontext.WithGenerationTrigger`). The trigger switches upstream resolution from "newest `approved` by `approval_sequence_number`" to "newest by `created` of any status other than `generating` / `discarded`", i.e. a `pending_review` candidate or an approved row (`context.md` § 3), and is stamped on every row the wave writes as `generation_trigger`.
3. Walks the statuses in the returned order (dependencies before dependents) and, for every entity that **needs work** — any of `newFragmentIds`, `staleDependencies`, `blockedBy`, `pendingWindows`, `staleWindows` non-empty — runs § 3.1. Drafts and up-to-date entities are skipped. A `blockedBy` entity **is** generated (its blocker was generated earlier in the same walk, and speculative resolution consumes that fresh candidate), unlike an interactive generate, which refuses it with 409.
4. Ends at the first entity error with `<type> <id>: <err>`; entities later in the order are not visited. Returns nil when every entity that needed work was generated or deliberately skipped.

### 3.1 Generating one entity in a wave

`generateEntity(ctx, app, status)`:

1. **Strategy and status.** Reflections generate `approved` snapshots (as everywhere else); projections generate `pending_review` review candidates.
2. **Liveness.** `engine.FindLive` failing (the entity was hard-removed or soft-deleted since the pass) logs and skips the entity; the wave continues.
3. **Which windows.**
   - `pendingWindows` + `staleWindows` non-empty → exactly those windows, pending first, then stale, in status order.
   - otherwise, a reflection whose governing grid is non-empty (`engine.CurrentGridWindows`) → nothing is generated (a scheduled reflection flagged only by `blockedBy` / `staleDependencies` owes no window and never gets a windowless snapshot);
   - otherwise `engine.SnapshotIsCurrent` true → skipped; else one windowless generation.
4. **`SnapshotIsCurrent`** (the dedup guard; windowed generations do not consult it): the entity's newest `pending_review`-or-approved snapshot (ordered `-created,-approval_sequence_number`; none → not current) is current iff its `lens_id` equals the entity's `current_lens_id`; its `generated_by_model`, when non-empty, equals `ResolveRoleFor(RoleSnapshot, generate_with_model)` (`models.md` § 5; an empty stored model, or a role resolution that errors, never fails this check); and the entity's `current_context_spec` (the same spec every generation resolves, `refinement.md` § 6), resolved unwindowed under the wave's context (speculative upstreams), is identical to the snapshot's `resolved_context` in **both** directions (`DiffPinnedIDs`: nothing added, nothing removed; a resolution error → not current).
5. **Per window**, `engine.GenerateSnapshot` (`lifecycle-projection.md` § 4.1–4.2, `lifecycle-reflection.md` § 5.2) with this outcome mapping: `llmq.ErrPreempted` → the same window is retried at once (the retry blocks in the scheduler until a slot frees); `engine.ErrLensNotReady` or `engine.ErrGenerationInFlight` → logged, this window is abandoned, the next window (if any) proceeds; any other error (including `usage.ErrExhausted` and `ErrContextTooLarge`) → returned, ending the wave.
6. **What a wave generation writes.** Inside the claim row's lifetime, upstream snapshots resolve speculatively (step 2 of § 3). Output is minimised against the newest approved snapshot of the same lens as for any generation; then:
   - **Settle in place.** When the output equals the approved output (byte-for-byte, or the delta turn reports no change) **and** the context carries a generation trigger, `settleApprovedInPlace` runs in one transaction: if the newest approved snapshot (per window for reflections) still belongs to the current `lens_id`, its `context_spec`, `resolved_context`, `generated_by_model` and `generated_at` are overwritten, every other `pending_review` sibling is set `discarded`, no new row is written, the claim row is deleted, and the approved snapshot's id is returned. Its `approval_sequence_number` does not move, so dependents that consumed it are not made stale. If the approved snapshot has moved (none, or another lens), the generation falls through to the ordinary store; a transaction error is returned as `settle in place: …` and ends the wave. An interactive generation that changes nothing still produces a candidate.
   - **Otherwise** the claim row is filled in place with `generation_trigger = generate_all`, other pending siblings discarded; a reflection's row is then approved (`ApproveSnapshot`).
7. **Downstream consequences.** Approval promotes a candidate in place (same id, `lifecycle-projection.md` § 4.3), so a dependent whose wave candidate consumed that row reads as consistent without regeneration. A refinement committed on a still-`pending_review` projection candidate carries its `generation_trigger` forward onto the committed snapshot; every commit, chain or not, requests a wave (§ 4). An interactive generate that finds the wave's claim row open joins it (`AwaitGeneration`, `lifecycle-projection.md` § 4.1) rather than failing.

## 4. Wave entry points

`reconcile.Register` (called during server construction, `boot-and-workers.md` § 1) stores the app, assigns `engine.RequestWave = EnqueueWave`, starts `workerLoop`, and binds an `OnServe` hook (after `se.Next()`) that logs the mode and calls `EnqueueWave` once. The worker wakes on `waveSignal`, a channel of capacity 1: a signal that arrives while one is buffered is dropped, so any number of requests during a running wave coalesce into exactly one follow-up wave (sound because each wave re-derives its worklist).

Two triggers exist:

- **`StartWave()`** — the explicit trigger: stops and clears any pending debounce timer, then signals at once. It works whether or not automatic waves are enabled.
- **`EnqueueWave()`** — the automatic trigger: a no-op unless `autoWave` is set; otherwise (re)arms a 3 s debounce timer (`waveDebounce`) whose expiry signals. A burst of triggers within the quiet period yields one wave.

`autoWave` = `os.Getenv("KALAIDO_AUTO_WAVE") != ""` at process start: **any** non-empty value enables (so `KALAIDO_AUTO_WAVE=0` enables too); unset → off. `WaveEnabled()` returns it and is published as `policy.wave` by `GET /api/organize` (`organize.md` § 7). With it off, the boot request, every hook and every handler-side request below are silent and the only wave is the one `POST /api/reconcile` starts.

| # | Site | Trigger | When |
|---|---|---|---|
| 1 | `handlers.HandleReconcile` | `StartWave` | `POST /api/reconcile` → `202` no body, always (`api.md` § 9) |
| 2 | `reconcile.Register` `OnServe` | `EnqueueWave` | once per process start, after the serve chain |
| 3 | `engine.RequestWave` ← `EnqueueWave`, called by `engine.CommitRefinement` | `EnqueueWave` | after **every** refinement commit's transaction, projection or reflection, chain-marked or not (`refinement.md` § 5) |
| 4 | `mapping.OnSettle(reconcile.OnMapSettled)` | `EnqueueWave` | after every map cycle, registered after `colour.OnMapSettled` so thing-backed membership is recomputed first (`map.md` § 3.2, `colours.md` § 3) |
| 5 | `colour.OnDrained(reconcile.EnqueueWave)` | `EnqueueWave` | after a colour-worker drain that wrote at least one membership row (`colours.md` § 4) |
| 6 | `server.RegisterTriggers` fragment `OnRecordAfterCreateSuccess` | `EnqueueWave` | every fragment created with `ingested_via != "import"` (`ingestion.md` § 7) |
| 7 | `ingest.processIngestRecord` | `EnqueueWave` | when an async batch finishes with at least one fragment written, whether the batch ended `done` or `error`, before the post-import handoff (`ingestion.md` § 3) |
| 8 | `handlers.HandleCreateColour` | `EnqueueWave` | every colour create, after seeding (`colours.md` § 5) |
| 9 | `handlers.HandleUpdateColour` | `EnqueueWave` | only when the `prompt` changed (after `Rematch`); name/example-only updates do not request one |
| 10 | `handlers.HandleRematchColour` | `EnqueueWave` | every `POST /api/colours/{id}/rematch` |
| 11 | `handlers.handleApproveCandidate` | `EnqueueWave` | after every successful candidate approval, projection or reflection |

Nothing else requests a wave: colour delete, fragment delete, entity delete/restore, schedule edits, backfill, discover runs and hand edits do not. Retry waves (§ 5) reuse the signal directly and are not subject to `autoWave` or the debounce.

## 5. Published wave status and retry

The worker keeps four in-process values under one lock: `running`, `lastStarted`, `lastError`, `lastCompleted`. They are not persisted; a restart zeroes them.

- On each signal, before `runWave`: `running = true`, `lastStarted = now` — set together, so a reader never observes a new `lastStarted` without `running`.
- After the wave (`afterWave`): `running = false`. A nil result sets `lastError = ""` and `lastCompleted = now`, resets the retry count, and cancels any pending retry timer. An error sets `lastError = err.Error()` and leaves `lastCompleted` as it was.
- **Retry.** A failed wave whose error is `usage.ErrExhausted` (quota) is logged and not retried; the next real trigger re-enters. Any other failure arms a retry timer at `retryBackoff[min(retries, 2)]` — 1 min, then 5 min, then 15 min for every further consecutive failure — replacing any pending retry timer, and the timer signals the worker directly (no debounce, no `autoWave` check — a failed manual wave retries on its own). The count resets only on a clean wave.

`reconcile.Status()` returns a consistent copy (`State{Running, LastStarted, LastError, LastCompleted}`); `Running()`, `LastError()` and `LastCompleted()` are per-field accessors. The only consumer is `organize.Evaluate` (`organize.md` § 1), which publishes it as `reconcile: {running, lastStarted?, lastCompleted?, lastError?}` — the times as RFC3339 UTC, omitted while zero — alongside `policy.wave`. Nothing in the backend reads the status back; how a client pairs `lastStarted` with `running` to detect that a wave it started has ended is client behaviour and out of scope.
