---
title: "minimizeAgainstPrevious falls back to raw candidate on context cancellation instead of aborting"
status: "open"
author: "agent"
created: "2026-08-26"
---

## Description

`engine.minimizeAgainstPrevious` (snapshot.go) special-cases only `llmq.ErrPreempted`: on that
error `GenerateSnapshot` returns and the reconcile worker retries the whole generation. Any other
error — including a plain `context.Canceled` when the request driving the generation is torn
down — lands in the "polish failed, keep raw candidate" fallback and the generation *succeeds*,
persisting a snapshot.

That fallback is intended for provider hiccups on the delta/merge calls, where the raw candidate
is still a correct document. Cancellation is different: the whole generation is being abandoned,
and (per the companion p0 bug `2026-08-26-cancelled-stream-returns-partial-output-as-complete.md`)
the raw candidate itself may be truncated. Falling back turns an abandoned generation into a
committed pending snapshot.

## Steps to Reproduce

1. Start a candidate generation for a projection that has an approved predecessor (so the
   delta/merge conversation runs).
2. Cancel the generation's context after the raw candidate call but before/inside the delta call.
3. The delta call fails with `context canceled`; the fallback stores the raw candidate as a
   pending snapshot instead of aborting.

## Expected Behavior

`minimizeAgainstPrevious` errors that are `context.Canceled` / `context.DeadlineExceeded` (i.e.
`ctx.Err() != nil`) should abort `GenerateSnapshot` with an error — same contract as
`llmq.ErrPreempted` — so nothing is persisted for a cancelled generation. The raw-candidate
fallback should apply only to genuine provider failures while the generation itself is still
wanted.

## Observed Behavior

```
2026/08/26 16:56:25 snapshot projection 015o08543tfea6l: minimal-diff rewrite failed, keeping raw candidate: semantic delta: context canceled
```

followed by a pending snapshot INSERT for the abandoned (and truncated) candidate.
