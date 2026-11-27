# Projections & Reflections — Product Requirements, Design Spec, & Follow-Up Backlog

> **Status:** Stages 1 & 2, hands-on product fixes, and schema-free Go backend cleanup are **implemented**. Deferred Stage 3 follow-up items (prompt/UX tuning, TS dead-code cleanup, canonical schema consolidation, and audit-doc regeneration) are tracked in [Section 6](#6-remaining-follow-up-work-deferred).
> **Purpose:** Single authoritative specification capturing the simplified Projection and Reflection model, the rationale behind every product decision, the current architecture, and the remaining deferred work.

---

## 1. Core Concept: Projections vs. Reflections

Projections and Reflections solve fundamentally different problems and are no longer forced through a single tangled lifecycle.

| Dimension | Projection | Reflection |
|---|---|---|
| **Purpose** | Goal-directed synthesis over a subset of the workspace producing one living, persistent artifact | Summary of a subset of the workspace over recurring or bounded time windows |
| **Snapshot relationship** | **Incremental evolution** — successive snapshots update the same artifact as new information arrives | **Independent per window** — each window's snapshot is potentially and intentionally unrelated to those before or after it |
| **Generation trigger** | **Manual (pull)** — created, updated, and revised interactively by the user; never pushed or cascaded by background workers | **Automatic (scheduled / backfill / on-save)** — auto-approved by default |
| **Sources** | Fragments, colours, other projections, and reflections | Fragments and colours only |
| **What the chat refines** | **The document directly** (canvas-aware assistant; editorial brief distilled asynchronously on Save) | **The standing lens** (period-agnostic; every sample-window preview is generated strictly from the lens in isolation) |
| **Editing model** | Unified interactive session (AI chat + block-level `Edit` & `Refine` + inline diffs + context picker) | Direct markdown/text editing on individual window snapshots (appends a new per-window revision; no exploratory AI refinement); tuning via a 2-tab staged workspace (`Lens` \| `Schedule & Sources`) beside one persistent Preview pane |
| **Lens role** | Living editorial brief (data-agnostic purpose, structure, tone, inclusion rules) updated asynchronously on Save | Standing instruction applied directly to a window's fragments to generate each window from scratch |

### Cross-Cutting Simplification Principles (Post-K-345)
- **No push/cascade reconcile waves:** Nothing in the server proactively triggers or cascades projection regenerations when fragments, colours, maps, or upstream entities change.
- **No recursive dependency blocking (`BlockedBy` DAG):** Upstream staleness is surfaced passively (1-hop `staleDependencies` + `newFragmentIds`) and never blocks manual regeneration with `409`.
- **Single-entity passive freshness & simple generation locking:** Freshness evaluates the target entity directly; concurrent generation requests on the same entity/window return `409` rather than joining an in-flight claim.

---

## 2. Projections — Product Requirements & Rationale

### 2.1 Mental Model & Ephemeral Single-Draft Sessions
- A **projection** is a synthesis over a subset of workspace sources producing a **saved, persistent artifact** (snapshot).
- Unlike **Explore** (open-ended conversation), a projection session is explicitly **goal-directed**: its system prompt guides the user toward converging on and saving a concrete artifact.
- **Sessions are ephemeral; the artifact is what persists:**
  - Projections are **not** "forever sessions" — saving or discarding closes the session permanently, and future updates or revisions always start a fresh session (for both product clarity and context-window hygiene).
  - **Strictly at most one resumable in-progress draft per projection:** Because sessions exist only to reach a chronological saved artifact, parallel drafts don't make sense — an abandoned session is neither a historical artifact nor a scratchpad to return to later. While a session is open (before clicking **Save** or **Discard**), its draft and chat persist so navigating away or closing the app resumes right where the user left off.
  - **"Draft in progress" is session-driven, not snapshot-driven:** A projection shows `draft in progress` as soon as an interactive session has begun — even during initial chat turns before any draft text/snapshot exists — until the session is Saved or Discarded. *(Discover `proposed` projections remain `proposed` until opened into a session.)*

### 2.2 Unified Interactive Session (Create, Update, Revise)
Every way of producing or modifying a projection's content goes through the **same unified interactive session** (document canvas + chat + context picker):
- **Create:** Start from scratch, graduate from an Explore chat, fork an existing projection, or accept a Discover proposal (`proposed` → `active` on first Save).
- **Update (from Detail or List, even at `0` new fragments):** Clicking **Update** navigates **immediately** into the interactive session screen (never blocking on the list/detail screen for several seconds while the LLM runs):
  - While generating, the left-hand canvas shows a **pulsating skeleton / loading state** and the chat pane displays live progress (staying on the session screen with inline **Retry / Back** on error).
  - When generation finishes:
    - **Incremental changes (below threshold)** → shows the previous version with inline block-level accept/reject diffs plus a chat summary of what changed.
    - **Sweeping changes (above threshold)** → **swaps the draft out wholesale** (clean new draft — no unreadable wall of diffs and **no confirmation dialog**) and **explicitly states in chat** that the full draft was replaced and why.
      - *Rationale:* A "replace full draft?" popup right after the user explicitly clicked **Update** is jarring and redundant; the previous saved snapshot remains untouched until Save, and the user can Discard at any time.
    - **Zero changes needed** → shows the unchanged draft plus an AI explanation of why the new sources did not warrant edits, so the user can discuss/tweak or click **Save** to record the new sources as seen.
- **Revise (already up to date):** Clicking **Edit / Revise** on an up-to-date saved projection opens the same interactive session (no separate quick-edit mode outside a session).

### 2.3 In-Session Editing, Diffs, & Save / Discard Rules
- **Block-level controls retained:** Individual blocks on the draft canvas expose:
  - **Edit:** Direct manual text edit on that block, applied immediately.
  - **Refine:** Targeted AI feedback scoped to that block/passage.
- **Inline diffs by default once a draft exists:**
  - The initial first draft during creation renders as clean text (nothing to diff against).
  - Once a draft exists, any AI modification — whether from incremental **Update**, targeted **Refine**, or a chat-requested revision — defaults to **inline accept/reject diff hunks** so the user always sees what changed.
  - **Full-body replacement confirmation (mid-session chat only):** If a **mid-session chat** request would replace essentially the entire document (above a size/proportion threshold) or the AI explicitly requests a ground-up rewrite, the AI must **confirm with the user** before replacing the whole body cleanly. *(Never shown on cross-session **Update**, which swaps wholesale and explains in chat.)*
- **Resolving diffs before Save:**
  - All proposed diff hunks must be resolved (accepted or rejected) before **Save** is enabled.
  - Per-hunk **Accept / Reject / Undo** controls plus **"Accept all"** and **"Reject all"** shortcuts.
- **Save / Discard lifecycle:**
  - **Save** commits the clean draft text as the new current saved snapshot, updates the projection's saved context spec, triggers an async update of the living editorial brief (lens), and closes the session permanently.
  - **Discard on a saved projection** abandons the in-progress draft and closes the session, leaving the previous saved snapshot untouched.
  - **Discard on a never-saved projection** (where the draft session *is* the projection):
    - User-created → **hard-deletes the unsaved projection completely** (never leaving a hollow active row in the list or Recently Deleted).
    - Discover-originated → **reverts it back to `proposed`**.
  - **Starting fresh over an open draft (saved projections):**
    - On the detail freshness card: offer **Resume draft** (primary) alongside **Discard & update / Discard & start fresh** (with confirmation), so users don't have to enter the old draft just to discard it and come back.
    - On the list row: clicking **Update** on a row with an open draft confirms *"Discard existing draft and start fresh?"* and immediately opens the new update session.

### 2.4 Mid-Session Context Changes & Arriving Data
- **Human edits context via picker:** Users can add or remove sources at any time during a session. Changing context in the picker immediately sends a context-changed signal to the AI so it responds conversationally (e.g. *"Got it — added [X]. Would you like me to update the draft now?"*) rather than silently doing nothing or blindly overwriting the draft.
- **AI suggests context changes:** The AI can suggest adding/removing sources via `update_context`, rendering an inline confirmation card in chat. Clicking **Confirm** updates the context picker immediately (declining leaves context unchanged).
- **New fragments arriving mid-session (non-blocking):**
  - Never freeze or block an open draft session when new matching fragments arrive (no blocking "outdated candidate" gate, no `foldIn`, no `CarryOpenRefinementToCandidate`, and no `candidate_engaged`/`discardEngaged`).
  - Optionally show a subtle non-blocking notice; after Save, any still-unseen fragments surface naturally through normal freshness.

### 2.5 List View, Freshness, Lens Visibility, Entry Points, & Lifecycle
- **Projections list row:**
  - **Name column:** Clean projection name only (no legacy `"candidate"` jargon pill).
  - **"Last generated" (Status) column:** Consolidates timestamp of last saved version, plain-language `draft in progress` indicator (session-driven), `X new since`, and an inline **Update / Refresh** action available directly from the list even when `0` new fragments are in scope.
  - **No jump-to-specific-revision button on the list:** Removed the old misleading circular-arrows `"Review candidate"` icon.
- **Freshness ("Update available"):** Shown on a saved projection when **new matching fragments** enter its context spec OR when a **1-hop referenced upstream projection or reflection** has a newer saved snapshot (one-way additions; deletions/removals do not trigger staleness).
- **Living editorial brief (lens) visibility:** Kept **behind the scenes by default** so normal users don't manage prompts, but **inspectable and directly editable** in a secondary drawer if the user wants to inspect or correct drift.
- **Entry points & lifecycle (all retained):**
  - Create from scratch, graduate from Explore, fork an existing projection, accept Discover proposals (`proposed` → `active` on first Save).
  - Read-only version history of past saved snapshots.
  - Rename, per-entity model override (`generate_with_model`), pin, soft-delete, and restore.

---

## 3. Reflections — Product Requirements & Rationale

### 3.1 Mental Model & Windowing
- A **reflection** is a summary of a subset of workspace fragments (**fragments and colours only** — never other projections or reflections) across **time windows**.
  - *Examples:* *"What themes came up in my notes to self this week?"*, *"What work got done this week?"*, *"What new problems arose this week?"*
- **Every reflection is windowed; ongoing scheduling is optional:**
  - Every reflection defines a window cadence/bounds (`period`, `duration`, `startTime`).
  - Ongoing forward scheduling is optional via an **end date (`endTime`)** and/or **paused** state — supporting both recurring live reflections and **purely historical / archival reflections** over a bounded past range that do not continue indefinitely.
  - Unscheduled (windowless) reflections are dropped (unscheduled synthesis is a Projection).

### 3.2 Staged 2-Tab Tuning Workspace (`Sources × Window Size × Standing Lens`)
- **Core product insight:** A Reflection's output quality depends on the 3-way balance of **Sources**, **Schedule window size**, and **Standing Lens** (e.g. switching weekly → monthly can turn a good lens into an unreadable wall of text, requiring a prompt tweak). Users need the **same Preview pane** while flicking between adjusting schedule/sources and adjusting the lens — without mashing all controls together simultaneously or prematurely mutating the live Reflection.
- **Entry point:** On an established reflection, the tuning button is labeled **"Update"** (replacing the overloaded "Refine" label).
- **2-tab workspace beside one persistent Preview pane:**
  - **Tab 1 — `Lens`:** Conversational AI authoring to refine the **period-agnostic standing lens** **plus** direct viewing/editing of the standing lens text.
    - **Never render `WindowDivider` rows** in the reflection lens chat transcript — the chat is period-agnostic, and the active sample window belongs exclusively on the Preview pane.
  - **Tab 2 — `Schedule & Sources`:** Cadence, start date, optional end date, pause toggle, and context/sources picker (fragments & colours only).
  - **Persistent Preview pane** (always visible beside both tabs): owns the **sample window selector** derived from the staged schedule.
- **All changes staged until atomic Save:**
  - Schedule, Sources, and Standing Lens changes are all staged together and only persisted when the user clicks **Save** (no auto-saving schedule edits on click).
  - Clicking **Cancel** on an established reflection leaves its live schedule, sources, and lens completely untouched.
- **Manual Preview button for schedule/source/window changes:**
  - Changing cadence, dates, sources, or selecting a different sample window immediately updates the preview header with the sample window's **date range and matching fragment count** (e.g. *"Oct 1 – Oct 31 · 47 fragments"*, zero LLM calls) and marks any displayed preview as out of sync with an explicit **"Preview"** button — avoiding wasted LLM calls while rapidly adjusting settings.
  - Clicking **Preview** runs the isolated lens application for that sample window (or immediately shows the empty-window state if 0 fragments match).
  - In the `Lens` chat, when the AI updates the lens via `set_lens`, it generates/updates the preview for the active sample window as part of that turn.

### 3.3 Never-Saved Draft Lifecycle vs. Established Reflections
- **Never-saved Reflection (no standing lens saved yet):**
  - Treated as a **resumable in-progress draft** (matching Projections): appears with `draft in progress` in the Reflections list and a dedicated **Draft in progress** panel offering **Resume draft** and **Discard draft**.
  - Clicking **Resume draft** restores the existing unfinished creation session (chat transcript, staged lens, sources, and schedule) rather than silently starting over.
  - Clicking **Discard** hard-deletes the unsaved reflection completely (or reverts a Discover-originated proposal back to `proposed`) — never leaving a broken lensless reflection behind.
- **Established Reflection (already has a saved lens):**
  - Clicking **Update** opens a fresh tuning session seeded from the reflection's saved schedule, sources, and standing lens (no need to resume an abandoned tweak session; Cancel leaves the live reflection untouched).

### 3.4 Automatic Generation, Empty Windows, & Backfill
- **Auto-approved by default:** Every generated reflection snapshot is approved on arrival (no `pending_review` / candidate-review state on reflections).
- **Triggers for pending windows:**
  - **Save / activation** of a reflection (including bounded historical reflections) immediately starts generating pending windows in its range.
  - **Backfill** materializes earlier phase-aligned windows and immediately starts generating them.
  - **Scheduled cron** (`POST /api/reflections/generate-pending`) runs **synchronously** across active reflections' pending windows (holding the cloud container awake for the full run) without touching projections or overwriting already-approved windows.
- **Empty windows (0 matching fragments):**
  - Do **not** call the LLM. Record a **hardcoded empty snapshot** (`"No fragments in this window."`) so the timeline has an explicit entry without wasting tokens.
  - If backdated fragments later arrive in a window whose latest approved snapshot is a hardcoded empty placeholder, automatic scheduled generation (or manual generation) upgrades it to a real LLM-generated snapshot.

### 3.5 Direct Snapshot Editing & Per-Window Revision History
- Users can **directly edit the text** of any specific reflection window's snapshot to fix errors or tweak wording (plain markdown/text editing — not exploratory AI refinement).
- **Non-destructive per-window history:** Saving a manual edit appends a **new saved revision** for that window (`approval_sequence_number + 1`). Because every edit and generation is preserved in that window's history, manual edits never block or require special locks against future manual regeneration.

### 3.6 Drift, Schedule Changes, & Lifecycle
- **Never silently overwrite existing non-empty windows:**
  - When a reflection's **lens or context changes**, past windows stay as-is and are flagged (e.g. *"Older lens"* / config outdated); future windows use the new lens/context. Users can manually regenerate a single window or bulk-regenerate affected windows.
  - When **backdated fragments** arrive for an already-generated (non-empty) window, that window is flagged as having **new fragments** for manual refresh (never silently overwritten by cron).
- **Schedule changes:** Editing a reflection's cadence/schedule applies going forward while keeping previously generated windows in the series.
- **Entry points & lifecycle:** Create from scratch, accept Discover proposals (`proposed` → `active`), manual backfill, rename, per-entity model override, pin, soft-delete, and restore.

---

## 4. Architecture & Implementation Design (Current State)

### 4.1 Backend Package Structure (`kalaidoscope/internal/`)
Projection and Reflection flows are cleanly decoupled into their own packages (the legacy `internal/refinement/` package has been removed):
- **`internal/chat/`** — shared transcript hydration plus entity-agnostic chat tools & session helpers (`tools.go`: `SuggestNameTool`, `UpdateContextTool`, context confirmation helpers, `StreamNameOnlyContinuation`, shared session sentinel errors).
- **`internal/engine/`** — minimal shared primitives (`GenerateOutput`, `FindPendingCandidate`, claim locking, `LiveFilter`, lens CRUD, context-spec delete scrubbing, sentinel model constants `"empty"` / `"manual"`).
- **`internal/projections/`** — projection chat (`chat.go`, `tools.go`), session lifecycle (`session.go`), anchored cross-session update, async brief distillation (`brief.go`), and block diffs/edits (`edit.go`).
- **`internal/reflections/`** — reflection lens-authoring chat (`chat.go`, `tools.go`), session lifecycle (`session.go`), stateless preview, windowing (`windows.go`, `windowspec.go`), empty-window handling, and per-window manual edits.

### 4.2 Projection Session Architecture
- **Canvas-aware in-session assistant:** The live draft (`output_draft`) is injected freshly in the turn's system/context state (so stale copies never accumulate in history, and every manual edit or accepted/rejected hunk is visible without replay bugs).
  - **Tools:** `write_draft { content }`, `propose_edit { target, replacement }`, `update_draft { instructions }` (single anchored LLM call + `DiffAndMarkBlocks`, triggering a mid-session full-body replacement confirmation card when above threshold), `request_full_rewrite { reason }`, `update_context { ...changes, reason }`, and `suggest_name { name }` (only while unnamed).
  - **Block-level endpoints retained:** `POST /api/projections/{id}/candidates/{rid}/edit` (hand-edits + optional `KALAIDO_HAND_EDIT_CREATE_FRAGMENT`), `PATCH .../edits/{eid}` (per-hunk triage/undo), `POST .../edits/resolve-all` (**Accept all** / **Reject all**).
  - **Mid-session picker change:** Client posts updated `context_spec` immediately so the assistant sees the delta and replies conversationally asking whether to update the draft.
- **Async-claim cross-session Update (`POST /api/projections/{id}/candidates` with `{ async: true, discardExisting? }`):**
  - Synchronously validates projection + anchor/brief, optionally discards existing pending candidate(s), claims a `generating` snapshot row, and returns `202 Accepted { snapshotId }` immediately so the UI navigates straight to the session screen with a pulsating skeleton.
  - Runs 1-call anchored update on `deps.Runner` → incremental diffs + summary, wholesale swap + explanation (no confirmation card), or unchanged draft + explanation; attaches `projection_refinement` before promoting to `pending_review`; errors exposed via `GET /api/projections/{id}/candidates/{rid}/status`.
- **Save & Async Brief Distillation:**
  - Synchronous transaction validates zero unresolved `<<<edit:>>>` markers, promotes draft to `approved`, updates `current_context_spec` and `status = active`, returns `200 { snapshotId }`.
  - Background `deps.Runner` job distills the data-agnostic **living editorial brief** into a new `lens` row and updates `projection.current_lens_id` guarded by optimistic check (`current_lens_id == previousLensID`) so concurrent manual `PUT /api/projections/{id}/lens` edits are never clobbered. In-flight state is exposed on `GET /api/projections/{id}/lens` (`updating`) and awaited (bounded) by Update.
- **Discard (`POST /api/projections/{id}/candidates/{rid}/discard` & `POST /api/projections/{id}/draft/discard`):**
  - Saved projection → marks pending candidate(s) `discarded`.
  - Never-saved Discover projection → reverts `status = "proposed"`.
  - Never-saved user projection → hard-deletes the projection.

### 4.3 Reflection Architecture
- **Stateless preview endpoints (zero live mutation, zero chat pollution):**
  - `POST /api/reflections/preview-windows` (`{ reflectionId?, windowSpec, contextSpec }`) → validates schedule, enumerates candidate windows capped at `min(now, endTime)` (falling back to trailing window if grid empty), strips upstream entities, counts matching fragments per window (zero LLM calls), returns `{ windows, defaultWindowId }`.
  - `POST /api/reflections/preview` (`{ reflectionId?, lensPrompt, contextSpec, window, generateWithModel? }`) → short-circuits 0-fragment windows with `"No fragments in this window."` or runs standalone `ApplyPrompt(lensPrompt, windowFragments, start, end)` with zero chat history.
- **1-step period-agnostic lens authoring (`StreamChatTurn`):**
  - **Tools:** `set_lens { prompt }` (updates lens in 1 step and streams isolated preview for the active sample window), `update_context { ...changes, reason }` (fragments/colours only), `suggest_name { name }` (when unnamed).
  - Request carries optional `{ window, latestPreview, lensPrompt, contextSpec }` directly (never writing `window` system messages into the transcript). Turn N+1 injects the single latest preview output as read-only context; assistant can only change output via `set_lens`.
- **Atomic Save & Never-Saved Discard:**
  - `POST /api/reflections/{id}/save` (and `POST /api/reflections/{id}/refinements/{rid}/commit`) atomically persists staged `{ windowSpec?, contextSpec?, lensPrompt?, name? }` in one transaction, sets `status = active`, and kicks `RunPendingWindows`.
  - `GET/PUT /api/reflections/{id}/lens` remains available for quick standalone lens inspection/editing.
  - `POST /api/reflections/{id}/draft/discard` hard-deletes never-saved user reflections (`!current_lens_id`), reverts Discover proposals to `proposed`, and refuses (`409`) established reflections.
- **Windowing, Empty Windows, & Per-Window Manual Edits:**
  - `WindowSpec` requires positive `period`; supports `endTime` (caps `GridWindows` at `min(now, endTime)`) and `paused: bool` (skips forward cron windows while preserving history, manual regeneration, and backfill).
  - 0-fragment windows write an `approved` snapshot with `"No fragments in this window."` and `generated_by_model = "empty"` (0 LLM calls); `PendingWindows` / `POST /api/reflections/generate-pending` auto-upgrade `"empty"` windows if matching backdated fragments later arrive.
  - `POST /api/reflections/{id}/windows/{windowId}/edit` appends a new `approved` snapshot (`approval_sequence_number + 1`, `generated_by_model = "manual"`, copying prior `lens_id` / `context_spec` / `resolved_context` to prevent false drift flags).

### 4.4 Current Zero-Migration Schema Representation (Phase 1)
No `kalaidoscope/schema/canonical.go` migrations have been run yet:
- Existing `lens` table is reused via dedicated `GET/PUT .../lens` and atomic save endpoints.
- `endTime` and `paused` live inside existing `window_spec_versions` JSON (`api.WindowSpec`).
- Reflection snapshot origin is represented via `reflection_snapshot.generated_by_model` sentinels (`"empty"` for hardcoded empty placeholder, `"manual"` for human-edited revision, real model ID for LLM-generated).
- Obsolete legacy columns remain inert in the schema until Phase 2 consolidation.

---

## 5. Summary of Removed Legacy Concepts

- Background reconcile wave worker (`reconcile/worker.go`), `POST /api/reconcile`, `KALAIDO_AUTO_WAVE`, `EnqueueWave` push triggers, recursive `BlockedBy` DAG / `topoSort` / `409` upstream blocking, and in-flight claim joining (`claimhub.go`).
- Legacy `internal/refinement/` package: blind projection writer, `CompileLens`, `LensCountPin`, mid-session preview lens rows, `regenerate_from_lens` confirmations, `refine_candidate`, `CarryOpenRefinementToCandidate`.
- 3-turn `minimizeAgainstPrevious` (`SnapshotDeltaPrompt` / `SnapshotMergePrompt`), `settleApprovedInPlace` / `WithSettleUnchanged` (`foldIn`), `CandidateEngaged` / `discardEngaged`, and blocking `candidate.outdated` freeze gates.
- Legacy `"candidate"` list pill, misleading far-right `"Review candidate"` icon, `WindowDivider` in reflection chat, reflection schedule auto-save (`usePersistSchedule`), reflection `pending_review` / `output_draft` / `edits`, and unscheduled/windowless reflections.

---

## 6. Remaining Follow-Up Work (Deferred)

1. **Prompt & Rewrite-Threshold Tuning From Live Usage**
   - Tune the projection goal-directed system prompt, anchored update prompt, full-body replacement % cutoff, and async living brief distillation prompt based on real workspace outputs.
   - Tune the reflection lens-authoring prompt and read-only preview-awareness instructions.

2. **Remaining TypeScript / React Dead-Code Cleanup & Full Workspace Checks**
   - Audit `packages/lib/client/`, `packages/react/hooks/`, `packages/react/features/`, and `apps/*` for any remaining dead legacy helpers (e.g. fold-in remnants, blocking `outdated-reason.ts` helpers, unused DTO types).
   - Run full TS & React Doctor checks (`./kalaido.sh check:ts`, `./kalaido.sh test:ts`, `./kalaido.sh doctor:react . --no-cache --verbose --yes`, via `./kalaido-mac.sh` where host Node/SDK is needed).

3. **Secondary UX Polish & Cross-Platform Verification**
   - Verify all entry points end-to-end: Discover proposals (`proposed` → `active` for both Projections and Reflections), Explore → Projection graduation, Projection Fork (using the living editorial brief), soft-delete & restore.
   - Polish per-window revision history UI on Reflections, full-body replacement confirm UX on Projections, and brief drawer UX across Desktop, Web, and Mobile.

4. **Phase 2 Canonical Schema Consolidation (`kalaidoscope/schema/canonical.go`)**
   - Add a dedicated `origin` (`generated` | `manual` | `empty`) field on `reflection_snapshot` and migrate sentinels out of `generated_by_model`.
   - Drop obsolete inert columns (`generation_trigger`, reflection `output_draft` / `output_raw` / `edits`, `pending_review` select value on `reflection_snapshot`, `reflection_refinement.reflection_snapshot_id`).
   - Re-evaluate `lens` table vs. inline columns and `KALAIDO_HAND_EDIT_CREATE_FRAGMENT` based on hands-on experience.
   - Run `./kalaido.sh gen:types` and verify `./kalaido.sh check:schema-freshness`.

5. **Regenerate Audit Docs (`kalaidoscope/docs/*.md`)**
   - Once schema consolidation and remaining backend tweaks settle, regenerate affected audit docs using the `generate-audit-docs` skill (clearing the `> **STALE**` markers).
