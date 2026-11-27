# Stage 2 (Reflections) — Issues Fix Plan

> **Source issues:** [stage-2-issues.md](./stage-2-issues.md) (Issues 1–3)
> **Scope:** Reflections only (Go backend + TS client + shared chat transcript cleanup + React features + Desktop route wiring). Zero `canonical.go` migrations; Projections untouched.

---

## Summary of Fixes by Issue

| Issue | Core Change |
|---|---|
| **1 — No `WindowDivider` in Reflection Chat** | Remove `WindowDivider` rendering from `ChatMessages`. Stop routing preview window switches through the chat transcript (`applyTimeWindow`); use dedicated stateless preview endpoints instead so the lens chat stays strictly period-agnostic. |
| **2 — 2-Tab Staged Tuning Workspace + Manual Preview + "Update"** | Replace the 3-column auto-saving screen with a **2-tab (`Lens` \| `Schedule & Sources`)** left workspace beside one persistent **Preview** pane. Stage Schedule, Sources, and Standing Lens locally until atomic **Save** (delete `usePersistSchedule` auto-save). Show immediate sample window dates + matching fragment count via a non-LLM preview-windows endpoint and trigger LLM preview generation on an explicit **Preview** click (while `set_lens` in chat still previews immediately). Rename established-reflection **"Refine"** button to **"Update"**. |
| **3 — Resumable Never-Saved Draft & Clean Discard** | Detect never-saved reflections (`!current_lens_id`) as `draft in progress` in the Reflections list & panel, offering **Resume draft** + **Discard**. Resume the existing `reflection_refinement` session when re-opening a never-saved reflection (while established reflections start a fresh session on **Update**). Add `POST /api/reflections/{id}/draft/discard` to hard-delete unsaved user reflections or revert Discover proposals to `proposed`. |

---

## 1. Go Backend (`kalaidoscope/`)

### 1.1 Stateless Staged Preview Endpoints (Issues 1 & 2)
- **`kalaidoscope/internal/api/reflections.go`:**
  - Add `PreviewReflectionWindowsRequest { WindowSpec api.WindowSpec; ContextSpec api.ContextSpec }` and `PreviewReflectionWindowsResponse { Windows []PreviewWindowInfo; DefaultWindowID string }` where `PreviewWindowInfo` includes `{ id, start, end, key, fragmentCount }`.
  - Add `PreviewReflectionRequest { LensPrompt string; ContextSpec api.ContextSpec; Window api.Window; GenerateWithModel string }` and `PreviewReflectionResponse { Output string; Empty bool; FragmentCount int }`.
- **`kalaidoscope/internal/reflections/preview.go` (new):**
  - `PreviewWindows(ctx, app, reflectionID, spec, ctxSpec, now)`:
    - Validates `spec` (`period` required; `endTime` validated if set).
    - Enumerates candidate windows with `GridWindows` (using `effectiveFrom = startTime` when `startTime < now`, else `now`, capped at `min(now, endTime)`). If the grid is empty (first grid point hasn't passed yet), includes the trailing "as of now" window.
    - Strips any upstream projection/reflection IDs from `ctxSpec` (reflections are fragments/colours only) and computes `fragmentCount` per window (for the newest e.g. 24 windows shown in the picker, or all grid windows up to a reasonable cap) via `llmcontext.ResolveSpecToIDs` — fast DB queries, **zero LLM calls**.
  - `RunStagedPreview(ctx, app, reflectionID, req)`:
    - Resolves fragments inside `req.Window` for `req.ContextSpec` (fragments/colours only).
    - If `len(pinned.FragmentIDs) == 0`: skips the LLM call and returns `{ Output: "No fragments in this window.", Empty: true, FragmentCount: 0 }`.
    - Otherwise resolves `RoleSnapshot` (using `req.GenerateWithModel` or parent reflection's `generate_with_model` if `reflectionID` is given), hydrates fragments, runs standalone `ApplyPrompt(req.LensPrompt, sources, start, end)` with **zero chat history**, and returns `{ Output, Empty: false, FragmentCount }`.
- **`kalaidoscope/internal/handlers/reflections.go` & `kalaidoscope/server/server.go`:**
  - Register `POST /api/reflections/preview-windows` (`HandlePreviewReflectionWindows(app)`).
  - Register `POST /api/reflections/preview` (`HandlePreviewReflection(app)`) — optional `reflectionId` in body for model-override lookup; works cleanly for both staged new reflections and established reflections without mutating the live record or polluting chat history.

### 1.2 Period-Agnostic Lens Chat & Atomic Staged Save (Issues 1 & 2)
- **`kalaidoscope/internal/api/chat.go` & `kalaidoscope/internal/refinement/reflection_chat.go`:**
  - Allow optional `Window *api.Window` and `LatestPreview string` (and optional `LensPrompt string` / `ContextSpec *api.ContextSpec`) on `RefinementChatRequest` so the reflection chat knows which sample window & preview the user is currently looking at **without** persisting `window` system messages into the chat transcript.
  - When `set_lens` is called in `StreamReflectionTurn`, run the isolated preview against that active sample window (falling back to transcript/default window for backwards compatibility) and stream `tool-apply_result` as today.
  - Keep `StreamReflectionTurn` free of any `WindowDivider`-producing re-apply turns for UI window switches (the UI calls `POST /api/reflections/preview` directly on manual **Preview** click).
- **`kalaidoscope/internal/handlers/refinements.go` & `kalaidoscope/internal/refinement/session.go` & `kalaidoscope/internal/reflections/reflections.go`:**
  - Extend `POST /api/reflections/{id}/refinements/{rid}/commit` (and add `POST /api/reflections/{id}/save` for when the user only edited Schedule, Sources, or direct Lens text without starting/sending a chat turn!) to accept optional staged overrides `{ windowSpec?, contextSpec?, lensPrompt?, name? }`:
    - In **one transaction**:
      1. If `windowSpec` is provided and differs from the governing version: validate and append a new `window_spec_versions` entry (for never-saved reflections where v1 is being finalized before first Save, replace v1 cleanly so `startTime` changes during setup take effect cleanly).
      2. If `contextSpec` is provided (else transcript's latest): strip upstream projection/reflection IDs and update `reflection.current_context_spec`.
      3. Resolve final `lensPrompt` (staged `lensPrompt` override if non-empty, else transcript's latest `set_lens`/`data-lens`, else existing `current_lens_id` prompt). Require a non-empty prompt; if it differs from the current lens (or no lens exists yet), append a new `lens` row (`parent_lens_id = current_lens_id`, `created_from_reflection_refinement_id = rid` if present) and update `reflection.current_lens_id`.
      4. Set `reflection.status = active` (and update `name` if provided).
    - After the transaction commits, kick `reflections.RunPendingWindows(deps.Runner, app, id)` so newly due pending windows start generating immediately.

### 1.3 Clean Draft Discard for Never-Saved Reflections (Issue 3)
- **`kalaidoscope/internal/reflections/reflections.go`:**
  - Add `DiscardDraft(app core.App, reflectionID string) (DiscardResult, error)` mirroring `projections.DiscardDraftSession`:
    - Loads live reflection.
    - If `current_lens_id != ""` (already established): returns an error/no-op (established reflections are never deleted by discarding a tuning session).
    - If `current_lens_id == ""` (never saved):
      - If `created_by_discover_run_id != ""` → delete open `reflection_refinement` rows and set `status = "proposed"` (`RevertedToProposed: true`).
      - Otherwise (user-created, never saved) → **hard-delete** the `reflection` record (cascading `reflection_refinement` and its `chat_message` rows so no broken lensless reflection remains in the list or Recently Deleted; `DeletedReflection: true`).
- **`kalaidoscope/internal/handlers/reflections.go` & `kalaidoscope/server/server.go`:**
  - Register `POST /api/reflections/{id}/draft/discard` (`HandleDiscardReflectionDraft(app)`), returning `{ id, deletedReflection?, revertedToProposed? }`.

### 1.4 Go Tests
- Extend `kalaidoscope/internal/handlers/reflection_stage2_test.go` to cover:
  - `POST /api/reflections/preview-windows` (cadence switch weekly → monthly, bounded `endTime`, fragment counts).
  - `POST /api/reflections/preview` (isolated LLM preview, 0-fragment short-circuit with 0 LLM calls, no mutation of live reflection).
  - Atomic Save (`POST /api/reflections/{id}/save` and commit with staged `{ windowSpec, contextSpec, lensPrompt }`): changing schedule + lens together atomically, saving schedule-only or direct-lens-only without a chat turn, and confirming Cancel leaves live reflection untouched.
  - `POST /api/reflections/{id}/draft/discard`: hard-deletes never-saved user reflection, reverts Discover-originated never-saved reflection to `proposed`, refuses/no-ops on established reflection with a saved lens.

---

## 2. TypeScript Client & Shared Components

- **`packages/lib/client/src/kalaidoscope/reflections.ts`:**
  - Add `previewReflectionWindows(windowSpec, contextSpec, reflectionId?)` → `{ windows, defaultWindowId }`.
  - Add `previewReflection({ reflectionId?, lensPrompt, contextSpec, window })` → `{ output, empty, fragmentCount }`.
  - Add `saveReflectionTuning(id, { refinementId?, windowSpec?, contextSpec?, lensPrompt?, name? })` (calls commit when `refinementId` exists, or `POST /api/reflections/{id}/save` when no chat session was opened).
  - Add `discardReflectionDraft(id)` calling `POST /api/reflections/{id}/draft/discard`.
- **`packages/react/components/src/chat-messages.tsx`:**
  - Remove `WindowDivider` component and its rendering call in `ChatMessages` (Issue 1 — preview period never appears as a chat divider).
- **`packages/react/hooks/src/use-kalaido-chat.ts` & `use-refine-session.ts`:**
  - Allow passing optional `activeWindow` / `latestPreview` on reflection chat sends without appending a `window` system message to the chat transcript.

---

## 3. React Features & Desktop Route Wiring (`packages/react/features/src/reflections/`)

### 3.1 2-Tab Staged Tuning Workspace + Persistent Preview Pane (Issues 1 & 2)
- **Delete auto-save hook:** Remove `usePersistSchedule` usage from `ReflectionRefineScreen` (delete `hooks/use-persist-schedule.ts` if unused).
- **`packages/react/features/src/reflections/refine-state.ts` & `reflection-refine-screen.tsx`:**
  - Track staged state cleanly in one place:
    - `activeTab: "lens" | "schedule"` (default `"lens"`).
    - Staged `cadence`, `fromDate`, `endDate`, `paused`, `context`, `lensPrompt` (seeded from existing reflection's saved schedule/context/lens — or resumed draft — and updated whenever direct lens editor changes OR AI `set_lens` lands).
    - Staged preview tracking: `previewOutput`, `previewStale` (true whenever staged `(lensPrompt, contextSpec, selectedWindow)` differs from the inputs that produced `previewOutput`), `previewLoading`, plus `previewWindows` fetched via `previewReflectionWindows(stagedWindowSpec, stagedContextSpec)` whenever schedule/sources change!
  - **2-column layout (replacing the cramped 3-column layout):**
    - **Left column (2 tabs):**
      - Clean tab bar: **`Lens`** | **`Schedule & Sources`** (with subtle indicator if either tab has unsaved staged changes).
      - **`Lens` tab:**
        - Collapsible or toggleable **Standing lens** text box (view/edit staged `lensPrompt` directly without mutating the live reflection; editing marks `previewStale = true`).
        - **Lens Chat** (`RefineChatPanel` without `WindowDivider`; AI `set_lens` updates staged `lensPrompt` + updates `previewOutput` and clears `previewStale`; AI `update_context` confirm updates staged `context`).
      - **`Schedule & Sources` tab:**
        - `RefineConfigPanel` (cadence, start date — editable while never-saved; fixed with Backfill note on established reflections — optional end date, pause toggle, `SchedulePill`).
        - `ContextBar` for picking fragments & colours (updates staged `context`, immediately refreshing `previewWindows` fragment counts).
    - **Right column (Persistent `LivePreviewPane`):**
      - Always visible beside both tabs.
      - Header shows:
        - **Sample window selector** populated from staged `previewWindows`, displaying date range + fragment count (e.g. `Oct 1 – Oct 31 · 47 fragments`).
        - **Manual `Preview` button** (enabled whenever `lensPrompt.trim()` is non-empty and not loading; visually emphasized when `previewStale` is true). Clicking **Preview** calls `previewReflection(...)` and updates `previewOutput` without touching chat history.
      - Body shows:
        - Fragment count + date range subheader.
        - Subtle *"Settings changed — click Preview to update"* banner when `previewStale` is true and an older preview is shown.
        - Rendered markdown preview (or clean empty-window state when `fragmentCount === 0` / empty output).
  - **Header actions:**
    - **Save** (enabled whenever staged `lensPrompt` is non-empty and not busy): calls `saveReflectionTuning` atomically → navigates to reflection series view.
    - **Discard** (for brand-new or never-saved reflections: opens `ConfirmDialog` → `discardReflectionDraft` → navigates to `/reflections`) OR **Cancel** (for established reflections: navigates straight back to `/reflections/:id` with zero server mutations).

### 3.2 Resumable Never-Saved Drafts & "Update" Button Naming (Issues 2 & 3)
- **`packages/react/features/src/reflections/hooks/use-resume-reflection-refinement.ts` (new):**
  - Mirror `projections/hooks/use-resume-refinement.ts` for `reflection_refinement`: loads the latest `reflection_refinement` row + its normalized `chat_message` history for a never-saved reflection (`!existing.current_lens_id`) and returns `{ seed, messages, context, latestLens, ready }`.
- **`packages/react/features/src/reflections/reflection-refine-screen.tsx`:**
  - When opened with an `id` where `!existing.current_lens_id` (resuming a never-saved reflection): pass `resumed: seed` into `useRefineSession` (restoring the existing chat, staged lens, context, and schedule!) instead of calling `session.start(...)` to create a fresh session.
  - When opened with an `id` where `Boolean(existing.current_lens_id)` (established reflection opened via **Update**): start a fresh tuning session seeded from the reflection's saved lens, schedule, and sources.
- **`packages/react/features/src/reflections/reflections-screen.tsx` & `components/reflection-series-panel.tsx`:**
  - In `ReflectionsScreen` sidebar: when `!r.current_lens_id`, show `draft in progress` in the row subtitle (e.g. `Weekly · draft in progress`).
  - In `ReflectionSeriesPanel`:
    - When the selected reflection has `!reflection.current_lens_id` (never saved): render a dedicated **Draft in progress** panel with primary **Resume draft** button (navigates to `/reflections/:id/refine`) and secondary **Discard draft** button (with `ConfirmDialog` → `discardReflectionDraft` → clears selection / navigates to `/reflections`).
    - When the selected reflection IS established (`Boolean(reflection.current_lens_id)`): rename the **"Refine"** button in `ReflectionHeader` actions to **"Update"**.
- **`apps/desktop/src/features/reflections/pages/ReflectionRefine.tsx` & `Reflections.tsx`:**
  - Ensure `onDiscardSuccess` (or `onCancel(undefined)`) navigates cleanly back to `/reflections` (without a deleted `id` param).

---

## 4. Verification

```bash
./kalaido.sh check:go && ./kalaido.sh test:go
./kalaido.sh test:ts
./kalaido.sh doctor:react . --no-cache --verbose --yes
./kalaido-mac.sh check:ts
```

And hands-on sanity checks:
- [ ] Create a new reflection, send 1 message, leave before clicking Save → sidebar shows `draft in progress`, panel offers **Resume draft** + **Discard** → Resume restores your exact conversation → Discard removes the unsaved reflection completely.
- [ ] Open an established reflection → button says **Update** → opens the 2-tab (`Lens` | `Schedule & Sources`) workspace beside one persistent Preview pane.
- [ ] Switch to **Schedule & Sources**, change Weekly → Monthly → live reflection is NOT mutated; Preview header immediately shows the monthly sample window + fragment count and offers a **Preview** click → click **Preview** → see monthly output with zero `WindowDivider` rows in the Lens chat → switch to **Lens** tab and tighten the lens → click **Cancel** and verify the live reflection is untouched, or click **Save** and verify schedule, sources, and lens all save together.
