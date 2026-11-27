# Projections & Reflections — Product Requirements Spec

> **Status:** Draft — initial high-level input captured; design decisions to be resolved interactively before finalizing.

---

## 1. Projections

### Purpose & Mental Model
- A **projection** is a synthesis over a subset of fragments in a workspace, producing a **saved, persistent artifact** (a snapshot).
- Unlike **Explore** (open-ended conversation), a projection session is explicitly **goal-directed**: its system prompt should guide the user toward converging on and saving a concrete artifact.
- **Sessions are ephemeral; the artifact is what persists.**
  - Projections are **not** "forever sessions" where updates resume the same growing chat history.
  - *Product reason:* The durable output is the artifact, not the chat transcript.
  - *Technical reason:* An unbounded conversation eventually fills the context window and cannot continue.

### In-Session Authoring & Editing
- **Block-level feedback controls stay:** Retain the **Edit** (direct manual edit) and **Refine** (targeted AI feedback) actions on individual blocks of text in the UI.
- **Mid-session context changes stay:** Users can add or remove sources (edit the context spec) midway through creating or updating a projection as they realize they need more or less material.
- **Saving finishes the session:** At the end of a session, the snapshot is saved as the current persisted artifact.

### Post-Save Freshness & Updates
- Once saved, the UI indicates when **new fragments** have become available within the projection's context spec.
- The UI offers an explicit **Update** action to refresh the projection with the new data.
- Updating generates a new draft/version incorporating the new data and **drops the user into a fresh interactive session** (rather than silently replacing the artifact or resuming the old chat transcript).

### Carry-Forward Mechanism (Lenses)
- Because authoring/update sessions are ephemeral, a compact carry-forward representation (**lens**) is still needed — captured at least when a session finishes (if not before) — so future updates preserve the user's intent without carrying the old chat history.

---

## 2. Reflections

### Purpose & Mental Model
- A **reflection** is a summary of a subset of the workspace scope on a **recurring schedule** (time windows).
  - *Examples:* "What themes came up in my notes to self this week?", "What work got done this week?", "What new problems arose this week?"
- **Automatic generation & default approval:** Reflection instances are generated automatically on their schedule and become approved automatically by default (no mandatory candidate-review gate).
- **Direct text edits on instances, not exploratory refinement:** Users should be able to edit the text of a specific reflection snapshot if something is wrong, but this is straightforward direct text editing — not the exploratory AI refinement workflow used for projections.
- **Standing lens required:** Because each scheduled window is generated independently from its window's data, reflections **do** require a lens that can be applied directly to just that window's context to produce the output.

---

## 3. Core Distinction: Projections vs. Reflections

- **Projections evolve incrementally:** Successive snapshots of a projection are incremental updates of the same living artifact as new information arrives — always anchored in the previous snapshot and refined interactively.
- **Reflections are independent per window:** Because reflections run over recurring time windows, each snapshot is potentially and intentionally unrelated to the snapshots before or after it — generated fresh by applying a standing lens to that window's context.

---

## 4. Open Design Questions (To Resolve)

1. **Lens model across the two:**
   - **Projections:** Since every update has the previous snapshot and drops the user into an interactive session, should a projection's lens be a **distilled direction summary** (captured/updated on save) rather than a strict from-scratch standalone prompt? Can the in-session assistant see and edit the artifact directly?
   - **Reflections:** Needs a standalone instruction that runs unattended on a window's context — how is that instruction authored, previewed, and revised (direct editable prompt, AI-assisted authoring, or both)?
2. **Projection in-session mechanics & review flow:** Direct edits vs proposed diffs/hunks (`<<<edit>>>`), mid-session regeneration, what happens on save vs discard, and how the update flow initializes a fresh session.
3. **Reflection instance lifecycle:** Editing an approved reflection snapshot (in-place vs new revision, preserving manual edits if regenerated?), stale/backdated fragments, lens changes (`lensOutdated`), backfill, and schedule changes.
4. **Context & dependencies:** Handling context spec changes across sessions, upstream projection/reflection references (e.g. fragments-only for reflections?), and freshness indicators.
5. **Entry points & lifecycle:** Creating from scratch, promoting from Explore, Discover proposals (`proposed` state), version history, deletion.
