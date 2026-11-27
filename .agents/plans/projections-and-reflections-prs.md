# Projections & Reflections — Product Requirements & Design Spec

> **Status:** Product requirements settled; architecture & implementation design in progress.

---

## 1. Core Concept: Projections vs. Reflections

| Dimension | Projection | Reflection |
|---|---|---|
| **Purpose** | Goal-directed synthesis over a subset of the workspace producing one living, persistent artifact | Summary of a subset of the workspace over recurring or bounded time windows |
| **Snapshot relationship** | **Incremental evolution** — successive snapshots update the same artifact as new information arrives | **Independent per window** — each window's snapshot is potentially and intentionally unrelated to those before or after it |
| **Generation trigger** | **Manual (pull)** — created, updated, and revised interactively by the user | **Automatic (scheduled / backfill / on-save)** — auto-approved by default |
| **Sources** | Fragments, colours, other projections, and reflections | Fragments and colours only |
| **Editing model** | Unified interactive session (AI chat + block-level `Edit` & `Refine` + inline diffs + context picker) | Direct markdown/text editing on individual window snapshots (creates a new saved revision per window; no exploratory AI refinement) |
| **Lens role** | Compact carry-forward representation of prior editorial direction across ephemeral sessions | Standing instruction applied directly to a window's context to generate each window from scratch |

---

## 2. Projections — Product Requirements

### 2.1 Mental Model & Ephemeral Sessions
- A **projection** is a synthesis over a subset of workspace sources producing a **saved, persistent artifact** (snapshot).
- Unlike **Explore** (open-ended conversation), a projection session is explicitly **goal-directed**: its prompt guides the user toward converging on and saving a concrete artifact.
- **Sessions are ephemeral; the artifact is what persists.**
  - Projections are **not** "forever sessions" — saving or discarding closes the session permanently, and future updates/revisions start a fresh session (both for product clarity and to avoid exhausting context windows).
  - **Resumable in-progress draft:** While a session is active (before clicking Save or Discard), the draft and chat persist as a single resumable in-progress session if the user navigates away or closes the app.

### 2.2 Unified Interactive Session (Create, Update, Revise)
Every way of producing or changing a projection's content goes through the **same unified interactive session** (document canvas + chat + context picker):
- **Create:** Start from scratch, graduate from an Explore chat, fork an existing projection, or accept a Discover proposal (`proposed` → `active` on first Save).
- **Update (new data available):** Clicking **Update** on a saved projection immediately drafts an updated version incorporating the new data and opens the interactive session with inline block-level diffs (accept/reject) alongside the chat.
- **Revise (already up to date):** Clicking **Edit / Revise** on an up-to-date saved projection opens the same interactive session (no separate quick-edit mode outside a session).

### 2.3 In-Session Editing, Diffs, & Save Rules
- **Block-level controls retained:** Individual blocks in the draft canvas expose **Edit** (direct manual edit, applied immediately) and **Refine** (targeted AI feedback on that passage).
- **Inline diffs by default once a draft exists:**
  - The initial first draft during creation renders as clean text.
  - Once a draft exists, any AI modification — whether from **Update**, targeted **Refine**, or a chat-requested revision — appears as **inline accept/reject diff hunks** so the user sees exactly what changed.
  - **Full-body replacement with confirmation:** If a chat-requested rewrite would replace essentially the entire document (above a size/proportion threshold), the AI can offer a full-body replacement, but **only after confirming with the user** that they want to replace the whole body.
- **Resolving diffs before Save:**
  - All proposed diffs must be resolved (accepted or rejected) before **Save** is enabled.
  - Provide **"Accept all"** and **"Reject all"** shortcuts alongside per-hunk accept/reject (and undo).
- **Save / Discard:**
  - **Save** commits the clean draft text as the new current saved snapshot, updates the saved context spec and lens, and closes the session.
  - **Discard** abandons the in-progress draft and closes the session (leaving the previous saved snapshot untouched, or deleting/reverting an unsaved brand-new projection).

### 2.4 Mid-Session Context Changes & Arriving Data
- **Human edits context via picker:** Users can add/remove sources at any time during a session. Changing context in the picker immediately notifies the AI ("context has changed") so the AI responds conversationally (e.g. confirming what changed and asking whether the user wants to update the draft now).
- **AI suggests context changes:** The AI can suggest adding/removing sources via a tool call; accepted/applied changes are reflected directly in the context picker.
- **New fragments arriving mid-session (non-blocking):**
  - Never freeze or block an open draft session when new matching fragments arrive (no blocking "outdated candidate" gate or forced fold-in flow).
  - Optionally show a subtle non-blocking notice (or an "Incorporate new fragments" action); after Save, any still-unseen fragments surface naturally through normal freshness.

### 2.5 Freshness, History, Lens Visibility, & Lifecycle
- **Freshness ("Update available"):** Shown on a saved projection when **new matching fragments** enter its context spec OR when a **referenced upstream projection or reflection** has a newer saved snapshot (one-way additions; deletions/removals do not trigger staleness).
- **Lens visibility:** Kept **behind the scenes by default** so normal users don't have to manage prompts, but **inspectable and directly editable** in a secondary view/drawer if the user wants to review or correct drift.
- **Entry points & lifecycle:** Keep all existing flows:
  - Create from scratch, graduate from Explore, fork an existing projection, accept Discover proposals (`proposed` → `active` on first Save).
  - Read-only version history of past saved snapshots.
  - Rename, per-entity model override, pin, soft-delete, and restore.

---

## 3. Reflections — Product Requirements

### 3.1 Mental Model & Windowing
- A **reflection** is a summary of a subset of workspace fragments (fragments and colours only — never other projections or reflections) across **time windows**.
  - *Examples:* "What themes came up in my notes to self this week?", "What work got done this week?", "What new problems arose this week?"
- **Every reflection is windowed; ongoing scheduling is optional:**
  - Every reflection defines a window cadence/bounds (e.g. daily, weekly, monthly, quarterly, or custom period/duration).
  - Ongoing forward scheduling can be **active** or **paused/ended** (e.g. an optional end date or schedule toggle), supporting **purely historical / archival reflections** that summarize a bounded past range without continuing indefinitely into the future.
  - Unscheduled windowless reflections are dropped (unscheduled synthesis is a Projection).

### 3.2 Standing Lens Authoring & Editing
- Reflections require a **standing lens** capable of generating a window's output from scratch using only that window's resolved fragments.
- **Dual authoring & editing UX:**
  - **Conversational authoring with live sample-window preview** (switchable across windows in the reflection's series) for creating and iterating on what the reflection produces.
  - **Direct viewing and editing of the standing lens text** anytime, without forcing a chat turn.

### 3.3 Automatic Generation, Empty Windows, & Backfill
- **Auto-approved by default:** Every generated reflection snapshot is approved on arrival (no `pending_review` / candidate-triage state on reflections).
- **Triggers for pending windows:**
  - Saving/activating a reflection (including bounded historical reflections) immediately kicks off generation for pending windows in its range.
  - Manual **Backfill** materializes earlier phase-aligned windows and starts generating them immediately.
  - Ongoing **scheduled generation** (cron / `POST /api/reflections/generate-pending`) generates newly-due pending windows for reflections whose schedule is active.
- **Empty windows (0 matching fragments):**
  - Do **not** call the LLM. Record a **hardcoded empty snapshot** (e.g. "No fragments in this window") so the timeline has an explicit entry without wasting tokens.
  - If backdated fragments later arrive in a window that only has a hardcoded empty snapshot, automatic scheduled generation (or manual generation) can replace it with a real LLM-generated snapshot.

### 3.4 Direct Snapshot Editing & Per-Window History
- Users can **directly edit the text** of any specific reflection window's snapshot to fix errors or tweak wording (plain markdown/text editing — not exploratory AI refinement).
- **Non-destructive per-window history:** Saving a manual edit appends a **new saved revision** for that window (full per-window revision history). Because prior revisions are preserved in history, manual edits never block or require special locks against future manual regeneration.

### 3.5 Drift, Schedule Changes, & Lifecycle
- **Never silently overwrite existing generated windows:**
  - When the reflection's **lens or context changes**, past windows stay as-is and are flagged (e.g. "Older lens" / outdated config); future windows use the new lens/context. Users can manually regenerate a single window or bulk-regenerate affected windows.
  - When **backdated fragments** arrive for an already-generated (non-empty) window, that window is flagged as having **new fragments** for manual refresh (never silently overwritten by cron).
- **Schedule changes:** Editing a reflection's cadence/schedule applies going forward while keeping previously generated windows in the series.
- **Entry points & lifecycle:** Create from scratch, accept Discover proposals (`proposed` → `active`), rename, per-entity model override, pin, soft-delete, and restore.

---

## 4. Architecture & Implementation Design

*(In progress — to be resolved in the next phase of `/grill-me`.)*
