---
title: "A regeneration with no semantic change still produces a review candidate the user must approve"
status: "open"
author: "agent"
created: "2026-09-01"
---

## Description
When new data arrives that a projection's lens does not care about, regeneration correctly reports no semantic change and republishes the approved output verbatim. But that verbatim copy is still stored as a **pending** candidate, so the projection shows as needing review, the compare pane renders an all-"same" diff, and the user has to click Approve on a document identical to the one already approved.

The candidate is not pointless server-side: its `resolved_context` is what records that the new fragment was considered, which is what clears the "new fragments" staleness. The problem is that nothing distinguishes "identical to approved, nothing to review" from a real candidate, so the review step is forced on the user for a no-op.

## Steps to Reproduce
1. Commit a projection whose lens filters its sources, e.g. "only the individually named personas".
2. Ingest a fragment the lens would exclude (an unnamed persona).
3. Regenerate the projection.

## Expected Behavior
The projection settles as current without a review step, or at minimum the review UI says the candidate is identical to the approved output and offers a one-click dismiss rather than an approve.

## Observed Behavior
From the pocketbase log, 2026-09-01 16:03 (projection "Named Personas Summary", lens excludes unnamed personas; fragment added: an unnamed flower-arranging persona):

```
snapshot projection 98cif0667x8f3m0: delta reported no semantic change; republishing the approved output verbatim
snapshot projection 98cif0667x8f3m0 ("Named Personas Summary"): stored pending snapshot 29n8w5lc6mw2999 (2288 chars, 13.47s)
approve projection 98cif0667x8f3m0: snapshot 29n8w5lc6mw2999 is now the approved output (sequence 3)
```

The stored pending output is byte-identical to approved sequence 2 (same 2288 chars). The approval at sequence 3 came from a user click 28s later.

## Pointers
- `kalaidoscope/internal/engine/snapshot.go` — the `merged == prev` branch ("delta reported no semantic change") and the `outputStr == prev` branch ("candidate matches the approved output byte-for-byte") both fall through to `completeClaimedSnapshot(..., Status: status)` with `status` = pending for projections. Only `status == StatusApproved` (reflections) auto-approves via `ApproveSnapshot`.
- `kalaidoscope/internal/reconcile/worker.go` `generateEntity` — projections always request `StatusPending`. That is where a "no change" result could be promoted directly (the engine already knows `merged == prev` at that point) instead of parked for review.
- `app/src/features/projections/pages/ProjectionReview.tsx:130-145` — computes `currentContent`/`pendingContent` and `pendingEmpty`, but has no "pending equals current" case; the compare pane (`snapshot-compare-pane.tsx`) just renders every row as `same`.
- Existing test pins the storage behaviour but not the status: `internal/engine/snapshot_gen_test.go` `TestGenerateSnapshotNoChangesKeepsPreviousVerbatim`.

## Related
- `p1/2026-08-26-pending-candidates-not-superseded-by-new-fragments.md` — same pending-candidate lifecycle.
- Approving a no-op still bumps `approval_sequence_number`, so the approval history gains an entry with no content change.
