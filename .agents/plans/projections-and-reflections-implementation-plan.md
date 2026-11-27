# Projections & Reflections — Implementation Plan

> **Spec:** [projections-and-reflections-prs.md](./projections-and-reflections-prs.md)
> **Strategy:** Vertical, playable slices first — get a real, usable version into hands quickly to validate the product mechanics on live workspace data, then refine, decouple, and clean up once the behavior feels right.
> **Schema guardrail (Stages 1 & 2):** Zero `kalaidoscope/schema/canonical.go` migrations until Stage 3 (post-validation).
> **Audit docs guardrail:** Per `kalaidoscope/AGENTS.md`, never hand-edit prose in `kalaidoscope/docs/*.md`; only prepend the `> **STALE**` marker where missing during Stages 1–2, and regenerate in Stage 3.

---

## Stage 1 — Playable Projections (Vertical Slice: Go + Client + UI)

**Goal:** Deliver the complete end-to-end Projection loop so you can test the core thesis on real notes:
*Create → canvas-aware direct editing (`write_draft`, `propose_edit`, anchored `update_draft`) → block `Edit` & `Refine` → picker changes notify AI → `Save` (instant + async living brief distillation) → `Update` when new fragments arrive (1-call anchored update, always opening a session) → `Revise` when up to date → inspect/edit the saved brief.*

### 1.1 Go Backend (`kalaidoscope/`)

1. **Direct Lens Read / Edit Endpoints**
   - `kalaidoscope/server/server.go`, `kalaidoscope/internal/handlers/projections.go`, `kalaidoscope/internal/engine/lens.go`:
     - Add `GET /api/projections/{id}/lens` → returns `{ lensId, prompt, updating }` (reads `current_lens_id` → `lens.prompt`; `updating` reflects whether an async Save-time distillation is currently running for this projection).
     - Add `PUT /api/projections/{id}/lens` accepting `{ prompt }` → appends a new `lens` row (`parent_lens_id = current_lens_id`), updates `projection.current_lens_id`, returns `{ lensId, prompt }`.

2. **Canvas-Aware Projection Chat (`internal/refinement/` + `internal/prompts/`)**
   - Keep Reflection chat untouched in Stage 1 by branching projection turns into a dedicated projection chat path (e.g. `internal/refinement/projection_chat.go` + `projection_tools.go`, routed from `HandleProjectionRefinementChat`), avoiding risky refactors of shared code while prototyping.
   - **System prompt & live draft injection (`internal/prompts/`):**
     - Goal-directed synthesis system prompt guiding the user toward converging on and saving the artifact.
     - Inject the **current live draft** (`output_draft` of the bound `pending_review` candidate, if any) freshly in the turn's system/context block (never piling up stale draft copies across history) so every manual edit and accepted/rejected hunk is automatically visible.
     - Inject the projection's standing editorial brief (`current_lens_id` → `lens.prompt`, if any) as read-only background direction.
   - **Projection tool set:**
     - `write_draft { content }` — writes the initial draft (creating/binding the `pending_review` candidate if unbound, with `output_draft = content`, `edits = []`) OR executes a full-body replacement after user confirmation.
     - `propose_edit { target, replacement }` — reuses existing `projections.ProposeRefineEdit` / `ReviseProposalEdit` to place an inline accept/reject hunk (`<<<edit:id>>>`) on the bound candidate (used for block-level **Refine** and localized chat edits).
     - `update_draft { instructions }` — runs a single anchored LLM call given `(current draft + standing brief + resolved sources [marking newly added items] + instructions)` instructed to preserve untouched blocks verbatim:
       - Runs `engine.DiffAndMarkBlocks(baseline, updated, regeneration)`.
       - **Full-body threshold check:** if changed lines/blocks exceed threshold (initial heuristic: > 60% of blocks changed), hold the candidate body and emit a `data-full_rewrite_confirmation` part asking the user to confirm replacing the whole body (confirm leg applies `write_draft`; cancel leg keeps current draft).
       - Otherwise, updates `output_draft` and `edits` with the inline diff hunks (preserving any still-verbatim approved edits as today).
     - `request_full_rewrite { reason }` — emits the same `data-full_rewrite_confirmation` gate before full replacement.
     - `update_context { ... }` — keep existing confirmation proposal (`data-context_confirmation` → user confirms → picker + session context update).
     - `suggest_name { name }` — keep for unnamed projections.
   - **Mid-session picker change notification:**
     - When the client sends a new `context_spec` system message with no user text (because the user edited the context picker), resolve the new `pinned_ids` delta and run a short conversational assistant turn acknowledging what changed and asking whether to update the draft now (instead of staying silent).
   - **No mid-session lens compilation:** Projection turns do not call `CompileLens`, do not run `LensCountPin`, and do not create preview `lens` rows.

3. **1-Call Anchored Cross-Session Update & Revise Session Start**
   - `kalaidoscope/internal/handlers/projections.go` & `kalaidoscope/internal/projections/`:
     - **Update (`POST /api/projections/{id}/candidates`):**
       - Remove `candidate_engaged` / `discardEngaged` `409` gate and remove `foldIn` / `WithSettleUnchanged` / `settleApprovedInPlace` calls on this path.
       - Run **1 anchored update call** given `(previous approved snapshot + standing brief + resolved current context [clearly tagging newly arrived fragments and updated upstream snapshots])`, returning either an updated document + brief change summary OR an explicit `NO_CHANGES` + brief explanation.
       - Always create a `pending_review` candidate and an attached `projection_refinement` session with an opening assistant message:
         - If changes exist → `DiffAndMarkBlocks(previousOutput, updatedOutput)` (or full-body confirmation if above threshold) + assistant summary of what changed.
         - If no changes needed → `output_draft = previousOutput`, `edits = []`, + assistant explanation of why the new sources didn't warrant changes.
       - Return `{ snapshotId, refinementId }` (backwards-compatible with `{ snapshotId }`).
     - **Revise (up-to-date projection):**
       - Add `POST /api/projections/{id}/sessions/revise` (or allow opening a revision draft via existing candidate/refinement creation): creates a `pending_review` draft seeded from the current approved snapshot (`output_draft = approved.output`, `edits = []`, `context_spec = current_context_spec`, `resolved_context = approved.resolved_context`) and opens a fresh bound `projection_refinement` session — returning `{ snapshotId, refinementId }`.
     - **Discard draft:**
       - Add `POST /api/projections/{id}/candidates/{rid}/discard` (marks the `pending_review` candidate `discarded`, closing the session cleanly while leaving the previous approved snapshot untouched).

4. **Bulk Edit Triage (Accept All / Reject All)**
   - `kalaidoscope/internal/projections/edit.go` & `kalaidoscope/internal/handlers/projections.go`:
     - Add `POST /api/projections/{id}/candidates/{rid}/edits/resolve-all` accepting `{ status: "approved" | "rejected" }` — resolves every `proposed` edit on the candidate in one transaction and recomputes undoability.
   - Keep `POST /api/projections/{id}/candidates/{rid}/edit` (hand-edits + `KALAIDO_HAND_EDIT_CREATE_FRAGMENT` as-is).

5. **Save + Async Living Editorial Brief Distillation**
   - `kalaidoscope/internal/handlers/projections.go`, `kalaidoscope/internal/refinement/session.go`, `kalaidoscope/internal/projections/brief.go` (new):
     - Unify **Save** (whether called via `approve` or `commit`):
       - Validate zero unresolved `<<<edit:>>>` markers in `output_draft`.
       - In one transaction: promote `pending_review` → `approved` (`output = trimmed output_draft`, next `approval_sequence_number`, `approved_at = now`), update `projection.current_context_spec` to the draft/session's final context spec, set `projection.status = active`, discard any other pending rows.
       - Return `200 { snapshotId }` immediately.
     - **Async distillation job (`deps.Runner.Go(...)`):**
       - Track in-flight distillation per `projectionId` (small in-memory map / sync cond so `GET .../lens`, Update, and Fork can inspect or await it).
       - Run one LLM call (`RoleRefinement`, respecting `generate_with_model`) to compile/update the clean, data-agnostic **living editorial brief** from `(previous lens prompt + final saved snapshot + session transcript + manual/accepted edits)`.
       - Persist new `lens` row (`parent_lens_id = previousLensID`, `created_from_projection_refinement_id = refinementId`) and update `projection.current_lens_id` **only if** `projection.current_lens_id == previousLensID` (optimistic guard so a concurrent manual edit via `PUT .../lens` is never clobbered).
       - Note: `GenerateSnapshot` / Update / Fork can work even if `current_lens_id` is empty (first brief still distilling or failed) — never block with `ErrLensNotReady` on projections when a saved snapshot exists!

6. **Freshness Evaluator Adjustment (`kalaidoscope/internal/reconcile/evaluator.go`)**
   - Keep passive freshness on the saved approved snapshot (`newFragmentIds`, 1-hop `staleDependencies`).
   - Stop flagging `candidate.outdated` as a blocking condition (keep optional lightweight `candidate.newFragmentIds` if useful for a subtle non-blocking banner).

### 1.2 TypeScript Client & Shared Hooks (`packages/lib/client/`, `packages/react/hooks/`)

- `packages/lib/client/src/kalaidoscope/projections.ts`:
  - Add `getProjectionLens(id)`, `updateProjectionLens(id, prompt)`, `startProjectionRevise(id)`, `discardProjectionCandidate(id, snapshotId)`, `resolveAllProjectionEdits(id, snapshotId, status)`.
  - Update `regenerateProjection` (Update) to drop `foldIn` / `discardEngaged` options.
- `packages/react/hooks/src/use-refine-session.ts` (or a light projection-specific wrapper while keeping reflections working):
  - Handle new SSE parts (`data-full_rewrite_confirmation` + confirm/cancel sends, `write_draft` live draft updates).
  - Remove `hasDraftedLens` gate on Save for projections (Save is enabled whenever a non-empty draft exists with zero unresolved diff hunks).
  - When context picker changes mid-session, immediately trigger the context-changed notification turn so the AI responds.

### 1.3 React UI (`packages/react/features/src/projections/`)

- **`projection-detail-screen.tsx` & `projection-side-rail.tsx` / `projection-freshness-card.tsx`:**
  - Show **Update** when new fragments or updated upstream snapshots are available (calls Update → navigates straight into the unified session).
  - Show **Edit / Revise** when up to date (calls `startProjectionRevise` → navigates into the same unified session).
  - Add a subtle secondary button/link (**View brief**) opening a lightweight drawer/modal to view and edit the living editorial brief (`GET/PUT .../lens`), showing *"Updating brief…"* if async distillation is in flight.
- **`projection-review-screen.tsx` & `projection-draft-editor.tsx`:**
  - Unify creation, update, and revision into the same interactive canvas + chat experience.
  - **Remove the blocking `view.gateOpen` freeze banner/lock** (replace with an optional subtle non-blocking notice if new fragments arrive mid-session).
  - Add **Accept all** and **Reject all** buttons in the header/triage bar whenever `proposedEditsCount > 0`.
  - Add **Discard** button (with confirmation) to close an unwanted draft session cleanly.
  - Render the **Full-body replacement confirmation** card in chat when triggered by a large rewrite.
  - Ensure AI `update_context` confirmation updates the visible `ContextBar` picker immediately on Confirm, and human edits to `ContextBar` notify the AI immediately.
  - Keep existing block-level `Edit` modal and `Refine` targeting flow working seamlessly on the canvas.

### 1.4 Stage 1 Validation Checklist (What to Try Hands-On)

- [ ] **Create from scratch:** Describe a projection → AI writes clean first draft → use block `Edit`, block `Refine`, and chat tweaks → Save feels instant → open **View brief** drawer and check the distilled editorial brief.
- [ ] **Explore & Fork:** Graduate an Explore chat into a projection; fork an existing projection onto a different colour.
- [ ] **Mid-session context change:** Add/remove a fragment or colour in the picker → AI acknowledges immediately and asks whether to update → confirm an AI `update_context` suggestion and verify the picker updates.
- [ ] **Broad rewrite threshold:** Ask for a small tweak (inline diffs) vs. a total rewrite (confirmation card before full-body replacement).
- [ ] **Cross-session Update:** Ingest/add new fragments matching the spec → click **Update** → verify diffs are clean, untouched wording survives, and zero-change updates open with an explanation.
- [ ] **Revise when up to date:** Click **Revise**, tweak text/context, Save or Discard.
- [ ] **Resume draft:** Navigate away mid-session and return → draft and chat resume cleanly; after Save/Discard, next Update starts a fresh session.

### 1.5 Explicitly Deferred Out of Stage 1
- Touching Reflections (Stage 2).
- Deleting dead legacy Go/TS code that isn't in the way (Stage 3).
- Splitting `internal/engine` packages cleanly (Stage 3).
- `canonical.go` schema changes (Stage 3).

---

## Stage 2 — Playable Reflections (Vertical Slice: Go + Client + UI)

**Goal:** Deliver the complete end-to-end Reflection loop so you can validate the dual model (*chat refines standing lens → strictly isolated sample-window preview → read-only preview fed back to chat → auto-approved windowed snapshots → hardcoded empty windows → direct per-window text editing*).

### 2.1 Go Backend (`kalaidoscope/`)

1. **Direct Lens Read / Edit Endpoints**
   - `kalaidoscope/server/server.go`, `kalaidoscope/internal/handlers/reflections.go`:
     - Add `GET /api/reflections/{id}/lens` → returns `{ lensId, prompt }`.
     - Add `PUT /api/reflections/{id}/lens` accepting `{ prompt }` → appends a new `lens` row (`parent_lens_id = current_lens_id`), updates `reflection.current_lens_id`, returns `{ lensId, prompt }`.

2. **1-Step Standing Lens Authoring + Preview-Aware Chat (`internal/refinement/` + `internal/prompts/`)**
   - Branch reflection turns into a clean reflection-specific path (e.g. `internal/refinement/reflection_chat.go`):
     - **Tools:** `set_lens { prompt }`, `update_context { ... }` (fragments/colours only), `suggest_name { name }` (when unnamed). Drop `refine_candidate`, `regenerate_from_lens`, `CompileLens`, and `LensCountPin` from reflection turns.
     - **Isolated sample-window preview:** When `set_lens` is called (or on window switch re-apply), run `ApplyPrompt(prompt, sampleWindowFragments, start, end)` with **zero chat history** (or return the hardcoded empty-window text if 0 fragments match that window).
     - **Read-only latest preview visibility:** When hydrating reflection chat history for Turn N+1, inject the **single latest preview output** (and its window bounds) as a read-only system/context block, with prompt instructions stating the assistant cannot edit preview text directly and can only change output by calling `set_lens`.
     - **Commit (`POST /api/reflections/{id}/refinements/{rid}/commit`):** Read latest lens from `set_lens` (or `data-lens` fallback), create `lens` row, update `current_lens_id` + `current_context_spec` + `status = active`, and trigger `RunPendingWindows` as today.

3. **Windowed-Always, Bounded (`endTime`), & Paused Schedules (`internal/reflections/`)**
   - `kalaidoscope/internal/api/context.go`: add `Paused bool` (`json:"paused,omitempty"`) to `WindowSpec` (already has `EndTime string`).
   - `kalaidoscope/internal/reflections/windowspec.go`:
     - Require a valid positive `period` on create/update (drop unscheduled/windowless reflections).
     - Validate `endTime` if non-empty (RFC3339, must be after `startTime` if both set).
   - `kalaidoscope/internal/reflections/windows.go`:
     - In `GridWindows`: cap enumeration at `min(now, endTime)` when `endTime` is set (supports purely historical/bounded archival reflections).
     - In `PendingWindows` / `GeneratePendingWindows` / `POST /api/reflections/generate-pending`: skip generating new forward grid windows when the governing `WindowSpec.Paused` is true (manual regeneration and explicit backfill still work).

4. **Hardcoded Empty Windows & Auto-Approved Generation (`internal/reflections/` + `internal/engine/`)**
   - Before calling the LLM for a reflection window: resolve fragments in `[window_start, window_end)`.
     - If **0 fragments** match: skip the LLM call and persist an `approved` `reflection_snapshot` with hardcoded output (`"No fragments in this window."`), `lens_id = current_lens_id`, `resolved_context = empty`, `generated_by_model = "empty"`, `approval_sequence_number = max + 1`.
   - In `PendingWindows` & `reconcile/evaluator.go`:
     - If a window's latest approved snapshot has `generated_by_model == "empty"` **and** matching fragments now exist in that window, include that window in `pendingWindows` so scheduled cron (or manual generation) automatically upgrades it with a real LLM-generated snapshot.
     - Non-empty windows with backdated fragments continue to be flagged as `staleWindows` only (never silently overwritten by cron).
   - Drop `preview: true` / `pending_review` and `minimizeAgainstPrevious` for reflection generation (always `generating` → `approved` direct `ApplyPrompt`).

5. **Direct Per-Window Snapshot Text Editing**
   - `kalaidoscope/server/server.go`, `kalaidoscope/internal/handlers/reflections.go`, `kalaidoscope/internal/reflections/`:
     - Add `POST /api/reflections/{id}/windows/{windowId}/edit` accepting `{ output }`:
       - Loads live reflection and latest `approved` snapshot for that window.
       - Appends a new `approved` `reflection_snapshot` row for `(window_start, window_end)` with `approval_sequence_number = max + 1`, `output = trimmed output`, `lens_id` / `context_spec` / `resolved_context` copied from the prior approved snapshot (so editing doesn't falsely flag `lensOutdated` or `stale`), and `generated_by_model = "manual"`.
       - Returns `200 { snapshotId }`.
   - Ensure `reconcile/evaluator.go` and `GET /api/reflections/{id}/windows` treat `generated_by_model` sentinels (`"empty"`, `"manual"`) cleanly (never flagging model mismatch or displaying `"manual"`/`"empty"` as an LLM model ID).

### 2.2 TypeScript Client (`packages/lib/client/src/kalaidoscope/reflections.ts`)

- Add `getReflectionLens(id)`, `updateReflectionLens(id, prompt)`, `editReflectionWindowSnapshot(id, windowId, output)`.
- Update `WindowSpec` type helpers to include optional `endTime` and `paused`.

### 2.3 React UI (`packages/react/features/src/reflections/`)

- **`reflection-refine-screen.tsx` & `refine-config-panel.tsx`:**
  - Support direct viewing & editing of the standing lens text (e.g. a toggle/panel beside or above the chat so users can edit the prompt directly and preview/save without needing a chat turn).
  - Add optional **End date** (for bounded historical reflections) and **Pause schedule** controls in `schedule-controls.tsx`.
  - Keep sample-window switching and live isolated preview (showing the empty-window state cleanly when a sample window has 0 fragments).
- **`reflection-series-panel.tsx` & `reflections-screen.tsx`:**
  - Add a straightforward **Edit** button on any generated window snapshot opening a plain markdown/text editor → saves via `editReflectionWindowSnapshot` (appending a new revision).
  - Add a minimal revision switcher/indicator when a window has > 1 approved revision so you can verify non-destructive per-window history.
  - Display hardcoded empty windows cleanly (distinguished visually from LLM-generated ones) and show *"Older lens"* / *"New fragments"* badges with single-window and bulk regenerate actions.

### 2.4 Stage 2 Validation Checklist (What to Try Hands-On)

- [ ] **Author via chat:** Create a reflection → AI writes standing lens via 1-step `set_lens` → preview streams strictly from lens → give critique (*"too long"*, *"focus more on blockers"*) and verify the AI sees the preview and tightens the lens accurately.
- [ ] **Switch sample windows & direct lens edit:** Test the lens across multiple windows; edit the lens text directly without chatting and verify `lensOutdated` flags older windows without overwriting them.
- [ ] **Bounded historical & paused schedules:** Create a historical archive reflection with a `startTime` and `endTime` → verify windows generate immediately on Save and stop at `endTime`; toggle Pause on an ongoing reflection.
- [ ] **Empty windows + auto-upgrade:** Confirm a window with 0 fragments writes the hardcoded empty snapshot (0 LLM tokens); import/backdate a fragment into that window and trigger `POST /api/reflections/generate-pending` → verify it auto-upgrades to a real snapshot.
- [ ] **Direct snapshot edit:** Edit a window's snapshot text → verify a new revision is appended, previous version remains viewable, and manually regenerating that window works without locking or losing the manual edit from history.

### 2.5 Explicitly Deferred Out of Stage 2
- Deleting dead legacy Go/TS code left over from the old shared refinement engine (Stage 3).
- Deep UI polish for revision diffs, schedule controls, and mobile/web responsive tuning (Stage 3).
- `canonical.go` schema cleanup (Stage 3).

---

## Stage 3 — Post-Validation Refinement, Cleanup, & Schema Consolidation

**Gate:** Start only after you've lived with Stages 1 and 2 on real workspace data and confirmed the core product mechanics feel right.

1. **Prompt & UX Tuning From Hands-On Usage**
   - Refine projection goal-directed system prompt, anchored update prompt, full-body replacement threshold (tune the % cutoff), and async living brief distillation prompt based on real outputs.
   - Refine reflection lens-authoring prompt and preview-awareness instructions.

2. **Backend Package Decoupling & Dead-Code Deletion (`kalaidoscope/`)**
   - Cleanly split `internal/projections/` (projection sessions, tools, anchored update, brief distillation, block diffs/edits) and `internal/reflections/` (reflection lens authoring, isolated preview, windowing, empty/manual snapshots).
   - Trim `internal/engine/` down to genuinely shared primitives (claim locking, `LiveFilter`, lens CRUD, context-spec delete scrubbing) and remove unused `Strategy` abstraction where it no longer fits.
   - Delete dead legacy code:
     - `CompileLens` (`internal/refinement/compile.go`) & `LensCountPin` (`internal/refinement/lint.go`)
     - `minimizeAgainstPrevious`, `SnapshotDeltaPrompt`, `SnapshotMergePrompt`
     - `settleApprovedInPlace`, `WithSettleUnchanged`, `CarryOpenRefinementToCandidate` (`internal/refinement/carry.go`)
     - `CandidateEngaged`, `discardEngaged`, `foldIn`, and blocking `candidate.outdated` logic
     - Reflection `pending_review` / `preview` / `output_draft` / `edits` code paths and windowless reflection fallbacks
   - Clean up corresponding dead TS client methods, hooks (`use-projection-review-actions.ts` fold-in code, `outdated-reason.ts` blocking gate), and React components.

3. **Secondary UX Polish & Edge Cases**
   - Verify all entry points end-to-end: Discover proposals (`proposed` → `active` for both projections & reflections), Explore → Projection graduation, Projection Fork (using the living editorial brief), soft-delete & restore.
   - Polish per-window revision history UI on Reflections, full-body replacement preview/confirm UX on Projections, and brief drawer UX across Desktop, Web, and Mobile.

4. **Phase 2 Canonical Schema Cleanup (`kalaidoscope/schema/canonical.go`)**
   - Add dedicated `origin` (`generated` | `manual` | `empty`) field on `reflection_snapshot` and migrate sentinels out of `generated_by_model`.
   - Drop obsolete columns (`generation_trigger`, reflection `output_draft` / `output_raw` / `edits`, `pending_review` select value on `reflection_snapshot`, `reflection_refinement.reflection_snapshot_id`).
   - Re-evaluate `lens` table vs. inline columns and `KALAIDO_HAND_EDIT_CREATE_FRAGMENT` based on hands-on experience.
   - Run `./kalaido.sh gen:types` and verify `./kalaido.sh check:schema-freshness`.

5. **Full Verification & Audit Doc Regeneration**
   - Run full checks across the workspace:
     ```bash
     ./kalaido.sh check:go && ./kalaido.sh test:go && ./kalaido.sh check:schema-freshness
     ./kalaido.sh check:ts && ./kalaido.sh test:ts
     ./kalaido.sh doctor:react . --no-cache --verbose --yes
     ```
   - Regenerate affected audit snapshots in `kalaidoscope/docs/*.md` using the `generate-audit-docs` skill.
