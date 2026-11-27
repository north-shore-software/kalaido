# K-345 — Go Server (`kalaidoscope/`) Projection & Reconcile Simplification Plan

## Context

Projections originally assumed a proactive **"change of plan as decision point"** workflow: newly ingested fragments, colour changes, map settles, approvals, and refinements triggered workspace-wide **reconcile waves** that speculatively cascaded updates down a projection dependency DAG and pushed the user to review and approve every upstream before any downstream could regenerate.

Kalaido has moved away from that push/cascade model:

- **Projections are updated manually on demand (pull).** Nothing in the server proactively triggers or cascades projection regenerations, and upstream staleness never blocks manual regeneration with `409`.
- **Passive freshness stays.** The server still evaluates whether an active projection's sources (`newFragmentIds` and 1-hop `staleDependencies`) or pending candidate (`candidate`) have drifted since last generation.
- **Candidate review & editing stay.** Manual regeneration with `preview: true` still creates a `pending_review` candidate using the 3-turn minimal-diff rewrite (`minimizeAgainstPrevious`) and `<<<edit:id>>>` block diff markers; hand-edits, hunk approve/reject/undo, `refine_candidate`, `CandidateEngaged` (`discardEngaged`), `CandidateStatus`, and `FoldIn` (`WithSettleUnchanged` + `settleApprovedInPlace` + `CarryOpenRefinementToCandidate`) remain intact.
- **Reflections remain lazy + schedule-windowed**, with an external cloud cron calling a single synchronous workspace-wide endpoint (`POST /api/reflections/generate-pending`) to generate pending windows across active reflections while holding the Cloudflare container awake.

---

## Scope & Guardrails

- **Go backend only (`kalaidoscope/`):** Do not touch `packages/*`, `apps/*`, or Tauri code in this pass.
- **No SQLite schema changes:** Leave `projection_snapshot.generation_trigger` and `reflection_snapshot.generation_trigger` inert in `kalaidoscope/schema/canonical.go` (no migration delta).
- **Generated audit docs (`kalaidoscope/docs/*.md`):** Follow `kalaidoscope/AGENTS.md` strictly — **never edit doc prose**. For every doc whose described code behaviour changes and that does not already carry the marker, prepend only:
  ```markdown
  > **STALE** — code has changed since this document was generated.

  ```

---

## 1. Remove Background Reconcile Wave Worker, Route, Wire State, & `KALAIDO_AUTO_WAVE`

1. **Delete wave worker & wave-only tests:**
   - Delete `kalaidoscope/internal/reconcile/worker.go`.
   - Delete `kalaidoscope/internal/reconcile/worker_test.go`, `kalaidoscope/internal/reconcile/timing_test.go`, and `kalaidoscope/internal/reconcile/settle_test.go`.
2. **Remove `POST /api/reconcile` and wave wire fields:**
   - `kalaidoscope/server/server.go`: remove `se.Router.POST("/api/reconcile", ...)` and drop `deps.Reconcile` from `GET /api/reconcile`.
   - `kalaidoscope/internal/handlers/reconcile.go`: delete `HandleReconcile`; update `HandleGetReconcile(app core.App)` to return `api.ReconcilePlanResponse{Statuses: statuses}` only.
   - `kalaidoscope/internal/api/reconcile.go`: remove `CurrentEntityInfo`, `WaveProgress`, `ReconcileStatus`, and the embedded `ReconcileStatus` field on `ReconcilePlanResponse` (keep `EntityStatus` and `ReconcilePlanResponse{Statuses []EntityStatus}`).
   - `kalaidoscope/internal/api/status.go`: remove `Reconcile ReconcileStatus`, `Policy StatusPolicy`, and `type StatusPolicy`.
   - `kalaidoscope/internal/status/status.go` & `kalaidoscope/internal/handlers/deps.go`: remove `Reconcile *reconcile.Worker` from `status.Workers` and `statusWorkers()`, and remove `st.Reconcile` / `st.Policy.Wave` assignment (update `status_test.go` in `internal/status/` and `internal/handlers/`).
3. **Remove `KALAIDO_AUTO_WAVE` / `AutoWave` configuration:**
   - `kalaidoscope/internal/config/env.go`: remove `Env.AutoWave` and `parseBool("KALAIDO_AUTO_WAVE", ...)` (update `env_test.go`).
   - `kalaidoscope/cmd/sidecar/main.go`: remove `AutoWave: env.AutoWave`.
   - `kalaidoscope/server/server.go` & `kalaidoscope/server/runtime.go`: remove `Options.AutoWave` and `workers.Options{AutoWave}`.

---

## 2. Remove All `EnqueueWave` Push Triggers & `workers.Manager` Wave Wrappers

1. **`kalaidoscope/internal/workers/manager.go`:**
   - Remove `Options`, `Manager.Reconcile`, `maps.OnSettle(rec.OnMapSettled)`, `col.OnDrained(rec.EnqueueWave)`, and `rec` from `services`.
   - Remove `m.Reconcile.LogPolicy()` and `m.Reconcile.EnqueueWave()` from `BootKicks()`.
   - Remove `yieldWave`, `afterGenerate`, `GenerateProjectionSnapshot`, `GenerateReflectionSnapshot`, and `GenerateReflectionWindows` (update `manager_test.go`). Handlers call `engine.GenerateSnapshot` and `reflections.GenerateWindows` directly.
2. **`kalaidoscope/internal/colour/worker.go`:**
   - Remove `OnDrained`, the `drained []func()` field, and the post-drain callback loop (its sole registrant was `rec.EnqueueWave`).
3. **Hook & handler call sites:**
   - `kalaidoscope/server/server.go`: remove `rt.workers.Reconcile.EnqueueWave()` in `OnRecordAfterCreateSuccess("fragment")` and remove `Reconcile` from `ingest.Deps`.
   - `kalaidoscope/internal/ingest/batch.go`: remove `Deps.Reconcile` and `if total > 0 { deps.Reconcile.EnqueueWave() }` (update `server/ingest_test.go` if needed).
   - `kalaidoscope/internal/handlers/colour.go`: remove `deps.Reconcile.EnqueueWave()` in `HandleCreateColour`, `HandleUpdateColour`, and `HandleRematchColour`.
   - `kalaidoscope/internal/handlers/projections.go`: remove `deps.Reconcile.EnqueueWave()` in `HandleApproveCandidate` (drop unused `deps` parameter from `HandleApproveCandidate` and `server/server.go`).
   - `kalaidoscope/internal/handlers/refinements.go` & `kalaidoscope/internal/refinement/session.go`: remove `enqueueWave func()` parameter and call from `refinement.Commit` (drop unused `deps` parameter from `HandleCommitProjectionRefinement` if no longer needed, or pass `nil` runner for projections while keeping `deps.Runner` for reflections; update `refinement` / `handlers` tests).

---

## 3. Remove Speculative Chain Plumbing (`TriggerGenerateAll`) & `SnapshotIsCurrent`

1. **`kalaidoscope/internal/llmcontext/chain.go`:**
   - Remove `TriggerGenerateAll`, `generationTriggerKey`, `WithGenerationTrigger`, and `GenerationTriggerFromContext`.
   - Keep `WithSettleUnchanged` and `SettleUnchangedFromContext` (used by `FoldIn`).
2. **`kalaidoscope/internal/llmcontext/resolve.go`:**
   - Simplify `snapshotFilterAndSort` so upstream projections and reflections always resolve strictly to `status = 'approved'` ordered by `-approval_sequence_number` (update `resolve_test.go`).
3. **Engine & strategies:**
   - `kalaidoscope/internal/engine/strategy.go`: remove `InheritsCandidateTrigger() bool` and remove `trigger string` from `CommitRefinementSnapshot(...)` (update `strategy_test.go`).
   - `kalaidoscope/internal/projections/projections.go` & `kalaidoscope/internal/reflections/reflections.go`: remove `InheritsCandidateTrigger()` and `trigger` parameter on `CommitRefinementSnapshot`.
   - `kalaidoscope/internal/engine/lifecycle.go`: remove `SnapshotSpec.GenerationTrigger`, stop stamping `generation_trigger` in `applySnapshotSpec`, and remove the `InheritsCandidateTrigger` block in `CommitRefinement` (update `lifecycle_commit_test.go`).
   - `kalaidoscope/internal/engine/snapshot.go`:
     - On the settle-in-place condition (`if unchanged && ...`), check `llmcontext.SettleUnchangedFromContext(ctx)` only.
     - Delete `SnapshotIsCurrent` (keep `SnapshotCurrency` and `Currency*` constants, which power `CandidateStatus`; update `snapshot_settle_test.go` / `snapshot_guard_test.go`).

---

## 4. Remove Recursive `BlockedBy` DAG, `topoSort`, & `409` Upstream Blocking

1. **`kalaidoscope/internal/api/reflections.go`:**
   - Remove `BlockedBy []string` from `ReflectionStatus` (`EntityStatus`). Keep `UpToDateSnapshotID`, `NewFragmentIDs`, `StaleDependencies`, `PendingWindows`, `StaleWindows`, and `Candidate`.
2. **`kalaidoscope/internal/reconcile/evaluator.go`:**
   - Remove `deps` and `dependents` from `node`, delete the edge-building loop, delete `topoSort`, and delete the `blockedBy` lookup/precedence block in `evaluateNode`.
   - `StaleDependencies` remains a direct 1-hop check from `currentPinned.Diff(recordedPinned).SnapshotIDs` mapped to parent projection/reflection IDs (sorted).
   - Rewrite `EvaluateEntity(ctx, app, id)` so it loads and evaluates **only** the single target projection or reflection (`status = 'active' && deleted_at = ''`) rather than running `EvaluateAll` across the entire database (update `evaluator_test.go`).
3. **Generate handlers:**
   - `kalaidoscope/internal/handlers/projections.go` (`HandleGenerateCandidate`): remove `reconcile.EvaluateEntity` and the `len(st.BlockedBy) > 0` `409` branch; check `engine.FindPendingCandidate` + `engine.CandidateEngaged` directly for the `409 candidate_engaged` guard, and call `engine.GenerateSnapshot(genCtx, app, id, status, projections.Strategy{}, nil)` directly (drop `deps` parameter from `HandleGenerateCandidate` and `server/server.go`).
   - `kalaidoscope/internal/handlers/reflections.go` (`HandleGenerateReflectionSnapshot`): keep `reconcile.EvaluateEntity` (now single-entity) for `st.StaleWindows` passed into `reflections.WindowsToGenerate`, remove the `len(st.BlockedBy) > 0` `409` branch, and call `engine.GenerateSnapshot` (1 window) or `reflections.GenerateWindows` (multiple windows) directly (drop `deps` parameter from `HandleGenerateReflectionSnapshot` and `server/server.go`).

---

## 5. Remove In-Flight Claim Joining (Return `409` When Already Generating)

1. **Delete files:**
   - Delete `kalaidoscope/internal/engine/claimhub.go` and `kalaidoscope/internal/engine/claimhub_test.go`.
   - Delete `kalaidoscope/internal/engine/genclaim_await_test.go` and `kalaidoscope/internal/handlers/generate_join_test.go` (replace with a handler test verifying concurrent generate returns `409`).
2. **`kalaidoscope/internal/engine/genclaim.go` & `kalaidoscope/internal/engine/lifecycle.go`:**
   - Delete `ErrGenerationAbandoned`, `awaitPollInterval`, `AwaitGeneration`, `GenerateOrJoin`, `JoinGeneration`, and `claims.settle(claimID)` calls in `releaseClaim` and `completeClaimedSnapshot`.
   - Keep `StatusGenerating`, `StatusDiscarded`, `ErrLensNotReady`, `ErrGenerationInFlight`, `ErrNotApprovable`, `GenerationClaimTTL`, `ClaimGeneration`, `HasLiveClaim`, `releaseClaim`, `discardOtherPending`, and `SweepGenerationClaims`.
   - When `ClaimGeneration` returns `ErrGenerationInFlight`, `handlers.WriteGenerateError` already returns `409 "A generation for this <projection|reflection> is already running."`.

---

## 6. Add Workspace-Wide Pending Reflections Endpoint (`POST /api/reflections/generate-pending`)

1. **Route (`kalaidoscope/server/server.go`):**
   - Register `se.Router.POST("/api/reflections/generate-pending", handlers.HandleGeneratePendingReflections(app))` in the `// Reflections` block (before parameterized `/api/reflections/{id}/...` routes, though PocketBase's mux distinguishes literal segments from `{id}` when paths differ in segment count).
2. **Behaviour (`kalaidoscope/internal/reflections/` & `kalaidoscope/internal/handlers/reflections.go`):**
   - Query all live active reflections: `status = 'active' && deleted_at = ''` (`engine.LiveFilter`).
   - For each reflection, compute `PendingWindows(app, rec, time.Now())` **only** (windows on the governing grid or backfilled in `reflection_window` that have neither an `approved` snapshot nor an active `generating` claim — do **not** regenerate already-approved stale or lens-outdated windows, and never touch projections).
   - If a reflection has pending windows, run `GenerateWindows(ctx, app, rec.Id, engine.StatusApproved, pending)` **synchronously** on the request goroutine (`context.WithoutCancel(e.Request.Context())` so a client hiccup mid-call doesn't corrupt writes, while blocking the HTTP response until completion so Cloudflare containers stay awake).
   - Per-window error handling matches `GeneratePendingWindows`: skip/warn on `engine.ErrLensNotReady`, silently skip `engine.ErrGenerationInFlight`, log other window errors without aborting remaining reflections, and collect all produced `snapshotIds`.
   - Return `200 OK` with `api.ReflectionSnapshotResponse{SnapshotIDs: snapIDs}` (empty slice `[]` when nothing was pending).
3. **Tests:**
   - Add integration coverage verifying `POST /api/reflections/generate-pending`:
     - Generates pending windows across multiple active reflections synchronously and returns their `snapshotIds`.
     - Ignores `proposed` and soft-deleted reflections, ignores projections completely, skips lensless (`ErrLensNotReady`) reflections without failing others, and does **not** regenerate windows that already have an `approved` snapshot (even if stale/backdated fragments exist).

---

## 7. Mark Affected Audit Docs Stale (`kalaidoscope/docs/*.md`)

Prepend `> **STALE** — code has changed since this document was generated.` (followed by a blank line) to any of these files that do not already start with it — **touch nothing else in `docs/`**:

- `kalaidoscope/docs/api.md`
- `kalaidoscope/docs/boot-and-workers.md` *(already marked stale — verify and leave as-is)*
- `kalaidoscope/docs/colours.md`
- `kalaidoscope/docs/context.md`
- `kalaidoscope/docs/coordination.md`
- `kalaidoscope/docs/ingestion.md`
- `kalaidoscope/docs/lifecycle-projection.md`
- `kalaidoscope/docs/lifecycle-reflection.md`
- `kalaidoscope/docs/map.md`
- `kalaidoscope/docs/reconcile.md`
- `kalaidoscope/docs/refinement.md`

---

## 8. Verification

Run from repo root via `./kalaido.sh` (or `./kalaido-mac.sh` if required by container environment):

```bash
./kalaido.sh check:go && ./kalaido.sh test:go && ./kalaido.sh check:schema-freshness
```
