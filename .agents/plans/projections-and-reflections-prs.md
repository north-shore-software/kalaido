# Projections & Reflections — Product Requirements & Design Spec

> **Status:** Complete (Product Requirements + Architecture Decisions settled via `/grill-me`).
> **Purpose:** Authoritative product & design specification for the simplified Projection and Reflection model. Subsequent Go backend, TypeScript client, UI, and deferred schema-cleanup implementation plans derive from this spec.

---

## 1. Core Concept: Projections vs. Reflections

Projections and Reflections solve fundamentally different problems and should no longer be forced through a single tangled lifecycle.

| Dimension | Projection | Reflection |
|---|---|---|
| **Purpose** | Goal-directed synthesis over a subset of the workspace producing one living, persistent artifact | Summary of a subset of the workspace over recurring or bounded time windows |
| **Snapshot relationship** | **Incremental evolution** — successive snapshots update the same artifact as new information arrives | **Independent per window** — each window's snapshot is potentially and intentionally unrelated to those before or after it |
| **Generation trigger** | **Manual (pull)** — created, updated, and revised interactively by the user | **Automatic (scheduled / backfill / on-save)** — auto-approved by default |
| **Sources** | Fragments, colours, other projections, and reflections | Fragments and colours only |
| **What the chat refines** | **The document directly** (canvas-aware assistant; lens distilled on Save) | **The standing lens** (every sample-window preview is generated strictly from the lens in isolation) |
| **Editing model** | Unified interactive session (AI chat + block-level `Edit` & `Refine` + inline diffs + context picker) | Direct markdown/text editing on individual window snapshots (appends a new per-window revision; no exploratory AI refinement) |
| **Lens role** | Living editorial brief (data-agnostic purpose, structure, tone, inclusion rules) updated asynchronously on Save | Standing instruction applied directly to a window's fragments to generate each window from scratch |

---

## 2. Projections — Product Requirements

### 2.1 Mental Model & Ephemeral Sessions
- A **projection** is a synthesis over a subset of workspace sources producing a **saved, persistent artifact** (snapshot).
- Unlike **Explore** (open-ended conversation), a projection session is explicitly **goal-directed**: its system prompt guides the user toward converging on and saving a concrete artifact.
- **Sessions are ephemeral; the artifact is what persists.**
  - Projections are **not** "forever sessions" — saving or discarding closes the session permanently, and future updates or revisions always start a fresh session (for both product clarity and context-window hygiene).
  - **One resumable in-progress draft:** While a session is open (before clicking **Save** or **Discard**), its draft and chat persist so navigating away or closing the app resumes right where the user left off.

### 2.2 Unified Interactive Session (Create, Update, Revise)
Every way of producing or modifying a projection's content goes through the **same unified interactive session** (document canvas + chat + context picker):
- **Create:** Start from scratch, graduate from an Explore chat, fork an existing projection, or accept a Discover proposal (`proposed` → `active` on first Save).
- **Update (new data available):** Clicking **Update** on a saved projection immediately runs an update pass incorporating the new data and drops the user into a fresh interactive session:
  - When changes are needed → displays inline block-level accept/reject diffs against the previous saved snapshot (or triggers full-body confirmation if above threshold).
  - When the new data warrants **zero text changes** → still opens the session with the unchanged draft and an AI message explaining why the new sources did not require edits, so the user can discuss/tweak or click **Save** to record the new sources as seen.
- **Revise (already up to date):** Clicking **Edit / Revise** on an up-to-date saved projection opens the same interactive session (no separate quick-edit mode outside a session).

### 2.3 In-Session Editing, Diffs, & Save Rules
- **Block-level controls retained:** Individual blocks on the draft canvas expose:
  - **Edit:** Direct manual text edit on that block, applied immediately.
  - **Refine:** Targeted AI feedback scoped to that block/passage.
- **Inline diffs by default once a draft exists:**
  - The initial first draft during creation renders as clean text (nothing to diff against).
  - Once a draft exists, any AI modification — whether from **Update**, targeted **Refine**, or a chat-requested revision — defaults to **inline accept/reject diff hunks** so the user always sees what changed.
  - **Full-body replacement with confirmation:** If a chat-requested rewrite (or Update) would replace essentially the entire document (above a size/proportion threshold) or the AI requests a ground-up rewrite, the AI must **confirm with the user** before replacing the whole body cleanly.
- **Resolving diffs before Save:**
  - All proposed diff hunks must be resolved (accepted or rejected) before **Save** is enabled.
  - Provide per-hunk **Accept / Reject / Undo** controls plus **"Accept all"** and **"Reject all"** shortcuts.
- **Save / Discard:**
  - **Save** commits the clean draft text as the new current saved snapshot, updates the projection's saved context spec, triggers an async update of the living editorial brief (lens), and closes the session permanently.
  - **Discard** abandons the in-progress draft and closes the session (leaving the previous saved snapshot untouched; for a brand-new unsaved projection, deletes/reverts it).

### 2.4 Mid-Session Context Changes & Arriving Data
- **Human edits context via picker:** Users can add or remove sources at any time during a session. Changing context in the picker immediately sends a context-changed signal to the AI so it responds conversationally (e.g., *"Got it — added [X]. Would you like me to update the draft now?"*) rather than silently doing nothing or blindly overwriting the draft.
- **AI suggests context changes:** The AI can suggest adding/removing sources via a tool call (`update_context`), rendering an inline confirmation card in chat. Clicking **Confirm** updates the context picker immediately (declining leaves context unchanged).
- **New fragments arriving mid-session (non-blocking):**
  - Never freeze or block an open draft session when new matching fragments arrive (drop the blocking "outdated candidate" gate, `foldIn`, `CarryOpenRefinementToCandidate`, and `candidate_engaged`/`discardEngaged`).
  - Optionally display a subtle non-blocking notice (or an "Incorporate new fragments" action); after Save, any still-unseen fragments surface naturally through normal freshness.

### 2.5 Freshness, Lens Visibility, Entry Points, & Lifecycle
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

### 3.2 Standing Lens Authoring & Editing
- Reflections require a **standing lens** capable of generating any window's output from scratch using only that window's resolved fragments.
- **Dual authoring & editing UX:**
  - **Conversational authoring with live sample-window preview** (switchable across windows in the reflection's series) for creating and iterating on what the reflection produces.
  - **Direct viewing and editing of the standing lens text** anytime, without forcing a chat turn.

### 3.3 Automatic Generation, Empty Windows, & Backfill
- **Auto-approved by default:** Every generated reflection snapshot is approved on arrival (no `pending_review` / candidate-review state on reflections).
- **Triggers for pending windows:**
  - **Save / activation** of a reflection (including bounded historical reflections) immediately starts generating pending windows in its range.
  - **Backfill** materializes earlier phase-aligned windows and immediately starts generating them.
  - **Scheduled cron** (`POST /api/reflections/generate-pending`) generates newly-due pending windows for reflections with active schedules.
- **Empty windows (0 matching fragments):**
  - Do **not** call the LLM. Record a **hardcoded empty snapshot** (e.g. *"No fragments in this window."*) so the timeline has an explicit entry without wasting tokens.
  - If backdated fragments later arrive in a window whose latest approved snapshot is a hardcoded empty placeholder, automatic scheduled generation (or manual generation) replaces it with a real LLM-generated snapshot.

### 3.4 Direct Snapshot Editing & Per-Window Revision History
- Users can **directly edit the text** of any specific reflection window's snapshot to fix errors or tweak wording (plain markdown/text editing — not exploratory AI refinement).
- **Non-destructive per-window history:** Saving a manual edit appends a **new saved revision** for that window (`approval_sequence_number + 1`). Because every edit and generation is preserved in that window's history, manual edits never block or require special locks against future manual regeneration.

### 3.5 Drift, Schedule Changes, & Lifecycle
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
3. **`update_draft { instructions }`** *(or server-mediated anchored rewrite)* — Used for broad multi-section revisions or integrating newly added sources mid-session:
   - Runs a single anchored LLM call given `(current draft + standing editorial brief + resolved sources [tagging newly added items] + instructions)`, instructed to preserve untouched blocks verbatim.
   - Server computes `DiffAndMarkBlocks(currentDraft, updatedDraft)`:
     - If the changed proportion is **below the full-body threshold** (e.g. ≤ 60% of blocks/lines changed) → emits inline accept/reject diff hunks on the draft.
     - If the changed proportion **exceeds the full-body threshold** → holds the proposed body and emits a **full-body replacement confirmation** prompt to the user; on user confirm, replaces `output_draft` cleanly via `write_draft`.
4. **`request_full_rewrite { reason }`** *(if the model explicitly intends a ground-up restructure)* — Triggers the same full-body replacement confirmation card before replacing the whole body.
5. **`update_context { ...changes, reason }`** — Proposes adding/removing sources; streams a confirmation card to chat. On user confirm, updates the session's context spec (visible immediately in the picker) and notifies the assistant.
6. **`suggest_name { name }`** — Offered only while the projection is unnamed / untitled.

**Removed from Projection chat:**
- No mid-session `update_lens(directive)` tool.
- No `CompileLens` second LLM call during chat.
- No blind `ApplyDraftLens` from-scratch regeneration during chat.
- No `LensCountPin` linter.
- No preview `lens` rows created mid-session.
- No `regenerate_from_lens` / `data-regenerate_confirmation` dance.

**Retained for now:**
- Block-level `Edit` (`POST /api/projections/{id}/candidates/{rid}/edit`) and `KALAIDO_HAND_EDIT_CREATE_FRAGMENT` (`edit`-type fragment creation when enabled via env/store flag).
- Block-level edit triage & undo (`PATCH /api/projections/{id}/candidates/{rid}/edits/{eid}`), extended with bulk **"Accept all"** / **"Reject all"** support.

#### Cross-Session Update ("Update available")
Clicking **Update** on a saved projection starts a fresh session and runs a single anchored update pass:
1. Inputs: `(previous saved snapshot output + standing editorial brief [current lens] + resolved sources with newly arrived fragments / updated upstream snapshots clearly marked)`.
2. Single LLM call (`RoleSnapshot` or `RoleRefinement`, respecting `generate_with_model`) instructed to integrate the new material while preserving untouched sections verbatim — or report that no changes are needed.
3. Outcome:
   - **Changes produced:** Run `DiffAndMarkBlocks(previousOutput, updatedOutput)` → create the session's `pending_review` draft with inline accept/reject hunks (or flag for full-body replacement confirmation if above threshold) and attach an opening assistant summary of what changed.
   - **Zero changes needed:** Create the session's `pending_review` draft with `output_draft = previousOutput`, `edits = []`, and an opening assistant message explaining why the new sources did not warrant edits.
4. Eliminates the 3-turn `from-scratch → delta → merge` (`minimizeAgainstPrevious`) pipeline and eliminates `settleApprovedInPlace` / `WithSettleUnchanged`.

#### Save & Async Lens Distillation (Living Editorial Brief)
When the user clicks **Save** (requiring zero unresolved `<<<edit:>>>` markers):
1. **Synchronous transaction (instant UX):**
   - Promote the draft snapshot to `approved` (`output = trimmed output_draft`, `approval_sequence_number = max + 1`, `approved_at = now`), discard any stray pending candidates.
   - Update `projection.current_context_spec` to the session's final context spec and set `projection.status = active`.
   - Close the session and return `200 { snapshotId }` immediately.
2. **Asynchronous background distillation (tracked by server runner):**
   - Immediately after Save commits, spawn a tracked background job (awaited on graceful server shutdown) that compiles/updates the projection's **living editorial brief** — a clean, data-agnostic standing prompt describing the document's purpose, intended structure, tone, inclusion/exclusion rules, and standing preferences.
   - Inputs: `(previous lens prompt if any + final saved snapshot + session transcript + manual/accepted edits)`.
   - Writes a new `lens` row (`parent_lens_id = previousLensID`, `created_from_projection_refinement_id = refinementId`) and updates `projection.current_lens_id` — **guarded by optimistic check**: if `projection.current_lens_id` already changed (e.g. the user manually edited the lens in the drawer while distillation was running), do not overwrite the newer manual edit.
   - If the user opens the lens drawer or clicks **Update / Fork** while distillation is still running, the UI/server either shows a brief *"Updating brief…"* state or awaits the in-flight distillation (falling back gracefully to the previous lens on failure).
   - **Direct lens editing:** `GET /api/projections/{id}/lens` and `PUT /api/projections/{id}/lens` allow inspecting and directly updating the brief (appending a new `lens` row and re-pointing `current_lens_id`).

#### Mid-Session Context Picker Notification
- When the human adds or removes sources in the context picker during an open projection session, the client posts the updated `context_spec` immediately (with a context-changed signal) so the assistant receives the newly resolved delta and replies conversationally asking whether to update the draft now.

---

### 4.2 Reflection Architecture (Standing Lens Authoring + Isolated Preview + Auto-Approved Windows)

#### Conversational Lens Authoring (1-Step, Isolated Preview, Preview-Aware Chat)
Reflections are the exact dual of Projections: the chat refines the **standing lens**, and every preview is generated strictly from that lens in isolation.
- **Tools offered to the Reflection assistant:**
  - **`set_lens { prompt }`** — Writes/updates the standing lens prompt directly in **1 step** (no `CompileLens` second LLM call, no `LensCountPin` linter).
  - **`update_context { ...changes, reason }`** — Proposes context changes (fragments/colours only) with confirmation card.
  - **`suggest_name { name }`** — Offered while unnamed.
  - *(No `refine_candidate`, no `write_draft`, no `propose_edit`, no `regenerate_from_lens`.)*
- **Isolated sample-window preview (WYSIWYG guarantee):**
  - Whenever `set_lens` is called (or the user switches sample windows in the UI), the server runs a completely standalone `ApplyPrompt(lens.prompt, sampleWindowFragments, start, end)` call — **zero chat history**, identical to scheduled cron execution.
  - If the sample window has 0 matching fragments, render the hardcoded empty message rather than calling the LLM.
- **Read-only preview visibility on subsequent turns:**
  - On Turn N+1, the reflection chat assistant receives the **single latest preview output** (for the active sample window) as a read-only block in its system/context state, explicitly instructed that it cannot edit the preview text directly and can only change output by revising the lens.
- **Direct lens editing:**
  - `GET /api/reflections/{id}/lens` and `PUT /api/reflections/{id}/lens` allow reading and directly saving a revised standing lens prompt (appending a new `lens` row and updating `current_lens_id`) without entering a chat session.

#### Window Enumeration, Bounded/Paused Schedules, & Empty Windows
- **Schedule rules (`WindowSpec` inside `window_spec_versions` JSON):**
  - Every reflection requires a valid window `period` (unscheduled/windowless reflections are rejected/dropped).
  - Evaluate `endTime` (already present in `api.WindowSpec`): stop enumerating grid windows whose `end > endTime` (supports bounded historical archive reflections).
  - Support `paused: bool` in `WindowSpec` (JSON field, `omitempty`): when paused, `POST /api/reflections/generate-pending` skips new forward windows while preserving existing history and manual regeneration/backfill.
- **Empty windows (0 matching fragments):**
  - Before invoking the LLM for a window, resolve fragments in `[window_start, window_end)`.
  - If 0 fragments match, **skip the LLM call** and immediately store an `approved` `reflection_snapshot` with hardcoded output (e.g. `"No fragments in this window."`), `resolved_context = empty`, `lens_id = current_lens_id`, and sentinel `generated_by_model = "empty"`.
  - **Auto-upgrade on backdated fragments:** When evaluating pending/due windows (in `PendingWindows` and `POST /api/reflections/generate-pending`), if a window's latest approved snapshot is an empty placeholder (`generated_by_model == "empty"`) **and** matching fragments now exist in that window, treat the window as eligible for automatic generation (which appends a new real LLM-generated `approved` snapshot at `approval_sequence_number + 1`).
- **Auto-approved generation (no candidate machinery):**
  - Drop `pending_review`, `preview: true`, `output_draft`, `edits`, and `minimizeAgainstPrevious` from Reflections completely. Every generated reflection snapshot goes `generating` (claim lock) → `approved`.

#### Direct Snapshot Editing (Per-Window Revision History)
- Add a direct edit endpoint (e.g. `POST /api/reflections/{id}/windows/{windowId}/edit` accepting `{ output }`):
  - Loads the live reflection and latest approved snapshot for that window.
  - Appends a new `approved` `reflection_snapshot` row for `(window_start, window_end)` with:
    - `approval_sequence_number = max + 1`
    - `output = trimmed new output`
    - `lens_id`, `context_spec`, and `resolved_context` copied from the prior approved snapshot (so editing text does not falsely trigger `lensOutdated` or `staleWindows`)
    - `generated_by_model = "manual"`
    - `approved_at = now`, `generated_at = now`
  - Expose per-window revision history in the UI so users can view past versions (generated or manual) for any window.

---

### 4.3 Backend Modularity & Zero-Migration Schema Strategy

#### Clean Backend Decoupling (`kalaidoscope/internal/`)
- Stop forcing Projections and Reflections through one shared `refinement.StreamTurn` and one shared `engine.Strategy` lifecycle.
- Keep genuinely shared low-level primitives shared:
  - `internal/llmcontext` (context resolution, window clauses, hydration, `PinnedIDs`)
  - `internal/llm` & `internal/usage` / `internal/queue` (model role resolution, queue priority, quota, streaming)
  - `internal/chat` (SSE streaming, message persistence)
  - `internal/engine` (trimmed to shared claim locking `ClaimGeneration` / `SweepGenerationClaims`, `LiveFilter`, lens read/write helpers, context-spec scrubbing on delete)
- Give **Projections** (`internal/projections/`) and **Reflections** (`internal/reflections/`) their own focused session handlers, tool definitions, prompts, and snapshot writers.

#### Schema Strategy: Zero Breaking Migrations Now, Clean Consolidation Later
To validate the new product behavior quickly before committing to a destructive migration:
- **Phase 1 (this implementation — zero `canonical.go` migrations):**
  - Reuse the existing `lens` table via dedicated `GET/PUT /api/{projections,reflections}/{id}/lens` endpoints (preserving `lens_id` provenance and `lensOutdated`).
  - Store `endTime` and `paused` inside the existing `window_spec_versions` JSON (`api.WindowSpec`).
  - Distinguish reflection snapshot origin using clean sentinels in `reflection_snapshot.generated_by_model`:
    - Real LLM model ID → LLM-generated snapshot
    - `"empty"` → hardcoded empty-window placeholder (eligible for auto-upgrade if backdated fragments arrive)
    - `"manual"` → human-edited revision
    *(Ensure freshness/currency checks and UI metadata labels treat `"empty"` and `"manual"` sentinels cleanly rather than as LLM model names.)*
  - Leave unused columns (`generation_trigger`, reflection `output_draft`/`edits`) inert.
- **Phase 2 (deferred schema cleanup — after product validation):**
  - Canonical schema version bump to:
    - Add a dedicated `origin` (`generated` | `manual` | `empty`) field on `reflection_snapshot` (migrating sentinels out of `generated_by_model`).
    - Drop dead columns (`generation_trigger`, reflection `output_draft` / `output_raw` / `edits`, `pending_review` status on `reflection_snapshot`, `reflection_refinement.reflection_snapshot_id`).
    - Re-evaluate whether `lens` stays a separate table or inlines cleanly onto entities/snapshots, and whether `KALAIDO_HAND_EDIT_CREATE_FRAGMENT` is still needed.

---

## 5. Summary of What Gets Removed vs. Added

### Removed
- Blind projection refinement writer + mid-session `CompileLens` + `LensCountPin` linter + mid-session preview lens rows.
- 3-turn `minimizeAgainstPrevious` pipeline and `settleApprovedInPlace` / `WithSettleUnchanged` (`foldIn`).
- Blocking "outdated candidate" freeze gate, `CarryOpenRefinementToCandidate`, and `candidate_engaged` / `discardEngaged`.
- Reflection `pending_review` / `preview` mode, `output_draft`/`edits` usage on reflections, `refine_candidate` offered on reflections, and unscheduled/windowless reflections.

### Added / Changed
- **Projections:** Canvas-aware direct-editing session (`write_draft`, `propose_edit`, anchored `update_draft` with full-body confirmation threshold, `update_context` confirmation, picker-change AI notification), "Accept all" / "Reject all" diff shortcuts, 1-call anchored cross-session **Update** (always opens session, even on no-op with explanation), async Save-time **living editorial brief** distillation with optimistic concurrency guard, secondary lens view/edit drawer (`GET/PUT .../lens`).
- **Reflections:** 1-step `set_lens` authoring with strictly isolated sample-window preview + read-only preview visibility on subsequent chat turns, direct lens editor (`GET/PUT .../lens`), bounded/paused schedules (`endTime` + `paused`), hardcoded empty-window snapshots (auto-upgraded on backdated fragments), direct per-window snapshot text editing appending new revisions with full per-window history.
