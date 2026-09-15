---
title: "TestApplyEditCreatesFragmentPinsAndSecondPendingRow is flaky: same-millisecond `created` tie picks the wrong candidate"
status: "open"
author: "agent"
created: "2026-09-14"
---

## Description
`internal/engine/edit_test.go` `TestApplyEditCreatesFragmentPinsAndSecondPendingRow` asserts that the hand-edited candidate reads as current via `SnapshotIsCurrent`. That helper picks the entity's newest pending/approved snapshot ordered by `-created,-approval_sequence_number`. The source candidate and the edited row are created within the same millisecond and both have approval sequence 0, so the tie is broken arbitrarily; when the source candidate wins, its `resolved_context` lacks the edit fragment and the assertion fails.

Reproduced on the unmodified tree (2026-09-14): `CGO_ENABLED=0 go test -count=5 -run TestApplyEditCreatesFragmentPinsAndSecondPendingRow ./internal/engine/` fails 4 of 5 runs. It usually passes inside a full `go test ./internal/engine/` run because the fixture setup spreads the timestamps out.

## Steps to Reproduce
```
cd kalaidoscope
CGO_ENABLED=0 go test -count=5 -run TestApplyEditCreatesFragmentPinsAndSecondPendingRow ./internal/engine/
```

## Expected Behavior
The test passes deterministically.

## Observed Behavior
```
--- FAIL: TestApplyEditCreatesFragmentPinsAndSecondPendingRow (0.51s)
    edit_test.go:160: edited candidate should read as current: it carries the new fragment the scope now resolves to
```

## Pointers
- `internal/engine/snapshot.go` `SnapshotIsCurrent` — the `-created,-approval_sequence_number` sort; the comment already notes the millisecond tie for approved rows, but two pending rows have no tie-breaker.
- `internal/engine/edit.go` `ApplyEdit` — the source candidate stays pending alongside the edited row (documented as deliberate), which is what creates the tie.
- Either give `SnapshotIsCurrent` a deterministic tie-breaker for pending rows (e.g. `-created,-approval_sequence_number,-id` is not meaningful; `generated_at` or a small sleep in the test fixture), or have the test space the two rows apart as `internal/reconcile/worker_test.go` does with a 2ms sleep.
