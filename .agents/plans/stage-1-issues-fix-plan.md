# Stage 1 (Projections) — Issues Fix Plan

> **Source issues:** [stage-1-issues.md](./stage-1-issues.md) (Issues 1–5)
> **Scope:** Projections only (Go backend + TS client + React features + Desktop route wiring). Zero `canonical.go` migrations; Reflections untouched.

---

## Summary of Fixes by Issue

| Issue | Core Change |
|---|---|
| **1 — List Row Status & Direct Update** | Remove `candidate` pill from Name and `Review candidate` icon from far right. Consolidate timestamp, `draft in progress`, `X new since`, and an inline **Update / Refresh** icon button (available even at 0 new fragments) in the "Last generated" status column. |
| **2 — Session-Driven "Draft in Progress"** | Drive `draft in progress` from **either** an open `pending_review` snapshot **or** an active unbound `projection_refinement` session (before first draft text exists), so it appears the moment a session begins until Save or Discard. |
| **3 — Immediate Navigation + Skeleton on Update** | Make Update async-claim on the server (`POST /api/projections/{id}/candidates` with `{ async: true, discardExisting?: boolean }`): returns `{ snapshotId: claimID }` immediately while generation runs in background. UI navigates straight to the session screen, showing a pulsating left-canvas skeleton + chat progress until SSE delivers the ready draft (or inline error + Retry/Back on failure). |
| **4 — No Full-Draft Confirmation on Update** | In `RunAnchoredUpdate`, when `ExceedsFullRewriteThreshold` trips, swap `output_draft` wholesale (clean new draft, `edits = []`, no `data-full_rewrite_confirmation`) and explicitly state in the opening chat message that the full draft was replaced. Keep the confirmation gate for mid-session chat rewrites. |
| **5 — Single-Draft Lifecycle & Discard** | (a) Discarding a **never-saved** projection removes the unsaved projection completely (hard-deletes user-created ones so no zombie row appears in the list or Recently Deleted; reverts Discover-created ones back to `proposed`). (b) On a **saved** projection with an open draft, `ProjectionFreshnessCard` offers **Resume draft** + **Discard & start fresh** (with confirm), and list-row **Update** on a row with an open draft follows the same confirm-discard-and-start-fresh flow. |

---

## 1. Go Backend (`kalaidoscope/`)

### 1.1 Wholesale Swap on Large Updates (Issue 4)
- **`kalaidoscope/internal/projections/update.go` (`RunAnchoredUpdate`):**
  - Replace the `case engine.ExceedsFullRewriteThreshold(prevOutput, updatedDoc):` branch:
    - Set `outputDraft = updatedDoc`, `outputRaw = updatedDoc`, `edits = []api.SnapshotEdit{}` (no `fullRewriteConfirm`).
    - Prepend/set a clear explanation in `summary` (e.g., `"Because the new sources changed most of the document, I replaced the full draft rather than showing line-by-line diffs.\n\n" + summary`), so the opening assistant message clearly communicates the wholesale replacement.
  - Leave mid-session `update_draft` / `request_full_rewrite` confirmation behavior in `internal/refinement/projection_chat.go` unchanged.

### 1.2 Async-Claim Update & Error Status Tracking (Issues 3 & 5)
- **`kalaidoscope/internal/api/projections.go`:**
  - Extend `GenerateProjectionSnapshotRequest` with `Async bool` (`json:"async,omitempty"`) and `DiscardExisting bool` (`json:"discardExisting,omitempty"`).
  - Add `ProjectionCandidateStatusResponse { Status string; Error string }` (`"generating" | "ready" | "error"`).
- **`kalaidoscope/internal/projections/update.go`:**
  - Add a lightweight per-app in-memory update-error map (same pattern as `brief.go`'s in-flight tracker): `recordUpdateError(app, claimID, err)` / `GetCandidateUpdateStatus(app, projectionID, claimID)`.
  - Refactor `RunAnchoredUpdate` into two clean halves:
    1. **`PrepareAnchoredUpdate(ctx, app, projectionID, discardExisting)`** (synchronous, <10ms):
       - Validates `FindLive(app, projectionID)` and that either an approved snapshot or standing lens exists (`ErrLensNotReady` fails fast before navigating).
       - If `discardExisting` is true, discards any existing `pending_review` candidate(s) in a transaction before claiming.
       - Calls `engine.ClaimGeneration(app, strat, proj.Id, nil)` and returns `claimID`.
    2. **`ExecuteClaimedUpdate(ctx, app, proj, claimID)`**:
       - Runs the existing await-brief → resolve context → 1-call anchored update → `CompleteClaimedSnapshot` → `createAttachedUpdateSession` flow against `claimID`.
       - On failure, records the human-readable error in the in-memory status map and calls `engine.ReleaseClaim`.
  - Keep synchronous `RunAnchoredUpdate` calling `Prepare` + `Execute` so existing sync callers/tests continue working unchanged.
  - Add `StartAnchoredUpdateAsync(app, runner, projectionID, discardExisting) (string, error)` that runs `PrepareAnchoredUpdate` synchronously, spawns `ExecuteClaimedUpdate` on `runner` (`context.Background()`), and returns `claimID` immediately.
- **`kalaidoscope/internal/handlers/projections.go` & `kalaidoscope/server/server.go`:**
  - Update `HandleGenerateCandidate(app, runner)` to check `req.Async`:
    - When `req.Async` is true → call `StartAnchoredUpdateAsync`, return `202 Accepted` (or `200 OK`) with `api.ProjectionSnapshotResponse{SnapshotID: claimID}`.
    - When `req.Async` is false → existing sync behavior (honoring `req.DiscardExisting` if set).
  - Add `GET /api/projections/{id}/candidates/{rid}/status` (`HandleGetCandidateStatus(app)`): returns `"generating"` if the claim row is still `generating`, `"ready"` if `pending_review`/`approved`, or `"error"` with the recorded error message if the claim failed/was released.

### 1.3 Unified Draft Discard (Handles Never-Saved Projections & Unbound Sessions) (Issue 5)
- **`kalaidoscope/internal/projections/update.go`:**
  - Update `DiscardCandidate(app, projectionID, candidateID)` (and add `DiscardDraftSession(app, projectionID)` for unbound sessions where no snapshot row exists yet) to return `DiscardResult { DeletedProjection bool; RevertedToProposed bool }`:
    - Inside one transaction:
      - Check whether the projection has **any `approved` snapshot**.
      - **Has approved snapshot(s):** mark the `pending_review` candidate(s) `discarded` (leaving the live approved snapshot untouched).
      - **Zero approved snapshots (never saved):**
        - If `proj.GetString("created_by_discover_run_id") != ""` → mark pending candidates `discarded`, delete open unbound refinements, and set `proj.status = "proposed"` (`RevertedToProposed: true`).
        - Otherwise (user-created, never saved) → hard-delete the `projection` record (cascading its abandoned draft snapshot and refinement conversation so it never clutters the list or "Recently deleted"; `DeletedProjection: true`).
- **`kalaidoscope/internal/handlers/projections.go` & `kalaidoscope/server/server.go`:**
  - Update `POST /api/projections/{id}/candidates/{rid}/discard` to return `{ snapshotId, deletedProjection?, revertedToProposed? }`.
  - Add `POST /api/projections/{id}/draft/discard` (`HandleDiscardProjectionDraft(app)`) for discarding an unbound draft session (before any snapshot row exists — used by `ProjectionDraftEditor` on resumed never-saved projections and `NewProjectionScreen`).

### 1.4 Go Tests
- Update `kalaidoscope/internal/handlers/projection_stage1_test.go` to cover:
  - Wholesale swap + chat explanation when `RunAnchoredUpdate` exceeds the full-rewrite threshold (no `data-full_rewrite_confirmation`).
  - Async Update (`async: true`, `discardExisting: true`), immediate claim return, background completion, and `GET .../candidates/{rid}/status` for ready and error states.
  - Discard on saved projection (keeps live snapshot), Discard on never-saved user projection (hard-deletes projection), Discard on Discover-originated never-saved projection (reverts to `proposed`), and `POST /api/projections/{id}/draft/discard` for unbound sessions.

---

## 2. TypeScript Client (`packages/lib/client/src/kalaidoscope/projections.ts`)

- Update `regenerateProjection(projectionId, opts?: { async?: boolean; discardExisting?: boolean })` to pass `async` and `discardExisting` in the request body.
- Add `getProjectionCandidateStatus(projectionId, snapshotId)` → `{ status: "generating" | "ready" | "error"; error?: string }`.
- Update `discardProjectionCandidate(projectionId, snapshotId)` return type to include `{ snapshotId: string; deletedProjection?: boolean; revertedToProposed?: boolean }`.
- Add `discardProjectionDraft(projectionId)` calling `POST /api/projections/{id}/draft/discard`.

---

## 3. React UI & Desktop Route Wiring

### 3.1 Projections List Row & Session-Driven "Draft in Progress" (Issues 1, 2, 3, 5)
- **`packages/react/features/src/projections/status.ts` & `status.test.ts`:**
  - Update `statusLabel("pending")` from `"review candidate"` → `"draft in progress"`.
  - Clarify `hasPending` parameter as `hasDraftInProgress` (true whenever a `pending_review` snapshot exists **or** an open unbound `projection_refinement` session exists).
- **`packages/react/features/src/projections/projections-screen.tsx`:**
  - Add a live subscription to unbound sessions (`useLiveCollection("projection_refinement", { filter: 'projection_snapshot_id = "" && projection_id.deleted_at = ""', fields: "id,projection_id" })`) so any projection whose session has begun immediately has `hasDraftInProgress = true` (Issue 2).
  - Wire direct **Update** action from the list:
    - Uses `regenerateProjection(id, { async: true, discardExisting })` → immediately calls `onStartUpdate(id, snapshotId)` (navigating straight into `/projections/:id/review/:snapshotId`, Issue 3).
    - If `hasDraftInProgress` is true on that row, opens a `ConfirmDialog` (*"Discard existing draft and start fresh?"*) before calling Update with `discardExisting: true` (Issue 5).
  - Replace `onReviewProjection` prop (previously for jumping to a specific candidate) with `onStartUpdate: (id: string, snapshotId: string) => void` (used only after launching a new Update from the list — no button to jump to an existing revision).
- **`packages/react/features/src/projections/components/projection-row.tsx`:**
  - **Name column:** Remove `{hasCandidate && <Pill>candidate</Pill>}`.
  - **"Last generated" (Status) column:**
    - Render `{generatedAt ? formatShortDateTime(generatedAt) : "not generated yet"}` (or `updating…` while `status.status === "generating"`).
    - When `hasDraftInProgress` → show plain-language `· draft in progress` inline (no `"candidate"` jargon, not a jump-to-revision link).
    - When `status.entropy > 0` → show `· {status.entropy} new since`.
    - For saved projections (when `generatedAt` exists and not currently generating), render the inline **Update / Refresh** icon button (`ArrowsClockwiseIcon`, `aria-label="Update projection"`, `title="Update projection"`) right beside the status text — visible/accessible even when `entropy === 0` (Issue 1).
  - **Right-hand column:** Remove the old `Review candidate` icon button completely; keep only `PinToggle`.

### 3.2 Immediate Navigation & Pulsating Skeleton on Update (Issue 3)
- **`packages/react/features/src/projections/hooks/use-projection-detail-actions.ts`:**
  - Update `handleRefresh(opts?: { discardExisting?: boolean })` to call `regenerateProjection(id, { async: true, discardExisting: opts?.discardExisting })` and immediately call `onReviewCandidate(id, outcome.id)` (returns in ~10ms).
- **`packages/react/features/src/projections/projection-review-screen.tsx` & `components/review-refine-column.tsx`:**
  - Detect when the target `snapshotId` is currently `status === "generating"` (or when `pending` hasn't arrived yet after initial mount):
    - **Left-hand canvas (`ReviewCanvasColumn`):** Render a **pulsating skeleton** (zero-radius `animate-pulse` blocks matching the canvas layout) with `PaneHeader` status pill `updating…`.
    - **Right-hand chat pane (`ReviewRefineColumn`):** Render a clean generating progress state (*"Reviewing sources and drafting updates…"*), disabling the composer until the draft lands.
    - **Header actions:** Keep `Save`, `Discard`, and triage buttons disabled cleanly while generating.
  - **Seamless transition:** Once PocketBase SSE updates the snapshot row to `status === "pending_review"` and the attached `projection_refinement` row lands, `useProjectionRefinement` loads the opening assistant message and the canvas switches automatically to the draft (inline diffs, wholesale swap, or unchanged draft).
  - **Failure handling:** If the `generating` row disappears without transitioning to `pending_review`, query `getProjectionCandidateStatus(id, snapshotId)`. On `"error"`, keep the user on the session screen showing the error message + **Retry update** (calls `regenerateProjection(id, { async: true })` and replaces route with the new `snapshotId`) + **Back to projection** buttons.

### 3.3 Freshness Card "Discard & Start Fresh" & Never-Saved Discard (Issue 5)
- **`packages/react/features/src/projections/components/projection-freshness-card.tsx` & `projection-side-rail.tsx` & `projection-detail-screen.tsx`:**
  - In `PendingCandidateCard`:
    - Keep primary **Resume draft** button.
    - Add secondary **Discard & start fresh** button right below it (`variant="outline"`), which opens a `ConfirmDialog` (*"Discard existing draft and start fresh?"*) → on confirm, calls `handleRefresh({ discardExisting: true })` (if stale / always starts a fresh Update, or `handleRevise` if preferred — defaulting to fresh Update when stale and fresh Revise when up-to-date, or let's make it crisp and predictable: *"Discard & update"* when new fragments/deps exist, *"Discard & start fresh"* calling Revise when nothing new arrived!).
  - In `ProjectionDetailScreen` when `resumed` renders `ProjectionDraftEditor` (unbound never-saved projection):
    - Wire `onCancel` to open a `ConfirmDialog` (*"Discard this unsaved projection?"*) → call `discardProjectionDraft(id)` → `onBackToList({ replace: true })` (instead of silently leaving a zombie projection).
- **`packages/react/features/src/projections/projection-review-screen.tsx` & `hooks/use-projection-review-actions.ts`:**
  - Add `onBackToList: (opts?: { replace?: boolean }) => void` prop to `ProjectionReviewScreenProps`.
  - When `!liveSnapshot` (never-saved projection):
    - Update Discard `ConfirmDialog` copy (*"Discard this unsaved projection?"* / *"This projection hasn't been saved yet. Discarding will remove it."*).
    - On discard response (`deletedProjection || revertedToProposed`), call `onBackToList({ replace: true })` instead of `onBackToDetail(id)`.
- **`apps/desktop/src/features/projections/pages/ProjectionReview.tsx` & `ProjectionReview.transitions.ts` & `Projections.tsx`:**
  - Add `backToList: { to: "projections", ... }` to `ProjectionReview.transitions.ts` and wire `onBackToList` in `ProjectionReview.tsx`.
  - Update `Projections.tsx` to pass `onStartUpdate` (using the existing `reviewProjection` transition) to `ProjectionsScreen`.

---

## 4. Verification

```bash
./kalaido.sh check:go && ./kalaido.sh test:go
./kalaido.sh test:ts
./kalaido.sh doctor:react . --no-cache --verbose --yes
./kalaido-mac.sh check:ts
```

And hands-on sanity checks:
- [ ] Start a brand-new projection, send 1 message before any draft exists, navigate back to list → shows `draft in progress` (no `candidate` pill, no far-right icon).
- [ ] Click it → opens draft → click **Discard** → confirm → projection disappears cleanly (not in list, not in Recently deleted).
- [ ] On a saved projection in the list → click the inline **Update** icon next to `Last generated` (both with `> 0` and `0` new fragments) → immediately navigates into session screen with pulsating skeleton → transitions cleanly to diffs or wholesale swap (with chat note, zero full-draft confirmation dialog).
- [ ] On a saved projection with an open draft → visit detail screen → click **Discard & start fresh** on the freshness card (and test list-row Update on a row with an open draft) → confirm → discards old draft and opens fresh session immediately.
