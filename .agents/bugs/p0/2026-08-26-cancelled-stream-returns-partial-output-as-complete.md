---
title: "Cancelled LLM stream returns partial output as a complete result; truncated snapshot stored"
status: "open"
author: "agent"
created: "2026-08-26"
---

## Description

When a snapshot generation's context is cancelled mid-stream (e.g. the HTTP request behind
`POST /api/projections/:id/candidates` is torn down while the model is still streaming), the
usage/stream layer ends the stream without surfacing an error. `engine.GenerateOutput` therefore
returns the **partial** text with `err == nil`, and the caller treats it as a finished candidate.

Observed live (2026-08-26 ~23:56, projection `015o08543tfea6l` "High Level Kalaido Use Cases"):
an interactive generation was cancelled ~366 tokens in; the truncated text was carried forward as
the raw candidate, and after the follow-up delta call failed with `context canceled`, the
fallback path stored it as pending snapshot `m27z34i013629ud` whose output ends **mid-word**:

```
### 7. Interpersonal Conflict Buffer and Relationship Check-ins
* **Broad Goal:** **De-escalate Inter
```

(7 of 9 sections present.) A user reviewing the queue can approve this garbage as the new truth.

## Steps to Reproduce

1. Trigger a candidate generation for a projection (`POST /api/projections/:id/candidates`).
2. Cancel the request context while the snapshot stream is in flight (close the pane / re-trigger
   generation so the old request is cancelled).
3. Inspect `projection_snapshot`: a pending snapshot with truncated `output` is inserted.

## Expected Behavior

A cancelled stream must propagate an error (`context.Canceled` / provider abort) out of
`usage.GenerateOnce` / `GenerateOnceMsgs`, so `GenerateSnapshot` fails (or is retried) instead of
persisting a partial document. No snapshot row should ever contain a mid-stream truncation.

## Observed Behavior

Sidecar log at the moment of failure (the delta step saw the cancellation; the candidate step did
not):

```
2026/08/26 16:56:25 snapshot projection 015o08543tfea6l: minimal-diff rewrite failed, keeping raw candidate: semantic delta: context canceled
```

followed by `INSERT INTO projection_snapshot ... id='m27z34i013629ud', status='pending'` with the
truncated output above. Root cause is in the stream-consumption layer: the event channel closes on
cancellation and the accumulated text is returned as a successful completion.
