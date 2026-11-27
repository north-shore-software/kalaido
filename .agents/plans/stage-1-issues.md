# Stage 1 (Projections) — Product & UI Issues Log

> **Purpose:** Hands-on product & UX issues discovered while testing Stage 1 ([projections-and-reflections-prs.md](./projections-and-reflections-prs.md)). Captures observed problems and desired user-facing behavior first; technical fixes will be planned after review.

---

## Issue 1 — Projections List Row: Legacy "Candidate" Chip, Misleading "Review Candidate" Icon, & Status/Action Layout

**Surface:** Projections list (`ProjectionRow`)

### Observed Problem
- A `candidate` pill appears next to the projection name when an unapproved draft exists — legacy jargon that isn't clear to users and isn't useful next to the title.
- A circular-arrows icon button (`Review candidate`) appears in the far-right actions column:
  - "Review candidate" no longer fits the mental model.
  - Visually, the icon looks like "Regenerate / Refresh", not "open an existing draft".
  - Status information and related actions are split awkwardly across three different columns (Name, Last generated, and far-right actions).

### Desired Product Behavior
1. **Clean Name column:** Remove the `candidate` pill from beside the projection name.
2. **Unified Status column ("Last generated"):** Consolidate all temporal/revision status in this column:
   - Timestamp of the last saved version (or initial state if never saved).
   - Clear, plain-language indicator when a **draft is in progress** (not "candidate").
   - Count of new fragments in scope since the last saved version (`X new since`).
3. **Direct "Update / Refresh" action from the list:**
   - Replace the old "Review candidate" button with a real **Update / Refresh** action (starts a new snapshot / update session directly from the list, without needing to open the detail screen first).
   - Place it near the freshness/status info (`X new since`) in/beside the status column.
   - Make it available **even when 0 new fragments are in scope** (for any saved projection, not only stale ones).
4. **No specific-revision navigation from the list:** Do not provide a separate button on the list screen to jump into a specific candidate/revision.

### Edge Case (Resolved)
- When a projection **already has a draft in progress**, clicking the list-row **Update / Refresh** action prompts to confirm *"Discard existing draft and start fresh?"* and, on confirm, discards the existing draft and navigates straight into the new update session (consistent with Issue 5).

---

## Issue 2 — "Draft in Progress" Status Must Reflect an Active Session, Not Snapshot Existence

**Surface:** Projections list & detail status (related to Issue 1)

### Observed Problem
- Previously, the `candidate` indicator only appeared once an unapproved snapshot row existed. A projection where the authoring session had already started (e.g. initial chat turns before the first draft text was produced) did not show as having a draft in progress.

### Desired Product Behavior
- The **"draft in progress"** status represents whether an **interactive session has begun** (and has not yet been Saved or Discarded) — **not** whether a draft snapshot has been generated yet.
- As soon as a projection session starts (for creation, update, or revision), the projection immediately shows **"draft in progress"** until the user explicitly **Saves** or **Discards** the session.
- *(Note: Discover `proposed` projections that have not been opened into a session remain `proposed`, not `draft in progress`.)*

---

## Issue 3 — Clicking "Update" Should Navigate Immediately Into the Session Screen

**Surface:** Projection detail freshness card (`ProjectionFreshnessCard`) & Projections list row Update action (Issue 1)

### Observed Problem
- Clicking **Update** blocks on the current screen for several seconds while the LLM runs, giving poor feedback and hiding the fact that you are entering an interactive update session.

### Desired Product Behavior
- Clicking **Update** (from either the Detail side rail or the Projections list row) **navigates immediately** into the interactive session screen.
- While the update is generating:
  - The left-hand canvas displays a **pulsating skeleton / loading state** so it is unmistakably clear the new version is generating.
  - The chat pane displays live progress/streaming status.
- When generation finishes, the canvas transitions to the result (inline diffs, wholesale swap, or unchanged draft — see Issue 4) and the chat displays the AI's summary/explanation.
- If generation fails, stay on the session screen with an inline error and **Retry / Discard** options rather than silently failing or bouncing back unexpectedly.

---

## Issue 4 — "Update" Should Not Pop Up a "Replace Full Draft" Confirmation Card

**Surface:** Projection Update session (`ChatPanel` / `ReviewRefineColumn`)
**Priority:** Low

### Observed Problem
- Clicking **Update** to incorporate new sources triggered the *"replace the full draft?"* confirmation dialog in chat, which felt jarring and redundant when the user had just explicitly asked for an update.

### Desired Product Behavior
- **Never show a full-body replacement confirmation dialog on Update.**
- When an Update finishes:
  - **Incremental changes (below threshold):** Show the previous version with **inline accept/reject diffs** on the canvas plus a chat summary of what changed.
  - **Sweeping changes (above the full-rewrite threshold):** **Swap the draft out wholesale** (clean new draft without an unreadable wall of diffs or a confirmation prompt) and **explicitly state in the chat** that the full draft was replaced (and why / what changed).
  - *(The previous saved snapshot remains untouched until Save, and the user can Discard at any time. Mid-session chat requests can still ask for confirmation before a wholesale rewrite.)*

---

## Issue 5 — Draft vs. Projection Lifecycle: Discarding Never-Saved Projections & Starting Fresh Over an Open Draft

**Surface:** Projection detail freshness card (`ProjectionFreshnessCard`), Draft/Review screen Discard button, & Projections list row

### Product Principle
- Strictly **at most one in-progress draft per projection**. Because sessions are ephemeral and exist only to reach a chronological saved artifact, parallel drafts don't make sense — an abandoned session isn't a historical artifact or a scratchpad to return to later.

### Observed Problems
1. **Never-saved projections leave zombie rows on Discard:** Clicking a never-saved projection in the list correctly opens its in-progress draft directly (there is no saved artifact to view). However, clicking **Discard** only closes/discards the draft and returns to the list, leaving behind an empty, hollow projection with no snapshot and no draft.
2. **Saved projections trap you behind "Resume draft":** On a saved projection with an open draft, `ProjectionFreshnessCard` only offers **Resume draft**. To abandon the draft and start a new one, you have to open the old draft, click Discard, navigate back, and then start a new session.

### Desired Product Behavior
1. **Never-saved projection (no saved snapshot yet):**
   - The draft session *is* the projection.
   - Clicking **Discard** deletes the unsaved projection completely (or, if it originated as a Discover proposal, reverts it cleanly back to `proposed`) — never leaving a hollow active projection behind.
2. **Saved projection with an open draft:**
   - On `ProjectionFreshnessCard`: offer **Resume draft** (primary) alongside a direct **Discard & start fresh** action (with confirmation that the existing in-progress draft will be discarded, then immediately starting a fresh update/revision session — and/or a direct Discard option without having to enter the old draft first).
   - On the Projections list row: clicking **Update / Refresh** on a row with an open draft follows the same confirm-discard-and-start-fresh pattern (see Issue 1).
