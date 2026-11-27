# Stage 2 (Reflections) — Product & UI Issues Log

> **Purpose:** Hands-on product & UX issues discovered while testing Stage 2 ([projections-and-reflections-prs.md](./projections-and-reflections-prs.md)). Captures observed problems and desired user-facing behavior first; technical fixes will be planned after review.

---

## Issue 1 — Remove `WindowDivider` From Reflection Lens Chat

**Surface:** Reflection tuning / lens chat (`ChatMessages` / `WindowDivider`)

### Observed Problem
- Switching sample preview windows injects `WindowDivider` rows into the reflection chat transcript, cluttering the conversation with period markers that don't belong there.

### Desired Product Behavior
- The reflection chat is strictly about refining a **period-agnostic standing lens**.
- **Never render `WindowDivider` rows** in the reflection lens chat transcript.
- Which period is currently being previewed belongs exclusively on the **Preview pane** (via its sample window selector / header), not inside the chat history.

---

## Issue 2 — Decouple Lens & Schedule Into a 2-Tab Staged Tuning Workspace Beside One Shared Preview Pane

**Surface:** Reflection creation & editing (`ReflectionRefineScreen`, `ReflectionSeriesPanel`, `RefineConfigPanel`, `LivePreviewPane`)

### Core Product Insight
- A Reflection's output is a 3-way balance of **`Sources × Window Size (Schedule) × Standing Lens`**. Changing cadence (e.g. weekly → monthly) or sources can turn a good lens into a wall of text, so users need to see the same **Preview pane** while flicking between adjusting the schedule/sources and adjusting the lens — without all controls mashed together simultaneously or mutating the live Reflection prematurely.

### Observed Problems
- Schedule controls, sources, lens editor, chat, and preview all fight for space at once, making schedule changes feel entangled with the lens chat.
- Schedule edits currently auto-save immediately on click while lens/sources require clicking Save/Done, so experimenting with cadence/dates mutates the live Reflection before you've previewed or committed.
- Changing cadence/dates/sample windows automatically fires LLM calls even while rapidly adjusting settings.
- The entry button on an established Reflection is labeled **"Refine"**, which is overloaded and unclear.

### Desired Product Behavior
1. **2 tabs beside one persistent Preview pane:**
   - **Tab 1 — Lens:** AI chat to refine the standing lens (no window dividers) + direct standing lens text editing.
   - **Tab 2 — Schedule & Sources:** Cadence, start date, optional end date, pause toggle, and context/sources picker.
   - **Persistent Preview pane** (always visible beside both tabs): owns the **sample window selector** derived from the staged schedule.
2. **Everything staged until Save:**
   - Changes to **Schedule**, **Sources**, and **Standing Lens** are all staged together in the tuning workspace and only persisted when the user clicks **Save** (creating/updating the Reflection atomically).
   - Clicking **Cancel / Discard** on an established Reflection leaves its live schedule, sources, and lens completely untouched.
3. **Manual Preview button when schedule/sources/sample window changes:**
   - When the user changes cadence, dates, sources, or selects a different sample window, immediately update the preview header with the new **window date range and matching fragment count** (e.g. *"Oct 1 – Oct 31 · 47 fragments"*) and show a clear **"Preview"** button (marking the current preview as out of sync with the staged settings) rather than firing an LLM call on every click.
   - Clicking **Preview** generates the isolated preview for that sample window against the staged lens + sources (or immediately displays the empty-window state if 0 fragments match).
   - *(In the Lens chat, when the AI updates the lens via `set_lens`, it still generates/updates the preview for the active sample window as part of that turn.)*
4. **Clearer entry-point label:**
   - Rename the **"Refine"** button on an established Reflection to **"Update"** (or **"Edit / Update"** — using **"Update"** consistently).

---

## Issue 3 — Resumable Draft & Clean Discard Lifecycle for Never-Saved Reflections

**Surface:** Reflections list / `ReflectionSeriesPanel` & Reflection tuning workspace

### Observed Problem
- Creating a Reflection and leaving before clicking Save leaves a half-baked, lensless Reflection in the Reflections list.
- Returning to it only offers a **"Refine"** button that silently starts a brand-new chat from scratch, with no way to resume the unfinished creation session or cleanly discard the unsaved Reflection.

### Desired Product Behavior
1. **Never-saved Reflection (no lens saved yet):**
   - Treat it as a **resumable in-progress draft** (matching Projections): returning to it resumes the existing unfinished creation session (its chat transcript, staged lens, sources, and schedule) rather than starting over.
   - Surface a clear **"Resume"** / **"draft in progress"** state until first Save.
   - Clicking **Discard** deletes the unsaved Reflection completely (or reverts a Discover-originated proposal back to `proposed`) — never leaving a broken lensless Reflection behind.
2. **Established Reflection (already has a saved lens):**
   - Clicking **Update** starts a fresh tuning session seeded from the Reflection's current saved lens, schedule, and sources (no need to resume an abandoned tweak session on an already-saved Reflection; cancelling simply leaves the saved Reflection untouched).
