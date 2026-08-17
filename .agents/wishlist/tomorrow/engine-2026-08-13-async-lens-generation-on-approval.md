---
title: "Asynchronous / Background Lens Generation and Non-Blocking Candidate Approval Flow"
status: "specified"
author: "human"
created: "2026-08-13"
updated: "2026-08-17"
---

## Summary
Decouple candidate approval from synchronous LLM operations so that approving a snapshot returns instantly. Lens distillation runs in the background, and the "Approve & next" review flow immediately advances to the next available candidate or transitions to a holding queue view rather than blocking the UI with a spinner.

## Motivation & Context
1. **Lens Distillation Latency**:
   - Currently, committing a refinement / approving a candidate synchronously triggers `DistillAndUpdateLens` on the backend.
   - On local models (e.g. Ollama) or slow providers, this holds the HTTP connection open for seconds or minutes, freezing the UI.
2. **Review Flow Stalls ("Approve & next")**:
   - When advancing through candidate approvals, if the next candidate is not yet generated, the review UI hangs on a loading spinner on the current projection review page until model generation completes.

## Desired Working End State

### 1. Instant Snapshot Approval with Background Lens Distillation
- **Immediate Approval**:
  - The snapshot record is committed immediately with `status = "approved"`.
  - The approved text becomes the live plan of record immediately, as this is the exact content approved by the user.
  - The HTTP request returns success immediately without waiting for LLM distillation.
- **Asynchronous Distillation**:
  - Lens distillation (`DistillAndUpdateLens`) is enqueued and executed in a background worker / goroutine.
  - The lens prompt is only needed for *future* snapshot regenerations, so the active snapshot is fully valid while distillation is in flight.
  - Upon background completion, the new lens record is saved, and `current_lens_id` on the parent entity and `lens_id` on the snapshot are updated.

### 2. Non-Blocking "Approve & Next" Review Workflow
- **Immediate Advance to Ready Candidates**:
  - When the user clicks "Approve & next", the current candidate is committed immediately.
  - If another entity in the graph already has a generated pending candidate ready for review, the UI navigates straight to that review page without delay.
- **Holding / Queue View when Frontier is Generating**:
  - If no other candidate is currently ready for review (e.g. downstream or frontier nodes are still being generated in the background):
    - The UI does not remain stuck on the approved projection's review page with a blocking spinner.
    - Instead, the UI navigates to a holding / queue view that surfaces the graph drainage progress and indicates which items are currently being generated.

## Undecided / Open Design Decisions
- **Distillation Failure Handling**: Specific UX when background distillation fails (e.g. subtle toast notification, inline warning banner on projection details, or automatic background retry).
- **Distillation In-Progress Indicator**: Whether a subtle badge (e.g. "Distilling lens in background…") should appear on the projection detail page while distillation is running.
- **Holding View Surface**: Exact surface for the drainage holding view (reimagining the currently unused `/rotation` route vs. a dedicated review-queue holding screen).

## Acceptance Criteria
- [ ] Approving a projection refinement or new projection returns HTTP success immediately without waiting for LLM lens distillation.
- [ ] Approved snapshot text is immediately visible and marked as the live snapshot (plan of record).
- [ ] Lens distillation runs asynchronously in the background and attaches the resulting `lens_id` once finished.
- [ ] In "Approve & next", if another pending candidate exists, the user is navigated directly to it with zero intermediate wait.
- [ ] In "Approve & next", if no candidates are ready yet, the user is transitioned to a holding/queue view showing in-flight generation status rather than hanging on the review page.
