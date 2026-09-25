# Coordination — Generated Audit Snapshot

> **Generated:** 2026-09-25, from source at commit `1c94d69`.
> This file is a generated audit snapshot — do not edit it. See `AGENTS.md` § "Generated audit docs". When code described here changes, a stale marker line is prepended above this block; nothing else in the file is ever modified by hand.

**Scope.** The Go backend as one state machine, cut by *interaction* rather than by mechanism. No package names or owns this subject — the pieces live in `internal/workers/` (the manager), `internal/workerutil/` (signal, one-shot callbacks, runner), `internal/engine/` (claim rows, claim hub, liveness, the snapshot edit ledger), the four worker `Run` loops (`internal/mapping/`, `internal/colour/`, `internal/reconcile/`, `internal/discover/`), the detached runner tasks (`internal/ingest/`, `internal/reflections/backfill.go`), the LLM scheduler (`llm/queue/`, `internal/usage/`), the refinement conversation's writes onto candidate rows (`internal/refinement/`, `internal/projections/edit.go`) and the request-side handlers (`internal/handlers/`, hooks in `server/server.go`, `internal/ingest/batch.go`, `internal/config/hooks.go`). This doc states, for every unit of background work, the durable state that represents it, the in-process state layered on top, and how it begins, ends, is superseded, is abandoned or is taken over after a crash (§ 1); the manager's choreography between requests and workers (§ 2); the signal/callback graph (§ 3); what the wire shows of in-flight work (§ 4); and the matrix of user actions against in-flight work (§ 5). Each mechanism is described once in its owning doc — `lifecycle-projection.md`, `lifecycle-reflection.md`, `windows.md`, `refinement.md`, `reconcile.md`, `map.md`, `colours.md`, `discover.md`, `llm-queue-quota.md`, `models.md`, `boot-and-workers.md`, `ingestion.md`, `explore.md`, `context.md` — and this doc says only when it is reached and what it produces.

**Completeness anchor.** 38 mutating route registrations (`POST`/`PATCH`/`DELETE`): 37 in `server/server.go` `RegisterRoutes` plus `POST /api/ollama/pull` in `llm/providers/ollama/handlers.go`, and 3 hook-modified collection endpoints (`fragment` delete request, `ingest` create, `kalaidoscope_config` update). Every one maps to a row of § 5.2 or is listed in § 5.3. 4 `workerutil.Service` run loops (`colour`, `mapping` — two goroutines —, `reconcile`, `discover`), 2 claim kinds (`projection_snapshot`, `reflection_snapshot` rows with `status = 'generating'`) and the detached import task are the 9 columns of § 5.2.

---

## 1. Units of work

Each subsection names the durable state (rows, statuses, timestamps, TTLs), the in-process state (flags, signals, cancel functions, locks, the claim hub), and the transitions: begin, end, supersede, abandon, crash takeover. "Signal" throughout is `workerutil.Signal`: a channel of capacity 1, so any number of notifications arriving while a pass runs coalesce into exactly one further pass.

### 1.1 Annotation drain (`mapping.Worker.annotateLoop`)

- **Durable.** The pending set is derived, never stored: every live fragment with no `fragment_annotation` row (`sourcedata.PendingAnnotationFragments`). Each success writes one `fragment_annotation` row stamped `generated_from_map_version` (the `kalaidoscope_map.version` read at the start of *that fragment's* annotation, `loadDocument` inside `annotateOne`) and `generated_by_model`; the row is the only record that the fragment was drained. Nothing records a failed fragment.
- **In-process.** `signal` (coalescing), `wantSettle atomic.Bool` (set by `Signal`, swapped to false when a drain starts), `annotating atomic.Bool`, `lastDrainError` (string under `drainErrMu`; `""` after a clean or cancelled drain), `followUps workerutil.Callbacks` (one-shot after-drain callbacks, detached at drain start). Within a drain: a `failed` set (a fragment that fails is skipped for the rest of *this* drain), an `exhausted` flag, an errgroup of up to 100 concurrent annotations.
- **Begins** on any `Signal`/`SignalAnnotate` wake: `AfterDrain` callbacks are detached, `full := wantSettle.Swap(false)`, `annotating = true`, the annotate model is resolved once (`llm.ResolveRole(RoleAnnotate)` — a resolution error ends the drain before any fragment).
- **Runs** in passes: re-query pending, subtract `failed`, dispatch the rest; repeat until a pass finds nothing. Fragments that land mid-drain are therefore picked up by the same drain. Each call is `GenerateOnceMsgsThrottled` (retries quota/transient provider errors with back-off for up to 3 minutes; loops on `ErrPreempted`); an unparseable reply gets one JSON nudge, then fails the fragment.
- **Ends** when a pass is empty, when `usage.ErrExhausted` is seen (stops dispatching, breaks after the current pass), or when `ctx` is cancelled (returns `ctx.Err()`; annotations already saved stay). Then `annotating = false`, `lastDrainError` set to the first error (or `""`), the detached callbacks are invoked with that error. With `full` and `ctx` alive, the drain **settles** (§ 1.2) before returning — the settle is part of the drain, so after-drain callbacks run after the settle too.
- **Superseded.** Never; a second signal queues one more drain.
- **Abandoned / crash.** No durable marker exists, so nothing to sweep; `KickIfPending` at boot signals a drain when pending fragments exist (`boot-and-workers.md` § 1). A fragment whose annotation failed is retried by the next drain (not by this one).

### 1.2 Consolidation (a map cycle: `mapping.Worker.cycle` → `integrate` → `consolidate`)

- **Durable.** `kalaidoscope_map` singleton (`body`, `version`, `consolidated_at`); `fragment_annotation.consolidated_at` (`''` = unintegrated); one `map_run` row per call: `status` `running` (`pending_in`, `version_before`, `generated_by_model`) → `done` (`admits`, `merges`, `version_after`) or `error` (`error`). The document write, `version+1`, and every pending row's `consolidated_at` land in one transaction; the run row's `done` is a separate save after it.
- **In-process.** `consolidateMu` (held for the whole integrate; `WaitSettled` takes and releases it — the lock *is* the wait), `consolidating atomic.Bool`, `settleHooks` (registered before `Run`; run after every cycle *outside* the lock, on the goroutine that ran the cycle).
- **Begins** either from the consolidate loop (every 10 s: due when more than 50 unintegrated rows exist, or when the newest unintegrated row is older than one minute) or from a full drain's settle (§ 1.1). Both call `cycle`; two cannot overlap (`consolidateMu`).
- **Ends** with `done`, with `error` (model error after `GenerateOnceMsgsThrottled`, unparseable reply after one JSON nudge, or transaction failure — the run row is saved `error`, the document untouched), or with nothing (no unintegrated rows: returns before creating a run row — settle hooks still fire). A cancelled `ctx` surfaces as a model error → `error` row.
- **Superseded / abandoned.** Annotation rows written while a consolidation runs are not in its `pending` set and wait for the next due cycle. A `map_run` left `running` by a crash is never repaired; the status reports it as `interrupted` (§ 4) and the next cycle creates a new row.

### 1.3 Colour drain (`colour.Worker.Run` → `drain` → `drainColour`)

- **Durable.** Per colour: `prompt_match_completed_up_to_fragment_id` (the watermark — the last fragment of the last judged page, in `(created, id)` order), `colour_fragment` rows (`match_type = 'prompt'`), `last_provider_error_kind` (set on auth/quota provider errors, cleared on the next success). The watermark is the whole queue: a restart resumes from it.
- **In-process.** `signal`, `draining atomic.Bool`, under `stateMu`: `currentColourID`, `lastStarted`, `lastCompleted`, `lastError`; the `drained` hook list (run only after a drain that wrote at least one link), `settled *settledMark` (§ 3, the map-settle watermark).
- **Begins** on a signal: colours with `prompt != ''` are loaded once (`created` order), the colour model resolved once (`llm.ResolveRole(RoleColour)`, no per-entity override).
- **Runs** colour by colour, page by page (200 live fragments past the watermark, pairs already holding any row skipped), one `usage.GenerateOnce` per fragment at Idle priority (loops on `ErrPreempted`); every `yes` inserts a link; after each page the watermark advances by saving the colour record held in memory since the drain began.
- **Ends** when every colour's pages are exhausted; `usage.ErrExhausted` ends the whole drain at once; any other error ends that colour and the drain continues (first error kept). `currentColourID` cleared; `lastCompleted` set only on a clean end; `lastError` `""` after a cancelled drain (it resumes from the watermark).
- **Superseded.** `Rematch(colourID)` (prompt edit, or `POST …/rematch`) deletes the colour's prompt rows, clears its watermark, recomputes thing rows and signals. It does not stop a drain already on that colour (§ 5.2 row R12).
- **Crash.** Nothing to sweep; `BootKicks` signals one drain at boot.

### 1.4 Discover run (`discover.Worker.Run` → `run` → `runLoop`)

- **Durable.** One `discover_run` row per flow run: `kind`, `status` `running` → `done`/`error`, `map_version` (the document version the run read), `rounds`, `fragment_reads`, `outputs` (saved after every round), `error`. Rows it creates: `colour` rows (colours flow), `projection`/`reflection` rows with `status = 'proposed'` (the other flows).
- **In-process.** `wake` signal, `pending map[kind]bool` (taken whole at the start of a drain, in `kindOrder` colours → projections → reflections), `running` kind + `currentStarted` under `runningMu`, `waitingOnMap atomic.Bool`, `followUps` (one-shot after-drain callbacks, invoked with the last flow error).
- **Begins** when a wake finds pending kinds. Each flow: `waitingOnMap = true` → `maps.WaitSettled()` (blocks only while a consolidation holds `consolidateMu`; a running *annotation* drain is not waited for) → the run context is built from the current map document and colours → guards `errNoMap` and `errNoColours` return before a run row exists → run row created → tool loop at Background priority (`RetryThrottled` around each model call; up to 30 rounds).
- **Ends** with `done` or `error` (tool-loop error, including `ctx` cancellation surfacing from the model call); `finishRun` saves the final progress either way.
- **Superseded.** A kind signalled while a drain runs is taken by the next drain, even if the same kind is running now. Nothing cancels a run except process shutdown.
- **Crash.** A row left `running` is never repaired; the status reports it as `interrupted` while no run of that kind is live (§ 4). Rows created before the crash stay.

### 1.5 Reconcile wave (`reconcile.Worker.Run` → `runWaveWithWorker`)

- **Durable.** None of its own. It writes only through generation claims (§ 1.6): projections as `pending_review` candidates, reflections as `approved` windows, under `generation_trigger = generate_all` (via the context) at Background priority.
- **In-process.** `signal`; `autoWave` (from `KALAIDO_AUTO_WAVE`); `debounce` timer (3 s, automatic triggers only), `retryTimer` + `retries` (back-off 1 m / 5 m / 15 m after a failed wave, not after quota exhaustion or cancellation); under `stateMu`: `running`, `lastStarted`, `lastError`, `lastCompleted`, `lastCancelled`, `currentEntity`, `progress {completed,total}`, `waveCancel`.
- **Begins** on a signal. `StartWave` (the route) signals at once and stops a pending debounce; `EnqueueWave` (every automatic trigger, § 3) is a no-op unless `autoWave`, otherwise arms/resets the debounce. Each wave derives its worklist from scratch: `EvaluateAll` (which, per projection with a pending candidate, also computes `Candidate{Outdated, Reason, Engaged, NewFragmentIDs}`), keep entities with new fragments, stale or blocked dependencies, pending or stale windows (`needsWork`; an outdated candidate alone does not qualify).
- **Runs** entity by entity in dependency order, checking `ctx.Err()` before each. Per entity (`generateEntity`): a projection whose evaluated `Candidate.Engaged` is true is skipped without a model call (logged "candidate is engaged"); then `FindLive` (a deleted entity is skipped with a warning); for a scheduled reflection with nothing owed, or an entity whose newest pending/approved snapshot is current (`SnapshotIsCurrent`: same lens, same effective model, same resolved ids), skip without a model call; otherwise one `GenerateSnapshot` per window (or one windowless). `ErrPreempted` → retry the same window in place; `ErrLensNotReady` / `ErrGenerationInFlight` → skip this entity, wave continues; any other error → the wave ends with that error.
- **Ends** with success (`lastCompleted`, retries reset), with an error (`lastError`; a retry wave is scheduled unless the error is `usage.ErrExhausted`), or cancelled (`lastError = ""`, no retry). `CancelWave` cancels `waveCtx`: the in-flight model call is cut (`stream interrupted`), the current entity's claim is released by `GenerateSnapshot`'s defer, and the loop exits at its next `ctx.Err()` check.
- **Superseded.** A signal arriving while a wave runs is one buffered signal: exactly one follow-up wave, re-derived from scratch. The engaged flag is read at evaluation time: a candidate that becomes engaged after the wave started is still generated over by this wave (its claim's completion discards the candidate, § 1.6).
- **Crash.** Nothing durable; claims it held are swept at boot.

### 1.6 A generation claim (one `GenerateSnapshot`)

One unit per (entity, window). Owners: an interactive request (§ 2), a wave (§ 1.5), a pending-windows pass (§ 1.7).

- **Durable.** The claim is a snapshot row inserted with `status = 'generating'` (`projection_snapshot` / `reflection_snapshot`, window bounds stamped for reflections). It is the lock and the display state at once. `GenerationClaimTTL = 10 min`: `ClaimGeneration` deletes a `generating` row older than the TTL and takes over; a younger one is `ErrGenerationInFlight`. Check-then-insert runs in one transaction on PocketBase's single write connection.
- **In-process.** The process-wide `claimHub` (waiters per claim id, woken on settle); the `completed` flag guarding the deferred `releaseClaim`.
- **Order of checks before the claim.** `FindLive` (404-class error on a missing or soft-deleted entity) → active lens present (`ErrLensNotReady`) → model resolved (`ResolveRoleFor(RoleSnapshot, generate_with_model)`) → `ClaimGeneration`. Liveness is checked *before* the claim transaction, not inside it.
- **After the claim.** Spec resolved and hydrated for the window (`prepareGenerationContext`; a resolution error yields an empty source block rather than a failure); one `GenerateOutput` call; then the anchor branch (`lifecycle-projection.md` § 4.2): `latestApprovedOutput` reads the newest approved row for the entity/window — no anchor or an anchor under another lens → the raw output becomes the draft with no edits; output byte-equal to the anchor → `unchanged`; otherwise `minimizeAgainstPrevious` (delta + merge, two more calls) — a delta of "no changes" or a merge equal to the anchor → `unchanged`; a differing merge → `DiffAndMarkBlocks(anchor, merged, regeneration)` produces `output_draft` with one `<<<edit:id>>>` marker per changed block run and an `edits` entry per marker (`type = regeneration`, `status = proposed`); `ErrPreempted` from the minimise propagates (the owner retries); a `ctx` error aborts; any other minimise error keeps the raw output, diffed against the anchor the same way. An `unchanged` result under a `generate_all` trigger **or** a fold-in context (`llmcontext.WithSettleUnchanged`) updates the approved row in place (`settleApprovedInPlace`: `context_spec`, `resolved_context`, `generated_by_model`, `generated_at`; discards pending siblings; skipped, returning `""`, when the newest approved row no longer belongs to the resolved lens) and the claim is released — the returned id is the approved row's, not the claim's.
- **Ends** by `completeClaimedSnapshot`: the claim row is filled (`status` as requested, `lens_id`, `output` — empty for `pending_review`, the full text for `approved` —, `output_raw`, `output_draft`, `edits` (`[]` for `approved`), `context_spec`, `resolved_context`, `generated_by_model`, `generation_trigger`, `generated_at`) and every *other* `pending_review` sibling for the same entity and window is set `discarded`, in one transaction; then the hub settles the claim id. With status `approved`, `ApproveSnapshot` follows (next `approval_sequence_number`, discards pending siblings again). Any failure after the claim → `releaseClaim` deletes the row (only while still `generating`) and settles the hub, so joiners read `ErrGenerationAbandoned`.
- **Joining.** `AwaitGeneration` reads the newest live claim row, subscribes to the hub, and re-reads the row on every wake or 500 ms tick: filled → its id; `discarded` or gone → `ErrGenerationAbandoned`; `ctx` done → its error. `JoinGeneration` bounds the wait by the claim TTL.
- **Superseded.** A pending candidate is superseded (`discarded`) by any later claim completion, approval, or settle-in-place for its entity+window. An `approved` row is superseded only by a higher `approval_sequence_number`. A pending candidate is also *rewritten in place* — not superseded — by a hand edit, an edit triage, or a refinement chat turn bound to it (§ 1.10).
- **Crash.** `SweepGenerationClaims` deletes every `generating` row in both collections at boot (`boot-and-workers.md` § 1). Within a process, a hung claim is taken over after the TTL and `HasLiveClaim` stops counting it (so delete becomes possible and the manager stops treating the wave as its producer).

### 1.7 Pending-windows pass (`reflections.RunPendingWindows`)

- **Durable.** `reflection_window` rows written by `MaterializeBackfill` (permanent, unique per reflection and bounds; a duplicate save is tolerated) plus the claims (§ 1.6) it takes, one per pending window, status `approved`.
- **In-process.** A goroutine on the `TrackedRunner`; `GenerateWindows` runs every window concurrently (one goroutine each) and retries each on `ErrPreempted`.
- **Begins** from `POST …/backfill` (after materialisation) and from a reflection refinement commit. It loads the reflection (soft-deleted or not — `FindRecordById`, no liveness check), computes `PendingWindows` (no approved snapshot *and* no `generating` row), and generates them at Background priority.
- **Ends** after one pass; a window that failed stays pending for the next pass, `ErrGenerationInFlight` is left to whoever holds the claim, `ErrLensNotReady` is logged once per window.
- **Crash.** Claims swept at boot; nothing else to repair.

### 1.8 Import processing (`ingest.processIngestRecord`)

- **Durable.** The `ingest` row: forced to `status = 'pending'` in the create hook, ending `done` (`ingested = n`) or `error` (`error`, `ingested = n` so far). Fragments land in batches with `ingested_via = 'import'`.
- **In-process.** A goroutine on the runner holding the uploads in memory; the writer's dedupe set (preloaded at the start of *this* import, when `skip_duplicates`).
- **Ends** by saving the row; then `EnqueueWave` when anything landed, and either `startPipeline` (`organize_after`: an `AfterDrain` callback that signals all three discover kinds only if the drain ended with a nil error, then `Mapping.Signal()`) or `Mapping.SignalAnnotate()`.
- **Crash.** `SweepPending` at boot marks every `pending` row `error` (`"server restarted while processing"`).

### 1.9 Crash and shutdown summary

| Unit | Durable trace after a crash | Repaired at boot by | Otherwise |
|---|---|---|---|
| Annotation drain | none (pending set is derived) | `KickIfPending` re-signals | — |
| Consolidation | `map_run.status = 'running'` | nothing | reported `interrupted` while no consolidation runs |
| Colour drain | watermark per colour | `Colour.Signal()` in `BootKicks` | resumes from the watermark |
| Discover run | `discover_run.status = 'running'` | nothing | reported `interrupted` while that kind is not running |
| Reconcile wave | none | `EnqueueWave()` in `BootKicks` (no-op without `KALAIDO_AUTO_WAVE`) | — |
| Generation claim | `status = 'generating'` row | `SweepGenerationClaims` deletes it | in-process: TTL takeover after 10 min |
| Pending-windows pass | claims only | as above | windows stay pending |
| Import | `ingest.status = 'pending'` | `SweepPending` marks `error` | — |
| Candidate edit ledger (§ 1.10) | `edits` JSON and `output_draft` on the row; every write is one transaction | nothing needed | a marker left in `output_draft` blocks approval until resolved |

Shutdown (`runtime.stop`) cancels the worker context and the runner, then waits at most 10 s. A request-owned generation (§ 2) and a request-owned edit/commit run under `context.WithoutCancel(request)` — neither the request nor the shutdown cancels them; the process exit does, and the boot sweep cleans a generation's claim.

### 1.10 The candidate edit ledger (`projection_snapshot.edits`, `output_draft`)

Not a background unit — every write is synchronous on a request goroutine — but a second writer onto the same rows the claims own, so it is listed here.

- **Durable.** On a `pending_review` projection candidate: `output_draft` (the text the reader sees, with `<<<edit:id>>>` markers where an edit is undecided), `output_raw` (the model's untouched output), `edits` (a JSON array of `{id, sequence, type, status, contentBefore, contentAfter, blockIndex, fragmentId, inlinedText, anchorPrev, anchorNext, supersededBy, undoable, undoReason, createdAt, updatedAt}`; `type` ∈ `regeneration`/`refinement`/`manual`, `status` ∈ `proposed`/`approved`/`rejected`/`superseded`). `output` is `""` while pending; approval copies the draft into it.
- **Writers.** (a) `GenerateSnapshot` seeds it (§ 1.6). (b) `projections.ApplyEdit` (`POST …/edit`): replaces one block, appends a `manual` edit already `approved`, and — only under `KALAIDO_HAND_EDIT_CREATE_FRAGMENT` (or the `KALAIDO_CREATE_EDIT_FRAGMENTS` alias, read once at boot into the app store, default off) — writes an `edit` fragment and pins it on the parent's `current_context_spec` and the candidate's `context_spec`/`resolved_context`. (c) `projections.UpdateSnapshotEditStatus` (`PATCH …/edits/{eid}`): `approved`/`rejected` inline a `proposed` edit's marker (after/before text) and record its anchors for undo; `proposed` undoes an approved/rejected edit back to a marker when `undoable` (re-anchoring by adjacent blocks or inlined text; a failed undo does not persist). (d) The refinement chat bound to the candidate (`refinement.md` § 3): `ProposeRefineEdit`/`ReviseProposalEdit` on a `refine_candidate` tool call (a `refinement` edit, `proposed`, marker in the draft; a revision marks the old one `superseded` with `supersededBy`), and the apply leg's `MaterializeCandidateIfNew` (the whole draft re-diffed against `ResolveDraftBaseline` — markers replaced by their `contentBefore` — into new `regeneration` edits; prior edits marked `superseded`/`"regenerated"` except an `approved` edit whose `inlinedText` survives verbatim, which is kept and re-anchored; `lens_id` re-pointed at a fresh `lens` row; `output_raw`, `context_spec`, `resolved_context`, `generated_by_model` rewritten). `recomputeUndoable` runs after every write: an approved/rejected edit whose anchors are no longer adjacent, or whose inlined text is gone, becomes `undoable = false`, `undoReason = "another edit was made on top"`.
- **Engagement.** `CandidateEngaged` is true when any edit has `type` `manual` or `refinement` (whatever its status) or a `projection_refinement` row points at the candidate. It is read by the evaluator (`Candidate.Engaged` on the wire, § 4), by the wave (skip, § 1.5) and by the generate handler (refuse, § 2.4).
- **Guards.** Every writer loads the candidate inside its transaction and refuses when it is not `pending_review` (`ErrEditNotPending`); a block under an unresolved marker cannot be hand-edited or targeted (`ErrEditUnderMarker`); `ApproveSnapshot` and a commit onto a pending source refuse a draft that still holds a marker (`ErrNotApprovable: candidate has unresolved edits`).
- **Notices.** A hand edit and every triage write a `system` message (`data-hand_edit` / `data-edit_triage`) into the newest refinement bound to the candidate, in the same transaction, errors ignored; a chat regeneration writes `data-regenerate_superseded`.
- **Superseded / crash.** The ledger dies with the candidate: a claim completion or approval elsewhere marks the row `discarded` (§ 1.6) and the writers then refuse it. Nothing else to repair.

---

## 2. The worker manager as choreographer (`internal/workers/manager.go`)

`workers.New` builds the four services and wires the cross-worker hooks once: `maps.OnSettle(col.OnMapSettled)`, `maps.OnSettle(rec.OnMapSettled)` (in that order), `col.OnDrained(rec.EnqueueWave)`. `Start` runs each `Run` loop in the server errgroup; `BootKicks` runs `Colour.Signal()`, `Mapping.KickIfPending()`, `Reconcile.LogPolicy()`, `Reconcile.EnqueueWave()`.

### 2.1 Yield the wave

`yieldWave(strat, id)`: if `HasLiveClaim` (a `generating` row for the entity, any window, younger than the TTL) → return false (the caller will join); else `Reconcile.CancelWave()` → true iff a wave was running. Consequences: an interactive generation for an entity the wave is *not* producing cuts the wave short (its current model call included); one for the entity the wave *is* producing leaves the wave alone and joins its claim. The cancel happens before the interactive generation is attempted, so a generation that then fails (e.g. `ErrLensNotReady`; blocked upstream and the engaged candidate are checked earlier, in the handler, and refuse without reaching the manager) has still cancelled the wave.

### 2.2 Join or claim

`engine.GenerateOrJoin(ctx, joinCtx, …)`: `GenerateSnapshot` under `ctx` (the request context with cancellation removed, plus the fold-in mark when set); on `ErrGenerationInFlight` → `JoinGeneration` under `joinCtx` (the live request context, capped at the TTL) → on `ErrGenerationAbandoned` one more `GenerateSnapshot` from scratch. The joined result is the other run's snapshot with the other run's status: a request asking for `approved` that joins a wave claim receives a `pending_review` candidate id; a request whose client disconnects stops waiting but the generation it was waiting on continues. The fold-in mark rides only the request's own `GenerateSnapshot`, never a joined run.

### 2.3 After-generate enqueue

`afterGenerate(status, produced, yielded)`: `EnqueueWave()` when the wave was yielded, or when a generation produced an `approved` snapshot. `EnqueueWave` is a no-op without `KALAIDO_AUTO_WAVE`, so by default a wave cut short by an interactive generation is not resumed until the user presses Start again.

### 2.4 The three request entry points

`GenerateProjectionSnapshot` and `GenerateReflectionSnapshot` (one window) run yield → join-or-claim → after-generate. `GenerateReflectionWindows` (several windows) runs yield → `reflections.GenerateWindows` (concurrent claims, no join — a window already claimed by someone else fails that window with `ErrGenerationInFlight`, the response carries the others) → after-generate. All three run on the request goroutine: the HTTP response waits for the generation.

Before the projection entry point, `HandleGenerateCandidate` runs `reconcile.EvaluateEntity` on the live request context: `409` when `blockedBy` is non-empty; `409` `{kind: "candidate_engaged"}` when the pending candidate is engaged (§ 1.10) and the body's `discardEngaged` is false (an evaluation error is logged and the engagement check is redone directly with `FindPendingCandidate` + `CandidateEngaged`; the blocked check is then skipped). With `foldIn`, the generation context carries `WithSettleUnchanged` (§ 1.6) and, when the body also says `preview`, `refinement.CarryOpenRefinementToCandidate` runs after a successful generation: the newest `projection_refinement` bound to the newest approved snapshot (other than the new candidate) is re-pointed (`projection_snapshot_id`) at the returned candidate when that candidate is `pending_review`, belongs to the projection, and the conversation has no drafted lens; otherwise nothing moves (a settle-in-place returns the approved id, which is not pending). A carry failure is logged and the response is still `200`.

---

## 3. Signal and callback graph

Emitter → receiver, with the trigger. Every edge is described in the emitting side's doc; this table only names them.

| Emitter (where) | Receiver | Kind | When |
|---|---|---|---|
| `fragment` after-create hook (`server.RegisterTriggers`) | `Colour.Signal()` | signal | every fragment |
| same | `Mapping.SignalAnnotate()`, `Reconcile.EnqueueWave()` | signal / debounced request | fragment with `ingested_via != 'import'` (app notes, saved bookmarks, `POST /api/ingest`, and hand-edit fragments when `KALAIDO_HAND_EDIT_CREATE_FRAGMENT` is on) |
| `ingest` create hook (`ingest.RegisterHooks`) | runner task `processIngestRecord` | detached goroutine | every `ingest` row |
| `processIngestRecord` end | `Reconcile.EnqueueWave()` | request | ≥ 1 fragment landed |
| same | `Mapping.SignalAnnotate()` | signal | `organize_after` false |
| same (`startPipeline`) | `Mapping.AfterDrain(cb)` then `Mapping.Signal()` | one-shot callback + full-cycle signal | `organize_after` true |
| the `AfterDrain` callback | `Discover.Signal("colours"/"projections"/"reflections")` | signal | the next drain ended with `err == nil` (a single failed annotation, or quota exhaustion, drops the whole hand-off silently) |
| `mapping.cycle` (annotate goroutine on a full drain, or the consolidate ticker goroutine) | `colour.OnMapSettled` | settle hook (synchronous) | every cycle; recomputes thing rows only when `kalaidoscope_map.version` or the annotation count moved since the last settle (`settledMark`) |
| same, second | `reconcile.OnMapSettled` → `EnqueueWave()` | settle hook | every cycle |
| `colour.Run` after a drain | `Reconcile.EnqueueWave()` | drained hook | drain wrote ≥ 1 link |
| `engine.completeClaimedSnapshot` / `releaseClaim` | `claimHub.settle(claimID)` | in-process wake | claim filled or released; `AwaitGeneration` waiters re-read the row |
| `HandleApproveCandidate`, `HandleCreateColour`, `HandleUpdateColour` (prompt changed), `HandleRematchColour` | `Reconcile.EnqueueWave()` | request | after the write |
| `refinement.Commit` | `enqueueWave` (`Reconcile.EnqueueWave`) | request | after the commit transaction |
| `refinement.Commit` (reflection) and `HandleBackfillReflection` | `reflections.RunPendingWindows` | detached runner task | after commit / after materialisation |
| `HandleReconcile` | `Reconcile.StartWave()` | immediate signal | always |
| `HandleMapKick` | `Mapping.Signal()` | full-cycle signal | always |
| `HandleDiscoverKick` | `Discover.Signal(kind)` | signal | known kind |
| `discover.Worker.run` | `Mapping.WaitSettled()` | lock wait | start of every flow |
| `kalaidoscope_config` update hook | `llm.SetWorkspaceConfig`, `Scheduler.Reconfigure` | in-process | after the row commits |
| `queue.Scheduler.publishLocked` | `queueMirror.onChange` → `llm_queue_status` row | async callback, 300 ms debounce | every scheduler transition, progress every ≥ 500 ms |

Not on the graph: the fragment soft-delete hook signals nothing; discover creating colours or proposals signals nothing; a colour delete signals nothing; entity create/update/delete/restore signal nothing; a hand edit without the fragment flag, an edit triage (`PATCH …/edits/{eid}`), a refinement chat turn (including the candidate it writes or creates in its apply leg) and a fold-in carry-over signal nothing — the wave learns of them only through the next evaluation's `Candidate.Engaged`.

---

## 4. What the wire surfaces about in-flight work

| Surface | In-flight facts and their source |
|---|---|
| `GET /api/status` → `imports` | `pending` (count of `ingest.status = 'pending'`), `lastError` (newest `error` row) — rows only |
| `GET /api/status` → `map` | `state` (`empty`/`consolidating`/`annotating`/`unannotated`/`folding`/`settled`, selected in that order from `fragments`, `Consolidating()`, `pendingAnnotation && Annotating()`, `pendingAnnotation`, `unconsolidated`), `pendingAnnotation`, `unconsolidated`, `wantSettle`, `lastDrainError`, `lastRun{status,error,model,finished,interrupted}` where `interrupted = status=='running' && !Consolidating()` |
| `GET /api/status` → `discover` | `state` (`running`/`pending`/`never_run`/`due`/`settled`), `running` kind, `pending` kinds, `waitingOnMap`, `currentStarted`, `due` (no `done` run at the current map version), `runs[kind]{…,interrupted}` where `interrupted = status=='running' && running != kind`, `proposals` counts |
| `GET /api/status` → `colour` | `draining`, `currentColourId`, `lastStarted`, `lastCompleted`, `lastError`, `unjudgedFragments` (live fragments past each prompt colour's watermark) |
| `GET /api/status` → `reconcile`, and `GET /api/reconcile` | `running`, `lastStarted`, `lastError`, `lastCompleted`, `lastCancelled`, `currentEntity{id,type}`, `progress{completed,total}` — in-process only; `GET /api/reconcile` adds every live active entity's verdict (`newFragmentIds`, `staleDependencies`, `blockedBy`, `pendingWindows`, `staleWindows`, `upToDateSnapshotId`) and, for a projection with a pending candidate, `candidate{id, outdated, reason (lens_changed/model_changed/context_changed/new_fragments), engaged, newFragmentIds}` |
| `GET /api/status` → `policy.wave` | whether automatic waves are on |
| `GET /api/reflections/{id}/windows` | per window `generating` (a `generating` snapshot row exists for those bounds, TTL not consulted), `hasApproved`, `backfilled`, `stale`, `lensOutdated` |
| `projection_snapshot` / `reflection_snapshot` records (realtime) | the claim row itself, `status = 'generating'`, empty output; it becomes the candidate/approved row in place or disappears. A pending candidate's `output_draft` carries `<<<edit:id>>>` markers for undecided edits and `edits[]` their ledger (§ 1.10); both change in place on every hand edit, triage or chat turn |
| `POST …/refinements/{rid}/chat` SSE | a turn that ends on `data-regenerate_confirmation` (approved edits would be superseded) or `data-context_confirmation` (a proposed context change) has written nothing to the candidate and waits for the client's confirm/cancel send (§ 5.2 R5) |
| `llm_queue_status` singleton (realtime) | `state` (`idle`/`active`), `running[]` (role, priority, model, started, tokens, tokens_per_second), `waiting{priority: n}`, `held{reason, until}` |
| `ingest` records (realtime) | `status`, `ingested`, `error` |
| `map_run`, `discover_run` records | `status`, progress fields |

Not surfaced anywhere: which owner holds a claim (wave, request or backfill pass); the reconcile worker's pending debounce or retry timer; the mapping `followUps` and discover `followUps` queues; the ingest goroutine's per-file progress; whether a fold-in carry-over happened (only the refinement row's `projection_snapshot_id` moves).

---

## 5. The interaction matrix

### 5.1 How to read it

Rows are user-initiated actions (the route or hook that starts them). Columns are kinds of work that may be in flight when the action arrives:

- **C1** annotation drain (§ 1.1) · **C2** consolidation (§ 1.2) · **C3** colour drain (§ 1.3) · **C4** discover run (§ 1.4) · **C5** reconcile wave (§ 1.5) · **C6** a live generation claim on the *same* entity (§ 1.6; any owner) · **C7** a live claim on *another* entity · **C8** a queued or pre-emptable model call (a Background/Idle call admitted or waiting in the scheduler, `llm-queue-quota.md` § 2) · **C9** import processing (§ 1.8).

Outcome words, one per cell, describing the *action* unless the cell says otherwise:

- **joined** — the action's effect is absorbed by the running unit (or the action waits on its result).
- **queued behind** — the action's effect runs after the running unit, in order.
- **cancelled** — the running unit is cancelled by the action.
- **pre-empted** — the running model call is cancelled with `ErrPreempted` and its owner retries (only under a config with preemption on, i.e. the Ollama shape; under the hosted shape the call is ordered ahead by priority instead).
- **invalidated before write** — the action's write is refused or dropped because of the running unit before it lands.
- **written then superseded** — the action's write lands, and the running unit's later completion supersedes or overwrites it.
- **refused** — the action's handler rejects it because of the running unit.
- **unaffected** — the code path was read and no check against this unit exists on either side; both proceed; anything the action changes is seen by the unit only where its own next read happens (noted).

Pointers: `§ n` is this document; other pointers are sibling docs. Row notes below the matrix carry the qualifiers.

### 5.2 The matrix

| Action | C1 annotation drain | C2 consolidation | C3 colour drain | C4 discover run | C5 reconcile wave | C6 live claim, same entity | C7 live claim, other entity | C8 pre-emptable model call | C9 import processing |
|---|---|---|---|---|---|---|---|---|---|
| **R1** Generate a snapshot — `POST /api/projections/{id}/candidates`, `POST /api/projections/{id}/snapshots` (`preview`, `discardEngaged`, `foldIn`); `POST /api/reflections/{id}/snapshots`, `POST /api/reflections/{id}/generate-snapshot` | unaffected — § 1.6 | unaffected — § 1.6 | unaffected — § 1.6 | unaffected — § 1.4 | cancelled (the wave)¹⁹ — § 2.1 | joined²⁰ — § 2.2, `lifecycle-projection.md` § 4.1 | unaffected — § 1.6 | pre-empted (the background call) — `llm-queue-quota.md` § 2.4 | unaffected — § 1.6 |
| **R2** Approve a candidate — `POST /api/projections/{id}/candidates/{rid}/approve` | unaffected | unaffected | unaffected | unaffected | unaffected — `reconcile.md` § 3 | written then superseded¹ — § 1.6 | unaffected | unaffected | unaffected |
| **R3** Hand-edit a candidate — `POST /api/projections/{id}/candidates/{rid}/edit` | unaffected²¹ (joined, its edit fragment, with `KALAIDO_HAND_EDIT_CREATE_FRAGMENT`) — § 1.10 | unaffected — § 1.2 | unaffected²¹ (queued behind, its edit fragment, with the flag) — § 1.3 | unaffected | unaffected²² — § 1.5 | written then superseded — § 1.6, `lifecycle-projection.md` § 4.4 | unaffected | unaffected | unaffected |
| **R4** Open a refinement — `POST /api/projections/{id}/refinements`, `POST /api/reflections/{id}/refinements` | unaffected | unaffected | unaffected | unaffected | unaffected²² (the row itself makes the candidate engaged) — § 1.10 | unaffected² — `refinement.md` § 2 | unaffected | unaffected | unaffected |
| **R5** Refinement chat turn / window re-apply / regenerate confirm–cancel / context confirm–cancel — `POST /api/projections/{id}/refinements/{rid}/chat`, `POST /api/reflections/{id}/refinements/{rid}/chat` | unaffected | unaffected | unaffected | unaffected | unaffected²² — § 1.5 | written then superseded²³ (projection; the candidate it writes) — § 1.10, `refinement.md` § 3; unaffected (reflection) | unaffected | pre-empted (the background call) — `llm-queue-quota.md` § 2.4 | unaffected |
| **R6** Commit a refinement — `POST /api/projections/{id}/refinements/{rid}/commit`, `POST /api/reflections/{id}/refinements/{rid}/commit` | unaffected | unaffected | unaffected | unaffected | unaffected³ — § 3 | written then superseded⁴ — § 1.6 | unaffected | unaffected | unaffected |
| **R7** Delete an entity — `DELETE /api/projections/{id}`, `DELETE /api/reflections/{id}` | unaffected | unaffected | unaffected | unaffected⁵ — `discover.md` § 5 | unaffected (the wave skips it) — `reconcile.md` § 3.1 | refused (409) — § 1.6, `lifecycle-projection.md` § 6 | unaffected⁶ | unaffected | unaffected |
| **R8** Restore an entity — `POST /api/projections/{id}/restore`, `POST /api/reflections/{id}/restore` | unaffected | unaffected | unaffected | unaffected | unaffected — `reconcile.md` § 1 | unaffected | unaffected | unaffected | unaffected |
| **R9** Update an entity — `PATCH /api/projections/{id}`, `PATCH /api/reflections/{id}` | unaffected | unaffected | unaffected | unaffected | unaffected | unaffected⁷ — § 1.6 | unaffected | unaffected | unaffected |
| **R10** Create an entity — `POST /api/projections`, `POST /api/reflections` | unaffected | unaffected | unaffected | unaffected | unaffected — `reconcile.md` § 2 | unaffected | unaffected | unaffected | unaffected |
| **R11** Create a colour — `POST /api/colours` | unaffected | unaffected | queued behind — § 1.3 | unaffected — § 1.4 | unaffected — § 3 | unaffected | unaffected | unaffected | unaffected |
| **R12** Edit a colour / rematch — `PATCH /api/colours/{id}`, `POST /api/colours/{id}/rematch` | unaffected | unaffected | queued behind; written then superseded if the drain is on this colour⁸ — § 1.3 | unaffected | unaffected — § 3 | unaffected | unaffected | unaffected | unaffected |
| **R13** Delete a colour — `DELETE /api/colours/{id}` | unaffected | unaffected | unaffected⁹ — § 1.3 | unaffected¹⁰ — `discover.md` § 5 | unaffected — `colours.md` § 6 | unaffected — `context.md` § 5 | unaffected | unaffected | unaffected |
| **R14** Write a fragment from the app — `POST /api/ingest`; `POST /api/explore/conversations/{cid}/bookmarks/save`; the R3 edit fragment when the flag is on | joined — § 1.1 | queued behind — § 1.2 | queued behind — § 1.3 | unaffected — § 1.4 | unaffected¹¹ — `reconcile.md` § 1 | unaffected — § 1.6 | unaffected | unaffected | unaffected¹² |
| **R15** Import a batch — `ingest` record create (hook) | joined — § 1.1 | queued behind — § 1.2 | queued behind — § 1.3 | queued behind (its discover hand-off) — § 1.8, `ingestion.md` § 8 | unaffected¹¹ | unaffected | unaffected | unaffected | unaffected¹² |
| **R16** Delete a fragment — `fragment` delete request (hook, soft delete) | unaffected¹³ — § 1.1 | unaffected — § 1.2 | unaffected¹³ — § 1.3 | unaffected | unaffected¹⁴ | unaffected¹⁴ | unaffected¹⁴ | unaffected | unaffected |
| **R17** Change provider config — `kalaidoscope_config` update (hook) | unaffected¹⁵ — `models.md` § 5 | unaffected¹⁵ | unaffected¹⁵ | unaffected¹⁵ | unaffected¹⁵ (per entity) | unaffected¹⁵ | unaffected¹⁵ | unaffected¹⁶ — `llm-queue-quota.md` § 2.2 | unaffected |
| **R18** Start a wave — `POST /api/reconcile` | unaffected — § 1.5 | unaffected | unaffected | unaffected | queued behind — § 1.5 | unaffected (the wave skips the entity) — `reconcile.md` § 3.1 | unaffected (the wave skips the entity) | queued behind — `llm-queue-quota.md` § 2.3 | unaffected |
| **R19** Kick the map — `POST /api/map` | queued behind — § 1.1 | queued behind — § 1.2 | unaffected | unaffected | unaffected | unaffected | unaffected | queued behind — `llm-queue-quota.md` § 2.3 | unaffected |
| **R20** Kick discover — `POST /api/discover` | unaffected¹⁷ — § 1.4 | queued behind — § 1.4 | unaffected | queued behind — § 1.4 | unaffected | unaffected | unaffected | queued behind — `llm-queue-quota.md` § 2.3 | unaffected |
| **R21** Backfill a reflection — `POST /api/reflections/{id}/backfill` | unaffected | unaffected | unaffected | unaffected | unaffected¹⁸ — § 1.7 | unaffected (the pass skips the live window) — § 1.7 | unaffected | queued behind — `llm-queue-quota.md` § 2.3 | unaffected |
| **R22** Interactive model calls that write no entity — `POST /api/explore`, `POST /api/explore/conversations/{cid}/brief`, `POST /api/colours/preview` | unaffected | unaffected | unaffected | unaffected | unaffected | unaffected | unaffected | pre-empted (the background call) — `llm-queue-quota.md` § 2.4 | unaffected |
| **R23** Accept / reject / undo a candidate edit — `PATCH /api/projections/{id}/candidates/{rid}/edits/{eid}` (`status` ∈ `approved`/`rejected`/`proposed`) | unaffected — § 1.10 | unaffected | unaffected | unaffected | unaffected²² — § 1.5 | written then superseded²⁴ — § 1.10, § 1.6 | unaffected | unaffected | unaffected |

Row notes (the qualifiers each cell points at):

1. R2×C6: the approval lands (a `pending_review` candidate is approved regardless of a live claim; `output` is filled from `output_draft` when empty). When the claim fills as `pending_review` (a wave or a `preview` request), the approval stands and a fresh candidate appears beside it. When the claim's owner asked for `approved` (an interactive generate without `preview`), the claim's own `ApproveSnapshot` takes the next sequence number and supersedes the approval. Approving the claim row itself is refused `422` (`ErrNotApprovable: generation still running`); a `discarded` row likewise; a draft still holding an `<<<edit:id>>>` marker likewise (`candidate has unresolved edits`); an already-approved row is a `200` no-op.
2. R4×C6: opening with `snapshotId` naming the claim row seeds the session from that row's `context_spec`, which is empty on a claim row, and binds the refinement to a row that will become the candidate (or vanish on release).
3. R6×C5: the commit lands; `EnqueueWave` is a no-op without `KALAIDO_AUTO_WAVE`; a reflection commit starts a pending-windows pass (§ 1.7) whatever the wave is doing. The wave's later entities read the new lens because each `GenerateSnapshot` resolves the lens at its own start.
4. R6×C6: the commit lands (projection: the refinement's pending source candidate is approved in place under the new lens with `output = output_draft` — refused when a marker remains — or, without a pending source, a new row is appended and approved; reflection: the lens only). The live claim resolved the *old* lens before the commit and fills afterwards under it: as a `pending_review` candidate (wave) beside the new-lens approved row, or — when its owner asked for `approved` — as a later approved row, superseding the commit's output with old-lens output. For a reflection window the filled row reads as `lensOutdated`.
5. R7×C4: a proposal naming the deleted projection as a source is rejected at dispatch (`projections.FindLive`).
6. R7×C7: the delete scrubs the deleted id from every live `current_context_spec` in the same transaction; the other entity's running generation already resolved its spec, so its snapshot records the deleted upstream's snapshot id in `resolved_context` and the old spec in `context_spec`.
7. R9×C6: the running generation keeps the model and window it resolved at its start; the snapshot is stamped with that model. A schedule edit does not move a claimed window (rows carry their bounds and stay in the series).
8. R12×C3: `Rematch` deletes the prompt rows, clears the watermark, recomputes thing rows and signals; the next drain re-judges from the start. If the running drain is on this colour, it holds the record loaded at drain start and saves it after every page (`prompt_match_completed_up_to_fragment_id`), and on a provider error (`last_provider_error_kind`): each such save writes the stale record — prompt, name and watermark as they were when the drain began — over the edit. Name-only edits and example edits do not rematch; example edits write `colour_fragment` rows only.
9. R13×C3: the drain's colour list was loaded at its start; when it reaches the deleted colour it judges its pages against the in-memory record (model calls spent), link inserts fail on the missing relation (recorded as the colour's error, drain continues), and the watermark save updates a row that no longer exists.
10. R13×C4: the run's colour set was loaded at its start; `resolveColours` resolves against that set, so a proposal written after the delete can pin the deleted colour id in its `current_context_spec`.
11. R14/R15×C5: `EnqueueWave` is requested (no-op without `KALAIDO_AUTO_WAVE`); the running wave's entities already generated do not see the new fragments; the next evaluation reports them as `newFragmentIds` (and, for a pending candidate, `candidate.newFragmentIds` with `reason = new_fragments`).
12. R14/R15×C9: writers are independent; each import's dedupe set is preloaded once at its start, so a duplicate written concurrently (by another import or from the app) is not detected.
13. R16×C1/C3: the next pass or page excludes it (`deleted_at = ''`); a fragment already dispatched in the current pass/page is still annotated / judged and its row written.
14. R16×C5/C6/C7: no signal fires on delete. Resolution happens at each generation's start, so a snapshot in flight keeps the deleted fragment in `resolved_context`. The evaluator's diff reports additions only, so a deletion never makes an entity stale on the wire; `SnapshotIsCurrent`/`SnapshotCurrency` (the wave's dedup guard and the candidate verdict) count removals as well.
15. R17: each unit resolves its model once (annotation drain: per drain; consolidation: per cycle; colour drain: per drain; discover: per run; wave and claims: per `GenerateSnapshot`; a refinement turn: per turn). The provider object, however, is built per call from the *active* config (`llm.SelectedProvider(model)`), so a unit in flight sends its remaining calls to the new provider under the model name it resolved before the change. The hook itself refuses the update (`400`) when a required credential/model fails a live check made directly against the provider, outside the scheduler.
16. R17×C8: `Reconfigure` applies to subsequent dispatch (a lowered concurrency takes effect as running calls finish; the preemption policy changes for the next Interactive arrival); running calls are not cancelled.
17. R20×C1: a discover run waits only for a consolidation (`WaitSettled`), not for an annotation drain; kicked mid-drain it reads the current map document and records its `map_version`, and becomes `due` again as soon as the drain settles a new version.
18. R21×C5: no yield; the pass and the wave run concurrently, and whichever reaches a window second gets `ErrGenerationInFlight` and skips that window (the wave moves to its next window; the pass leaves it).
19. R1×C5: the handler's own refusals come first and cancel nothing: `409` blocked upstream, `409` `{kind: "candidate_engaged"}` when the projection's pending candidate is engaged and `discardEngaged` is false (§ 2.4). Past them, `yieldWave` cancels the wave unless it holds this entity's claim. With `discardEngaged` true the engaged candidate is left in place until the claim completes (or settles in place), which marks it `discarded`.
20. R1×C6: the request joins the live claim and receives that run's row with that run's status. A `foldIn` request that joins receives the other run's candidate untouched by the fold-in mark (§ 2.2); with `preview` it still carries the approved snapshot's lens-less refinement over to that candidate. A `foldIn` request that claims for itself and reproduces the approved output settles the approved row in place and returns its id; nothing is carried (the id is not a pending row).
21. R3×C1/C3: by default (`KALAIDO_HAND_EDIT_CREATE_FRAGMENT` unset) a hand edit writes only the candidate row — no fragment, no hook, no signal. With the flag on it also writes an `edit` fragment (`ingested_via = 'app'`), which the fragment hook hands to the annotation drain (joined), the colour drain (queued behind) and `EnqueueWave`, and pins it on the parent's `current_context_spec` and the candidate's `context_spec`/`resolved_context`.
22. R3/R4/R5/R23×C5: the wave's worklist and each entity's `Candidate.Engaged` were evaluated when the wave started; an edit, an opened refinement, a chat proposal or a triage made after that does not stop this wave from generating the entity (its claim completion discards the candidate, § 1.6, and the writers then refuse the discarded row). The *next* evaluation reports `engaged = true` and the next wave skips the entity. Rejecting or undoing an edit does not clear engagement: `CandidateEngaged` counts `manual`/`refinement` edits of any status.
23. R5×C6 (projection): a turn's `refine_candidate` call writes a marker into the bound candidate's `output_draft` (`ErrEditNotPending` when the row is not pending, reported to the model as `ok: false`); the apply leg (first lens, `regenerate_from_lens`, window re-apply, or a `data-regenerate_confirm` send) rewrites the bound pending candidate in place — draft re-diffed, prior edits superseded, a fresh `lens` row as its `lens_id` — or, when the bound row is not pending, appends a new `pending_review` row *without a claim and without discarding siblings* and re-points the refinement at it. A live claim on the entity neither blocks nor is blocked by any of this; its completion marks whichever pending row is not the claim `discarded`. A turn that calls `regenerate_from_lens` while the candidate holds `approved` edits ends on `data-regenerate_confirmation` and writes nothing; `data-regenerate_cancel` and `data-context_cancel` sends write only the message itself. A `data-context_confirm` send continues as an ordinary turn under the new `context_spec`. A reflection refinement writes no candidate (`MaterializeCandidateIfNew` returns early).
24. R23×C6: the triage rewrites `output_draft` and `edits` on the pending candidate in one transaction; a claim completing afterwards discards the row and the next triage on it is refused `409` (`ErrEditNotPending`). Refusals independent of in-flight work: `400` unknown `status` or undoing an edit that is neither `approved` nor `rejected`; `404` unknown edit id or marker missing from the draft; `409` edit already resolved (accept/reject of a non-`proposed` edit), not undoable (`undoReason`), or anchors no longer adjacent / inlined text gone (the row is not changed on that failure).

Refusals independent of in-flight work (for completeness of the rows): R1 `409` when the evaluator reports `blockedBy`, `409` `candidate_engaged`, `409` `ErrLensNotReady`, `404` on a missing or soft-deleted entity, `400` on an unknown `windowId` or several pending windows without `allWindows`; R3 `400` `blockPosition` out of range, `409` source not `pending_review` or block under an unresolved marker, `422` no change; R5 `400` when the refinement's parent is missing or soft-deleted; R6 `400` no drafted lens / parent mismatch, `409` no preview output and no draft on the source candidate, `500` when the parent is soft-deleted (`FindLive` inside the commit transaction) or the source candidate holds an unresolved marker; R7 `404`; R9 `404` on a soft-deleted entity, `400` invalid window spec; R20 `400` unknown kind; R21 `400` `from` not before the covered grid, `404`; R23 as in note 24.

### 5.3 Mutating routes with no interaction

`POST /api/llm/validate` (a live provider call made directly, outside the scheduler, writing nothing), `POST /api/llm/count-tokens` (a local estimate, no model call), `PATCH /api/explore/conversations/{cid}/messages/{mid}/bookmark` (one `chat_message.bookmarked` write), `POST /api/ollama/pull` (an HTTP call to the local Ollama daemon, outside the scheduler; it does not touch the database). None of these reads or writes a worker, a claim, or a scheduler slot.

Every other mutating registration appears in § 5.2: R1 (4 routes), R2, R3, R4 (2), R5 (2), R6 (2), R7 (2), R8 (2), R9 (2), R10 (2), R11, R12 (2), R13, R14 (`POST /api/ingest`, bookmarks save), R18, R19, R20, R21, R22 (3), R23 — 34 routes — plus the 4 above = 38; the three hook-modified endpoints are R15, R16 and R17.
