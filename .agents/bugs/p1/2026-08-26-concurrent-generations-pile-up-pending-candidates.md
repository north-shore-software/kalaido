---
title: "Concurrent generations for the same projection race and pile up duplicate/orphaned pending candidates"
status: "open"
author: "agent"
created: "2026-08-26"
---

## Description

Nothing serialises or dedups candidate generation per projection, so several generators can run
for the same target at once, each inserting its own pending snapshot. Observed live on
2026-08-26 (~23:55–23:56) for projection `015o08543tfea6l`: after a new fragment landed, three
generations for the same projection overlapped —

1. the reconcile wave's background generation (started 16:55:48),
2. an interactive generation the rotation flow kicked off when the *previous* queue item was
   approved (started 16:55:54),
3. a fresh interactive generation (started 16:56:25) whose arrival cancelled #2 mid-stream.

Result: multiple pending snapshots for one projection (the truncated `m27z34i013629ud` from #2,
plus the wave's own candidate from #1 landing after it), on top of an already-orphaned pending
from earlier (`vo88388jo329u92` on projection `y9cjy1a540g802d`, superseded when the wave's
Barry+John candidate `xkjz9654ojmu0fh` was approved as seq 2 instead). Superseded pendings are
never cleaned up, and each loser of the race burned 1–3 model calls.

Note: `SnapshotIsCurrent` dedups *sequential* waves, but it cannot see generations that are still
in flight — they haven't inserted their snapshot yet — so racing generators all pass the check.

## Steps to Reproduce

1. Ingest a fragment that makes a projection stale (reconcile wave starts a background
   generation).
2. While it runs, approve the preceding rotation-queue item (UI triggers an interactive
   generation for the same projection) and/or click regenerate manually.
3. Observe several `snapshot`-role runs for the same projection in `llm_queue_status`, then
   multiple `status='pending'` rows for that projection in `projection_snapshot`.

## Expected Behavior

At most one generation in flight per (projection, resolved context): later requests should join
or supersede-and-cancel the in-flight one, and approving a candidate should discard (or mark
superseded) other pending candidates for the same target so the review queue holds one candidate
per projection.

## Observed Behavior

`llm_queue_status.running` showed two concurrent `snapshot` entries for the same projection
(background + interactive); `projection_snapshot` accumulated multiple pending rows per
projection; the cancelled loser stored a truncated document (see p0 bug
`2026-08-26-cancelled-stream-returns-partial-output-as-complete.md`).
