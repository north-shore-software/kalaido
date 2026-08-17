---
title: "Chained snapshot generation and small-diff auto-approval cascade"
status: "specified"
author: "human"
created: "2026-08-15"
updated: "2026-08-17"
supersedes:
  - ".agents/wishlist/tomorrow/2026-08-15-chained-snapshot-generation.md"
  - ".agents/wishlist/tomorrow/2026-08-15-auto-approve-projections-small-diff.md"
---

## Summary
Provide users with a 1-to-2 button automated workflow to regenerate and bring all out-of-date items (projections and reflections) up to date across their entire workspace. By combining background chained generation with automated small-diff approvals, users can update their entire scope without manually generating and reviewing every intermediate change.

## User Experience & Purpose
- **Goal**: Bring the entire workspace up to date in one or two actions instead of manually stepping through each entity.
- **Problem Today**: Updating a graph of dependent reflections and projections requires clicking into each item, waiting 10-30 seconds for LLM generation, clicking approve, and repeating down the entire chain. Most candidates barely changed, turning the process into tedious rubber-stamping.
- **Target Flow**:
  1. The user clicks **"Generate all"** (or "Update workspace") from the dashboard.
  2. The system automatically processes the graph in topological order:
     - Reflections automatically generate and publish live updates (no review gate needed).
     - Projections generate candidate snapshots.
     - Projections with diffs below the auto-approve threshold are approved automatically in the background, immediately unblocking downstream items.
  3. The user only ever has to manually review the few projections where material changes occurred, or simply watch the entire workspace settle to "Up to date".

## Desired Working End State

### 1. The Chain Propagation Mechanism
- **Chain Mark on Records**:
  - The snapshot record carries a chain mark with a remaining-hops count.
  - "Generate all" generates the first candidate marked with the initial hop count.
  - A server-side hook on snapshot write (create/update) inspects the mark:
    - **Marked** → Re-evaluates topological status (`internal/status`), finds the next unblocked actionable entity, and triggers generation carrying the decremented mark.
    - **Unmarked** → Normal standalone generation; does not propagate.
- **Approval Cascades**:
  - Approving a projection mutates the candidate snapshot (`status = "approved"`). Because the record retains the chain mark, the update hook fires, detects unblocked downstream nodes, and generates them.
  - **Reflections in Chain**: Reflections have no review gate; when generated during a chain, they publish live snapshots directly, immediately unblocking downstream projections.
  - **Refinements**: When a user refines a chain-marked candidate and commits, the chain mark propagates to the new snapshot so the downstream cascade continues.
- **Single-Item Manual Triggers**:
  - Single-item actions (detail page "Refresh", dashboard row refresh) write unmarked records and never propagate cascades.

### 2. Auto-Approval of Small Diffs
- **Diff Metric (Line-based)**:
  - Compares candidate output content against the live approved snapshot's content (`parseProjectionOutput(output).content`).
  - Metric:
    ```
    ratio = (added lines + removed lines) / max(lines in live, lines in candidate)
    ```
  - If `ratio <= threshold` (and `auto_approve_enabled` is true), the server auto-approves the snapshot immediately upon generation before any client sees it.
  - A projection with no prior live snapshot is never auto-approved.
- **Composition with Chain**:
  - Auto-approving mutates the snapshot record carrying the chain mark, immediately triggering the chain hook to advance the next layer of the graph without human interaction.
- **Diff Surface in UI**:
  - Review UI surfaces the calculated diff percentage (e.g. "differs by 4%") so users can calibrate their threshold settings.

### 3. Workspace Settings
Stored on `kalaidoscope_config`:
- `auto_approve_enabled` (boolean, default: `false` — opt-in).
- `auto_approve_threshold` (percentage integer 0–100; `0` allows auto-approving byte-identical outputs).

### 4. Audit Trail & Visibility
- **Snapshot Audit**: Snapshots approved automatically record an `auto_approved: true` flag and the recorded diff ratio, displayed in the projection's timeline.
- **Dashboard Summary**: Dashboard displays recent auto-approvals with entity names and diff percentages, with direct links to each snapshot.

### 5. Guards, Concurrency & Cancellation
- **Hop Cap**: Decrementing hop count ceilinged at total workspace entity count prevents infinite loops.
- **In-flight Deduplication & Serial Execution**: Generations are strictly serialized (concurrency of 1) and deduplicated per entity.
- **Quota Exhaustion**: Model quota exhaustion ends the chain gracefully without error loops.
- **Cancellation (v1)**: No central cancellation handle required for v1; runs sequentially across the unblocked frontier until complete or capped.

## Acceptance Criteria
- [ ] Clicking "Generate all" on the dashboard initiates a background generation run across unblocked entities in topological order.
- [ ] In-chain reflections generate and publish live snapshots automatically, unblocking dependent projections.
- [ ] When `auto_approve_enabled` is true, generated candidate diffs under the threshold are automatically approved on the backend without requiring manual clicks.
- [ ] Auto-approvals immediately trigger the next unblocked downstream generation in the chain.
- [ ] Candidates exceeding the diff threshold remain in the pending state for manual review.
- [ ] Single-entity manual refreshes do not trigger automatic cascades.
- [ ] Auto-approved snapshots are identifiable in the audit timeline and dashboard summary.
