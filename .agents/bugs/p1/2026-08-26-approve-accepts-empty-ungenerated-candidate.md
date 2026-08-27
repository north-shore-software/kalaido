---
title: "ApproveSnapshot accepts empty/ungenerated candidates as the new plan of record"
status: "open"
author: "agent"
created: "2026-08-26"
---

## Description

`ApproveSnapshot` (`kalaidoscope/internal/engine/lifecycle.go:98`) performs no validation
on the candidate it promotes: it only checks `approval_sequence_number == 0`, then stamps
the next sequence number and sets `status='approved'`. A snapshot with `output=""`,
`resolved_context={}` and no model — such as one produced by generating while the lens is
still distilling (see companion p0 bug
`2026-08-26-refresh-before-lens-distills-writes-empty-snapshot.md`) — sails through and
becomes the entity's live truth.

Observed live (2026-08-27 00:28:05 UTC): empty pending snapshot `0z2o4bflqb6i511` on
projection `77ti05udys15x6a` "User Personas Summary" was approved via
`POST /api/projections/77ti05udys15x6a/candidates/0z2o4bflqb6i511/approve` and became
approval_sequence_number 2 with `output='""'` and `resolved_context='{}'`.

Downstream damage once an empty snapshot is the newest approved one:

- Staleness/new-fragment counts diff in-scope fragments against the live snapshot's
  `resolved_context`; an empty baseline marks **every** fragment as new (dashboard showed
  "26 new fragments" when the true delta was 1).
- `latestApprovedOutput` returns `""`, so the next generation's minimal-diff rewrite has
  no anchor and the review pane diffs against nothing.
- Any downstream projection consuming this one via `renderSourceOutputs` receives empty
  input as "approved truth".

This is the missing circuit breaker for a family of bugs: the empty-lens generation
above, and the truncated-stream candidate documented in
`p0/2026-08-26-cancelled-stream-returns-partial-output-as-complete.md`, both rely on
approve promoting whatever it is handed.

## Steps to Reproduce

1. Produce a pending snapshot with empty output (easiest: hit Refresh on a
   just-committed projection before its lens distillation finishes).
2. Approve it (review pane Approve button, or
   `POST /api/projections/:id/candidates/:rid/approve`).
3. The empty snapshot becomes the live approved snapshot; the projection's dashboard
   card now counts all in-scope fragments as new.

## Expected Behavior

Approve should refuse (409/422) a candidate that was never actually generated — at
minimum when `output` is empty/whitespace and `resolved_context` is empty while the
entity's context resolves to a non-empty set. The review UI should likewise not offer
Approve on such a candidate (or should present it explicitly as "empty document —
discard?").

## Observed Behavior

Empty candidate approved without complaint; `UPDATE projection_snapshot SET
approval_sequence_number=2, status='approved' ... output='""',
resolved_context='{}' WHERE id='0z2o4bflqb6i511'` in the sidecar log, followed by the
dashboard reporting "26 new fragments" for the projection.
