---
title: "One-click reconcile"
status: "specified"
author: "human"
created: "2026-08-13"
updated: "2026-08-17"
---

## Summary

One click from the dashboard starts bringing the whole workspace up to date.
What follows scales with how much actually changed: in the best case nothing —
the workspace settles to "Up to date" on its own — and otherwise a guided
flow that walks the user through only the decisions that need a human, one at
a time, with a holding page whenever the next decision isn't ready yet.

One click to *start* is the invariant. One click *total* is the ideal every
piece of this design serves.

## The experience

Today, updating a workspace means clicking into each stale item, waiting
10–30 seconds for generation, approving, and repeating down the dependency
chain — mostly rubber-stamping candidates that barely changed. The target:

1. The user clicks **Reconcile** (a.k.a. "Generate all") on the dashboard.
2. The system works through everything that's out of date, in dependency
   order, in the background: reflections publish themselves, projections
   generate candidates, and candidates with immaterial changes are approved
   automatically (opt-in).
3. The user is guided through the remainder: the flow presents the next
   candidate needing review, they approve (or refine) and advance, and when
   nothing is ready yet they see a holding page with live progress instead of
   a spinner — until the dashboard says "Up to date".

Foundations already in place, which this spec assumes: approval is instant
(lens distillation runs in the background), all generation flows through the
prioritized LLM queue (background work yields to interactive work; live
throughput is visible), the staleness evaluator computes the stale set in
dependency order, and the dashboard already surfaces what needs action.

## Requirements

### 1. Starting a run
- One action on the dashboard starts a reconcile run; no further input is
  required for the run to make all the progress it can.
- The run drains the stale set in dependency order as a background process:
  it reads what is out of date and triggers generation — it never approves
  anything itself; approval belongs to the approval policy (below). Nothing
  self-starts outside a run; termination follows from the dependency graph
  being acyclic and staleness clearing (no hop counts or run caps).
- Work an upstream approval unblocks is picked up by the same run without
  user involvement.
- A single-item refresh stays single-item: it never cascades into a run, and
  its candidate is always presented for review regardless of diff size.

### 2. What happens without the user
- **Reflections** default to automatic approval: generated updates publish
  live with no review gate, immediately unblocking downstream work. Each
  update is recorded in a per-window history with a diff against the previous
  version — no gate, full auditability. (Manual-approval reflections are a
  legal configuration the flow must handle like projections.)
- **Small-diff auto-approval** is a conditional approval policy layered on
  manual approval, opt-in per workspace:
  - Settings: an enable toggle (default off) and a diff threshold percentage
    (default 5% when first enabled).
  - A candidate whose diff against the live snapshot is at or below the
    threshold is approved server-side during a run, before the user ever sees
    it, and unblocks downstream work immediately.
  - A projection with no prior live snapshot is never auto-approved.
  - Auto-approval applies only during reconcile runs, never to single-item
    refreshes.
- **Stale candidates never reach review**: if an upstream dependency is
  re-approved with new content while a candidate is pending, a fresh
  candidate replaces it (the superseded one is retired to the execution log,
  not deleted). The user never reviews against stale inputs.

### 3. The guided flow
- After each approval, the flow advances directly to the next candidate that
  is ready for review, in dependency order, with zero intermediate wait.
- When no candidate is ready, the user lands on a **holding page** — not a
  spinner on the page they just finished: an ordered view of the run showing
  what's generating now (with live activity), what's queued, what's blocked
  on what, and what's ready. It auto-advances into the next candidate when
  one becomes ready, and lets the user click into any ready item out of
  order.
- The holding page is reached from the run itself and from the dashboard
  (e.g. an "N awaiting review" link); it is not a persistent nav destination.
  The dashboard remains the single entry point.
- Review shows the candidate's diff percentage ("differs by 4%") so users can
  calibrate the auto-approve threshold against real examples.

### 4. Run control and visibility
- The run's progress is visible while it works: items updated, items
  remaining, what's currently generating.
- A **soft stop** lets the in-flight generation finish but starts nothing
  further.
- A run that ends early — quota exhausted, provider failure, stopped — leaves
  a persistent, resumable state: "stopped early — quota exhausted
  (7 of 12 updated)" with a resume action that picks up where it left off. No
  transient toasts.

### 5. Trust and recovery
- Auto-approved snapshots are flagged as such in the entity's timeline, with
  the recorded diff ratio; the dashboard summarizes recent auto-approvals
  with links.
- Any snapshot in a timeline can be made live again via **revert** —
  implemented as publishing a new approved snapshot carrying the old content
  (history is append-only; the revert itself is an honest timeline event).
  Downstream items simply show as out of date. An auto-approve mistake is one
  click to undo.
- Background failures (e.g. a lens distillation that can't complete) never
  interrupt the flow; the previous artifact keeps working and the failure is
  visible on the entity's detail page.

## Acceptance Criteria
- [ ] One dashboard action starts a background run that updates every unblocked out-of-date item in dependency order, with no further input required for automatic progress.
- [ ] Reflections publish automatically during a run and keep a per-window history with diffs.
- [ ] With auto-approval enabled, candidates at or below the threshold are approved server-side during runs and immediately unblock downstream work; candidates above it wait for review.
- [ ] After an approval, the user is taken straight to the next ready candidate; when none is ready, to a holding page with live run progress that auto-advances and allows free pick.
- [ ] A pending candidate invalidated by an upstream change is replaced by a fresh one before review; the superseded candidate is retained in the execution log.
- [ ] A run can be soft-stopped, and an early-ended run shows a persistent resumable state with the reason and progress count.
- [ ] Auto-approved snapshots are identifiable in timelines and the dashboard summary, and any timeline snapshot can be reverted to via re-publish.
- [ ] Single-item refreshes never cascade and never auto-approve.
