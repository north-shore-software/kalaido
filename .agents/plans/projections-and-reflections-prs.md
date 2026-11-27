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

*(Pending high-level input.)*

---

## 3. Open Design Questions (To Resolve)

1. **What is a lens for projections?**
   - **Option A — Standalone standing prompt:** A self-contained instruction capable of recreating the artifact from scratch given only the resolved context.
   - **Option B — Distilled direction summary:** A compact summary of the editorial directions/preferences given across prior sessions. On update, the model receives **(previous snapshot + what changed in context + prior direction summary)** to generate the updated draft, then drops the user into the interactive session.
   - *Related:* Is the lens captured/updated at session finish (save) rather than compiled blindly mid-session? Can the in-session assistant see the artifact directly?
2. **Reflections model:** How reflections differ from projections (scheduled time windows, no prior snapshot for a brand-new window, automatic/cron generation vs interactive updates, lens contract).
3. **In-session mechanics & review flow:** Direct edits vs proposed diffs/hunks, regeneration behavior, and what happens on save/discard.
4. **Context & dependencies:** Handling context spec changes across sessions, upstream projection/reflection references (if any), and freshness indicators.
5. **Entry points & lifecycle:** Creating from scratch, promoting from Explore, Discover proposals (`proposed` state), version history, deletion.
