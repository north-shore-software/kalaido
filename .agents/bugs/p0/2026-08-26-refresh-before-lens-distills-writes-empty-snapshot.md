---
title: "Refresh before lens distillation completes silently writes an empty snapshot; approving it poisons staleness counts"
status: "resolved"
author: "agent"
created: "2026-08-26"
---

## Description

`GenerateSnapshot` treats an unresolvable lens as "generate nothing" instead of an error
(`kalaidoscope/internal/engine/snapshot.go:76-78`):

```go
if strings.TrimSpace(lensPrompt) == "" {
    outputStr = ""
} else { ... }
```

`resolveActiveLens` (`engine/lens.go:36`) returns an empty prompt whenever
`current_lens_id` is still `""` — which is the normal state in the window between a
refinement commit (which sets `lens_distill_requested` and clears `lens_id`) and the
background distillation worker minting the lens. During that window a Refresh
(`POST /api/projections/:id/candidates`) makes **no model call** and inserts a pending
snapshot with `output=""`, `resolved_context={}`, `context_spec={}`, `model=""`. The
handler returns the snapshot ID as a success, so the UI presents an empty candidate for
review as if it were a real generation.

Observed live (2026-08-27 UTC, fresh demo2 workspace):

- 00:23:16 — projection `77ti05udys15x6a` "User Personas Summary" committed;
  `lens_distill_requested=true`, `lens_id=''`. Its lens `993313pb5j8z899` was only
  created at **00:26:14**.
- 00:25:14 — user hit Refresh. Inserted pending snapshot `0z2o4bflqb6i511` with
  `context_spec='{}'`, `resolved_context='{}'`, `output='""'`, no model. No LLM call
  for it appears in the queue log.
- 00:28:05 — the empty candidate was approved (see companion bug on the approve guard)
  and became approval_sequence_number 2, i.e. the plan of record.
- Dashboard consequence: new-fragment staleness is computed against the latest approved
  snapshot's `resolved_context`; with `{}` as the baseline, **all 26 in-scope fragments
  (25 imported + 1 new)** read as new — the card showed "26 new fragments" when the true
  delta was 1.

The same thing happened again minutes later for projection `593ial090uat190` "Kalaido
High Level Use Cases": Refresh at 00:28:10 inserted empty pending snapshot
`vu8461c19v1j5z0` while its lens `40if57o7ql2avk0` wasn't distilled until 00:29:44.

Note `resolveActiveLens`'s error is discarded at the call site
(`snapshot.go:42` — `lensPrompt, lensSpec, _ := resolveActiveLens(...)`), so a lens
lookup failure is indistinguishable from "no lens yet".

## Steps to Reproduce

1. Create a projection via the refinement chat and commit it (this queues lens
   distillation; `projection.current_lens_id` stays `""` until the distill worker
   finishes — tens of seconds on gemini-flash, longer on local models).
2. Before distillation completes, add a fragment and click Refresh on the projection
   (`POST /api/projections/:id/candidates`).
3. Inspect `projection_snapshot`: a pending row with `output='""'` and
   `resolved_context='{}'` exists; the review pane shows an empty candidate.

## Expected Behavior

A generation requested while the entity has no active lens should either wait for /
chain onto the pending distillation, or fail with a clear 409-style "lens not ready,
try again shortly" — never persist an empty snapshot that can be reviewed and approved.

## Observed Behavior

Empty pending snapshot silently created and surfaced as a reviewable candidate; once
approved it becomes the live snapshot with an empty `resolved_context`, corrupting the
staleness/new-fragment computation for the projection (reported 26 new fragments when 1
was new) and giving `SnapshotIsCurrent` / minimal-diff anchoring an empty baseline.

## Resolution (2026-08-27)
GenerateSnapshot now refuses with `engine.ErrLensNotReady` when the lens prompt is empty (no model call, nothing persisted); the handler maps it to 409 and the UI shows a Preparing card while `current_lens_id` is empty. `internal/engine/snapshot.go`, `internal/handlers/synthesis.go`; test TestGenerateSnapshotLensNotReadyRefuses.
