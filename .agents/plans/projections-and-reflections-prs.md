# Projections & Reflections — Product Requirements & Design Spec

> **Status:** Complete & updated from Stage 1 & Stage 2 hands-on validation.
> **Purpose:** Authoritative product & design specification for the simplified Projection and Reflection model. Subsequent implementation, cleanup, and deferred schema-consolidation plans derive from this spec.

---

## 1. Core Concept: Projections vs. Reflections

Projections and Reflections solve fundamentally different problems and should no longer be forced through a single tangled lifecycle.

| Dimension | Projection | Reflection |
|---|---|---|
| **Purpose** | Goal-directed synthesis over a subset of the workspace producing one living, persistent artifact | Summary of a subset of the workspace over recurring or bounded time windows |
| **Snapshot relationship** | **Incremental evolution** — successive snapshots update the same artifact as new information arrives | **Independent per window** — each window's snapshot is potentially and intentionally unrelated to those before or after it |
| **Generation trigger** | **Manual (pull)** — created, updated, and revised interactively by the user | **Automatic (scheduled / backfill / on-save)** — auto-approved by default |
| **Sources** | Fragments, colours, other projections, and reflections | Fragments and colours only |
| **What the chat refines** | **The document directly** (canvas-aware assistant; lens distilled on Save) | **The standing lens** (period-agnostic; every sample-window preview is generated strictly from the lens in isolation) |
| **Editing model** | Unified interactive session (AI chat + block-level `Edit` & `Refine` + inline diffs + context picker) | Direct markdown/text editing on individual window snapshots (appends a new per-window revision; no exploratory AI refinement); tuning via a 2-tab staged workspace (`Lens` \| `Schedule & Sources`) beside one persistent Preview pane |
| **Lens role** | Living editorial brief (data-agnostic purpose, structure, tone, inclusion rules) updated asynchronously on Save | Standing instruction applied directly to a window's fragments to generate each window from scratch |

---

## 2. Projections — Product Requirements

### 2.1 Mental Model & Ephemeral Single-Draft Sessions
- A **projection** is a synthesis over a subset of workspace sources producing a **saved, persistent artifact** (snapshot).
- Unlike **Explore** (open-ended conversation), a projection session is explicitly **goal-directed**: its system prompt guides the user toward converging on and saving a concrete artifact.
- **Sessions are ephemeral; the artifact is what persists.**
  - Projections are **not** "forever sessions" — saving or discarding closes the session permanently, and future updates or revisions always start a fresh session (for both product clarity and context-window hygiene).
  - **Strictly at most one resumable in-progress draft per projection:** Because sessions exist only to reach a chronological artifact, parallel drafts do not make sense. While a session is open (before clicking **Save** or **Discard**), its draft and chat persist so navigating away or closing the app resumes right where the user left off.
  - **"Draft in progress" is session-driven:** A projection shows `draft in progress` as soon as an interactive session has begun — even before the first draft text/snapshot exists — until the session is Saved or Discarded. *(Discover `proposed` projections remain `proposed` until opened into a session.)*

### 2.2 Unified Interactive Session (Create, Update, Revise)
Every way of producing or modifying a projection's content goes through the **same unified interactive session** (document canvas + chat + context picker):
- **Create:** Start from scratch, graduate from an Explore chat, fork an existing projection, or accept a Discover proposal (`proposed` → `active` on first Save).
- **Update (from Detail or List, even at `0` new fragments):** Clicking **Update** navigates **immediately** into the interactive session screen:
  - While generating, the left-hand canvas shows a **pulsating skeleton / loading state** and the chat pane displays live progress (staying on the session screen with inline **Retry / Back** on error).
  - When generation finishes:
    - **Incremental changes (below threshold)** → shows the previous version with inline block-level accept/reject diffs plus a chat summary.
    - **Sweeping changes (above threshold)** → **swaps the draft out wholesale** (clean new draft, no confirmation dialog, no unreadable wall of diffs) and **explicitly states in chat** that the full draft was replaced and why.
    - **Zero changes needed** → shows the unchanged draft plus an AI explanation of why the new sources did not warrant edits, so the user can discuss/tweak or click **Save** to record the new sources as seen.
- **Revise (already up to date):** Clicking **Edit / Revise** on an up-to-date saved projection opens the same interactive session (no separate quick-edit mode outside a session).

### 2.3 In-Session Editing, Diffs, & Save / Discard Rules
- **Block-level controls retained:** Individual blocks on the draft canvas expose:
  - **Edit:** Direct manual text edit on that block, applied immediately.
  - **Refine:** Targeted AI feedback scoped to that block/passage.
- **Inline diffs by default once a draft exists:**
  - The initial first draft during creation renders as clean text (nothing to diff against).
  - Once a draft exists, any AI modification — whether from incremental **Update**, targeted **Refine**, or a chat-requested revision — defaults to **inline accept/reject diff hunks** so the user always sees what changed.
  - **Full-body replacement confirmation (mid-session chat only):** If a **mid-session chat** request would replace essentially the entire document (above a size/proportion threshold) or the AI requests a ground-up rewrite, the AI must **confirm with the user** before replacing the whole body cleanly. *(Never shown on cross-session **Update**, which swaps wholesale and explains in chat.)*
- **Resolving diffs before Save:**
  - All proposed diff hunks must be resolved (accepted or rejected) before **Save** is enabled.
  - Provide per-hunk **Accept / Reject / Undo** controls plus **"Accept all"** and **"Reject all"** shortcuts.
- **Save / Discard lifecycle:**
  - **Save** commits the clean draft text as the new current saved snapshot, updates the projection's saved context spec, triggers an async update of the living editorial brief (lens), and closes the session permanently.
  - **Discard on a saved projection** abandons the in-progress draft and closes the session, leaving the previous saved snapshot untouched.
  - **Discard on a never-saved projection** (where the draft session *is* the projection):
    - User-created → **deletes the unsaved projection completely** (leaving no hollow row in the list or Recently Deleted).
    - Discover-originated → **reverts it back to `proposed`**.
  - **Starting fresh over an open draft (saved projections):**
    - On the detail freshness card: offer **Resume draft** alongside **Discard & update / Discard & start fresh** (with confirmation), so users don't have to open the old draft just to discard it.
    - On the list row: clicking **Update** on a row with an open draft confirms *"Discard existing draft and start fresh?"* and immediately opens the new update session.

### 2.4 Mid-Session Context Changes & Arriving Data
- **Human edits context via picker:** Users can add or remove sources at any time during a session. Changing context in the picker immediately sends a context-changed signal to the AI so it responds conversationally (e.g., *"Got it — added [X]. Would you like me to update the draft now?"*) rather than silently doing nothing or blindly overwriting the draft.
- **AI suggests context changes:** The AI can suggest adding/removing sources via a tool call (`update_context`), rendering an inline confirmation card in chat. Clicking **Confirm** updates the context picker immediately (declining leaves context unchanged).
- **New fragments arriving mid-session (non-blocking):**
  - Never freeze or block an open draft session when new matching fragments arrive (drop the blocking "outdated candidate" gate, `foldIn`, `CarryOpenRefinementToCandidate`, and `candidate_engaged`/`discardEngaged`).
  - Optionally display a subtle non-blocking notice; after Save, any still-unseen fragments surface naturally through normal freshness.

### 2.5 List View, Freshness, Lens Visibility, Entry Points, & Lifecycle
- **Projections list row:**
  - **Name column:** Clean projection name only (no legacy `"candidate"` pill).
  - **"Last generated" (Status) column:** Consolidates timestamp of last saved version, plain-language `draft in progress` indicator (when any session has begun), `X new since`, and an inline **Update** action accessible directly from the list even when `0` new fragments are in scope. No button to jump to a specific candidate/revision from the list.
- **Freshness ("Update available"):** Shown on a saved projection when **new matching fragments** enter its context spec OR when a **referenced upstream projection or reflection** has a newer saved snapshot (one-way additions; deletions/removals do not trigger staleness).
- **Lens visibility:** Kept **behind the scenes by default** so normal users don't manage prompts, but **inspectable and directly editable** in a secondary view/drawer if the user wants to inspect or correct drift.
- **Entry points & lifecycle (all retained):**
  - Create from scratch, graduate from Explore, fork an existing projection, accept Discover proposals (`proposed` → `active` on first Save).
  - Read-only version history of past saved snapshots.
  - Rename, per-entity model override (`generate_with_model`), pin, soft-delete, and restore.

---

## 3. Reflections — Product Requirements

### 3.1 Mental Model & Windowing
- A **reflection** is a summary of a subset of workspace fragments (**fragments and colours only** — never other projections or reflections) across **time windows**.
  - *Examples:* *"What themes came up in my notes to self this week?"*, *"What work got done this week?"*, *"What new problems arose this week?"*
- **Every reflection is windowed; ongoing scheduling is optional:**
  - Every reflection defines a window cadence/bounds (`period`, `duration`, `startTime`).
  - Ongoing forward scheduling is optional via an **end date (`endTime`)** and/or **paused** state — supporting both recurring live reflections and **purely historical / archival reflections** over a bounded past range that do not continue indefinitely.
  - Unscheduled (windowless) reflections are dropped (unscheduled synthesis is a Projection).

### 3.2 Staged 2-Tab Tuning Workspace (`Sources × Window Size × Standing Lens`)
Because a reflection's output quality depends on the 3-way balance of **Sources**, **Schedule window size**, and **Standing Lens** (e.g. switching weekly → monthly can turn a good lens into a wall of text), all three are tuned together beside one shared Preview pane:
- **Entry point:** On an established reflection, the tuning button is labeled **"Update"** (not "Refine").
- **2-tab workspace beside one persistent Preview pane:**
  - **Tab 1 — `Lens`:** Conversational AI authoring to refine the **period-agnostic standing lens** (never rendering `WindowDivider` rows in the chat transcript) **plus** direct viewing/editing of the standing lens text.
  - **Tab 2 — `Schedule & Sources`:** Cadence, start date, optional end date, pause toggle, and context/sources picker (fragments & colours only).
  - **Persistent Preview pane** (always visible beside both tabs): owns the **sample window selector** derived from the staged schedule.
- **All changes staged until atomic Save:**
  - Schedule, Sources, and Standing Lens changes are all staged locally and only persisted when the user clicks **Save** (no auto-saving schedule edits on click).
  - Clicking **Cancel** on an established reflection leaves its live schedule, sources, and lens completely untouched.
- **Manual Preview click for schedule/source/window changes:**
  - Changing cadence, dates, sources, or selecting a different sample window immediately updates the preview header with the sample window's **date range and matching fragment count** (zero LLM calls) and marks any displayed preview as out of sync with an explicit **"Preview"** button.
  - Clicking **Preview** runs the isolated lens application for that sample window (or immediately shows the empty-window state if 0 fragments match).
  - In the `Lens` chat, when the AI updates the lens via `set_lens`, it generates/updates the preview for the active sample window as part of that turn.

### 3.3 Never-Saved Draft Lifecycle vs. Established Reflections
- **Never-saved Reflection (no standing lens saved yet):**
  - Appears with a `draft in progress` indicator in the Reflections list and a dedicated **Draft in progress** panel offering **Resume draft** and **Discard draft**.
  - Clicking **Resume draft** restores the existing unfinished creation session (chat transcript, staged lens, sources, and schedule) rather than starting over.
  - Clicking **Discard** deletes the unsaved reflection completely (or reverts a Discover-originated proposal back to `proposed`) — never leaving a broken lensless reflection behind.
- **Established Reflection (already has a saved lens):**
  - Clicking **Update** opens a fresh tuning session seeded from the reflection's saved schedule, sources, and standing lens (no need to resume an abandoned tweak session; Cancel leaves the live reflection untouched).

### 3.4 Automatic Generation, Empty Windows, & Backfill
- **Auto-approved by default:** Every generated reflection snapshot is approved on arrival (no `pending_review` / candidate-review state on reflections).
- **Triggers for pending windows:**
  - **Save / activation** of a reflection (including bounded historical reflections) immediately starts generating pending windows in its range.
  - **Backfill** materializes earlier phase-aligned windows and immediately starts generating them.
  - **Scheduled cron** (`POST /api/reflections/generate-pending`) generates newly-due pending windows for reflections with active schedules.
- **Empty windows (0 matching fragments):**
  - Do **not** call the LLM. Record a **hardcoded empty snapshot** (e.g. *"No fragments in this window."*) so the timeline has an explicit entry without wasting tokens.
  - If backdated fragments later arrive in a window whose latest approved snapshot is a hardcoded empty placeholder, automatic scheduled generation (or manual generation) replaces it with a real LLM-generated snapshot.

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

## 4. Architecture & Implementation Design

### 4.1 Projection Session Architecture (Canvas-Aware Editing + Living Brief on Save)

#### In-Session Assistant (Direct Document Editing)
The projection assistant **sees the live draft directly** (injected freshly in the turn's system/context state so stale copies never accumulate in history, and every hand-edit or accepted/rejected hunk is automatically visible without replay bugs).

**Tools offered to the Projection assistant:**
1. **`write_draft { content }`** — Used to produce the initial first draft (when no draft exists yet) or to perform a full-body replacement **after** the user has confirmed one.
2. **`propose_edit { target, replacement }`** — Surgical passage/block replacement creating an inline accept/reject hunk (`<<<edit:id>>>`) on the draft. Used for block-level **Refine** and small/localized chat requests. Guarantees zero accidental drift in untouched sections.
3. **`update_draft { instructions }`** — Used for broad multi-section revisions or integrating newly added sources mid-session:
   - Runs a single anchored LLM call given `(current draft + standing editorial brief + resolved sources [tagging newly added items] + instructions)`, instructed to preserve untouched blocks verbatim.
   - Server computes `DiffAndMarkBlocks(currentDraft, updatedDraft)`:
     - Below the full-body threshold (e.g. ≤ 60% of blocks changed) → emits inline accept/reject diff hunks on the draft.
     - Above the full-body threshold → holds the proposed body and emits a **full-body replacement confirmation** prompt to the user; on user confirm, replaces `output_draft` cleanly.
4. **`request_full_rewrite { reason }`** — Triggers the same mid-session full-body replacement confirmation card before replacing the whole body.
5. **`update_context { ...changes, reason }`** — Proposes adding/removing sources; streams a confirmation card to chat. On user confirm, updates the session's context spec (visible immediately in the picker) and notifies the assistant.
6. **`suggest_name { name }`** — Offered only while the projection is unnamed / untitled.

**Removed from Projection chat:**
- No mid-session `update_lens(directive)` tool, `CompileLens`, blind `ApplyDraftLens`, `LensCountPin`, mid-session preview `lens` rows, or `regenerate_from_lens` confirmations.

**Retained for now:**
- Block-level `Edit` (`POST /api/projections/{id}/candidates/{rid}/edit`) and `KALAIDO_HAND_EDIT_CREATE_FRAGMENT` (`edit`-type fragment creation when enabled via env/store flag).
- Block-level edit triage & undo (`PATCH /api/projections/{id}/candidates/{rid}/edits/{eid}`) plus bulk `POST .../edits/resolve-all` (**Accept all** / **Reject all**).

#### Cross-Session Update (Async-Claim Immediate Navigation + 1-Call Anchored Update)
Clicking **Update** (from Detail or List, with optional `discardExisting: true` when replacing an open draft):
1. `POST /api/projections/{id}/candidates` with `{ async: true, discardExisting? }`:
   - Synchronously validates projection + anchor/brief, optionally discards existing pending candidate(s), claims a `generating` snapshot row (`claimID`), and returns `202 Accepted { snapshotId: claimID }` immediately so the UI navigates straight into the session screen with a pulsating skeleton.
   - Runs the 1-call anchored update on `deps.Runner` given `(previous saved snapshot + standing brief + resolved sources with newly arrived fragments / updated upstream snapshots clearly marked)`:
     - **Incremental changes (below threshold):** `DiffAndMarkBlocks(previousOutput, updatedOutput)` + opening assistant summary of changes.
     - **Sweeping changes (above threshold):** swaps `output_draft = updatedOutput` wholesale (`edits = []`, no confirmation card) and explicitly notes the wholesale replacement in the opening assistant summary.
     - **Zero changes needed:** `output_draft = previousOutput`, `edits = []`, + opening assistant explanation.
   - Attaches the `projection_refinement` session before promoting the claim to `pending_review` so SSE clients see draft + opening summary together; on failure, records the error in a per-app status tracker (`GET /api/projections/{id}/candidates/{rid}/status`) and releases the claim so the UI shows inline **Retry / Back**.
2. Eliminates the 3-turn `from-scratch → delta → merge` (`minimizeAgainstPrevious`) pipeline and eliminates `settleApprovedInPlace` / `WithSettleUnchanged`.

#### Save, Discard, & Async Lens Distillation (Living Editorial Brief)
- **Save** (requiring zero unresolved `<<<edit:>>>` markers):
  1. **Synchronous transaction (instant UX):** Promotes draft snapshot to `approved` (`output = trimmed output_draft`, next `approval_sequence_number`, `approved_at = now`), updates `projection.current_context_spec`, sets `projection.status = active`, discards stray pending rows, returns `200 { snapshotId }`.
  2. **Async background distillation (`deps.Runner`):** Compiles/updates the data-agnostic **living editorial brief** from `(previous lens + final snapshot + session transcript + edits)`, writes a new `lens` row, and updates `projection.current_lens_id` guarded by optimistic check (`current_lens_id == previousLensID`) so concurrent manual `PUT /api/projections/{id}/lens` edits are never clobbered. In-flight state is inspectable (`GET /api/projections/{id}/lens` → `updating`) and awaited (bounded) by Update.
- **Discard (`POST /api/projections/{id}/candidates/{rid}/discard` & `POST /api/projections/{id}/draft/discard`):**
  - Saved projection (≥ 1 approved snapshot) → marks pending candidate(s) `discarded`, preserving the live snapshot.
  - Never-saved Discover projection → discards pending candidates, deletes unbound refinements, reverts `status = "proposed"`.
  - Never-saved user projection → hard-deletes the projection (cascading abandoned draft & chat so no zombie row remains).

#### Mid-Session Context Picker Notification
- When the human adds or removes sources in the context picker during an open projection session, the client posts the updated `context_spec` immediately so the assistant receives the newly resolved delta and replies conversationally asking whether to update the draft now.

---

### 4.2 Reflection Architecture (Staged 2-Tab Tuning + Isolated Preview + Auto-Approved Windows)

#### Period-Agnostic 1-Step Lens Authoring & Stateless Staged Preview
Reflections are the exact dual of Projections: the chat refines the **standing lens**, and every preview is generated strictly from that lens in isolation.
- **Stateless preview endpoints (zero live-record mutation, zero chat pollution):**
  - `POST /api/reflections/preview-windows` (`{ reflectionId?, windowSpec, contextSpec }`) → validates schedule, enumerates candidate windows (capped at `min(now, endTime)`, falling back to trailing window if grid empty), strips upstream entities, counts matching fragments per window (zero LLM calls), and returns `{ windows, defaultWindowId }`.
  - `POST /api/reflections/preview` (`{ reflectionId?, lensPrompt, contextSpec, window, generateWithModel? }`) → short-circuits 0-fragment windows with `"No fragments in this window."` (zero LLM calls) or runs standalone `ApplyPrompt(lensPrompt, windowFragments, start, end)` with zero chat history.
- **Tools offered to the Reflection assistant (`StreamReflectionTurn`):**
  - **`set_lens { prompt }`** — Writes/updates the standing lens prompt directly in **1 step** (no `CompileLens`, no `LensCountPin`) and streams an isolated preview against the active sample window.
  - **`update_context { ...changes, reason }`** — Proposes context changes (fragments/colours only) with confirmation card updating the staged sources.
  - **`suggest_name { name }`** — Offered while unnamed.
- **Read-only preview visibility without transcript window dividers:**
  - Reflection chat requests pass optional `{ window, latestPreview, lensPrompt, contextSpec }` directly on the request rather than writing `window` system messages into the transcript (and `WindowDivider` is removed from `ChatMessages`).
  - On Turn N+1, the assistant sees the single latest preview output as read-only context and is instructed it can only change output by revising the lens via `set_lens`.
- **Atomic Save & Never-Saved Discard:**
  - `POST /api/reflections/{id}/save` (and extended `POST /api/reflections/{id}/refinements/{rid}/commit`) atomically persists staged `{ windowSpec?, contextSpec?, lensPrompt?, name? }` in one transaction (replacing v1 cleanly for never-saved reflections; appending a new schedule version if changed on established ones; appending a new `lens` row if new/changed), sets `status = active`, and kicks `RunPendingWindows`.
  - `GET/PUT /api/reflections/{id}/lens` also remains available for quick standalone lens inspection/editing from the series header.
  - `POST /api/reflections/{id}/draft/discard` hard-deletes never-saved user reflections (`!current_lens_id`), reverts Discover proposals to `proposed`, and refuses (`409`) established reflections.

#### Window Enumeration, Bounded/Paused Schedules, & Empty Windows
- **Schedule rules (`WindowSpec` inside `window_spec_versions` JSON):**
  - Every reflection requires a valid positive `period` (unscheduled/windowless reflections are rejected).
  - Evaluate `endTime` (stop enumerating grid windows past `endTime`) and `paused: bool` (skip forward grid windows in `PendingWindows` / `POST /api/reflections/generate-pending` while preserving history, manual regeneration, and backfill).
- **Empty windows (0 matching fragments):**
  - Before invoking the LLM for a window, resolve fragments in `[window_start, window_end)`.
  - If 0 fragments match, skip the LLM call and store an `approved` `reflection_snapshot` with `"No fragments in this window."`, `resolved_context = empty`, `lens_id = current_lens_id`, and sentinel `generated_by_model = "empty"`.
  - In `PendingWindows` and `POST /api/reflections/generate-pending`, an empty placeholder whose window now has matching backdated fragments is eligible for automatic upgrade to a real LLM-generated snapshot (`approval_sequence_number + 1`).
- **Auto-approved generation:** Drop `pending_review`, `preview: true`, `output_draft`, `edits`, and `minimizeAgainstPrevious` from Reflections. Every generated reflection snapshot goes `generating` → `approved`.

#### Direct Snapshot Editing (Per-Window Revision History)
- `POST /api/reflections/{id}/windows/{windowId}/edit` accepting `{ output }`:
  - Appends a new `approved` `reflection_snapshot` row for `(window_start, window_end)` with `approval_sequence_number = max + 1`, `output = trimmed output`, `lens_id` / `context_spec` / `resolved_context` copied from the prior approved snapshot (preventing false `lensOutdated` or `staleWindows`), and `generated_by_model = "manual"`.
  - Per-window revision history is viewable in the UI.

---

### 4.3 Backend Modularity & Zero-Migration Schema Strategy

#### Clean Backend Decoupling (`kalaidoscope/internal/`)
- Separate Projection and Reflection session/generation flows cleanly; keep only genuinely shared low-level primitives shared (`internal/llmcontext`, `internal/llm`/`usage`/`queue`, `internal/chat`, trimmed `internal/engine`).

#### Schema Strategy: Zero Breaking Migrations Now, Clean Consolidation Later
- **Phase 1 (zero `canonical.go` migrations):**
  - Reuse the existing `lens` table via dedicated `GET/PUT .../lens` and atomic save endpoints.
  - Store `endTime` and `paused` inside existing `window_spec_versions` JSON (`api.WindowSpec`).
  - Distinguish reflection snapshot origin via `reflection_snapshot.generated_by_model` sentinels (`"empty"` for hardcoded empty placeholder, `"manual"` for human-edited revision, real model ID for LLM-generated).
  - Leave unused legacy columns inert.
- **Phase 2 (deferred schema cleanup — Stage 3 after validation):**
  - Add dedicated `origin` (`generated` | `manual` | `empty`) field on `reflection_snapshot` (migrating sentinels out of `generated_by_model`).
  - Drop dead columns (`generation_trigger`, reflection `output_draft`/`output_raw`/`edits`, `pending_review` on `reflection_snapshot`, `reflection_refinement.reflection_snapshot_id`).
  - Re-evaluate `lens` table vs. inline columns and `KALAIDO_HAND_EDIT_CREATE_FRAGMENT` based on hands-on experience.

---

## 5. Summary of What Gets Removed vs. Added

### Removed
- Blind projection refinement writer, mid-session `CompileLens`, `LensCountPin`, mid-session preview lens rows, and `regenerate_from_lens` confirmations.
- 3-turn `minimizeAgainstPrevious`, `settleApprovedInPlace` / `WithSettleUnchanged` (`foldIn`), blocking `outdated candidate` freeze gate, `CarryOpenRefinementToCandidate`, and `candidate_engaged` / `discardEngaged`.
- Legacy `"candidate"` list pill, misleading far-right `"Review candidate"` icon, `WindowDivider` in reflection chat, reflection schedule auto-save (`usePersistSchedule`), reflection `pending_review`/`output_draft`/`edits`, `refine_candidate` on reflections, and unscheduled/windowless reflections.

### Added / Changed
- **Projections:** Session-driven `draft in progress` + unified "Last generated" status column with direct list-row **Update** (even at `0` new fragments); async-claim **Update** with immediate navigation + pulsating skeleton + wholesale swap with chat explanation on sweeping changes; canvas-aware direct-editing session (`write_draft`, `propose_edit`, anchored `update_draft` with mid-session full-body confirmation, `update_context` confirm, picker-change AI notice); **Accept all / Reject all**; **Discard & start fresh** on freshness card & list row; hard-delete/revert-to-proposed on never-saved Discard; instant Save + async living editorial brief distillation with optimistic concurrency guard and secondary brief drawer (`GET/PUT .../lens`).
- **Reflections:** 2-tab staged tuning workspace (`Lens` \| `Schedule & Sources`) beside one persistent Preview pane; stateless `preview-windows` (with fragment counts) & `preview` endpoints + manual **Preview** button; atomic Save (`POST .../save` + commit); 1-step `set_lens` + read-only preview visibility in chat (no `WindowDivider`); resumable never-saved drafts + hard-delete/revert Discard (`POST .../draft/discard`); established-reflection button renamed **Update**; bounded/paused schedules (`endTime` + `paused`); hardcoded empty windows (auto-upgraded on backdated fragments); direct per-window snapshot text editing appending new revisions with per-window history.
