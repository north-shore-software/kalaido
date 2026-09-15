---
title: "TestApplyEditCreatesFragmentPinsAndSecondPendingRow is flaky on SnapshotIsCurrent"
status: "open"
author: "agent"
created: "2026-09-14"
---

## Description
`internal/engine/edit_test.go` `TestApplyEditCreatesFragmentPinsAndSecondPendingRow` fails roughly two runs in three on an unmodified tree. Only the final assertion fails: after a hand edit, `SnapshotIsCurrent` is expected to report the edited candidate as current, and sometimes does not.

## Steps to Reproduce
1. `cd kalaidoscope`
2. `CGO_ENABLED=0 go test ./internal/engine/ -run TestApplyEditCreatesFragmentPinsAndSecondPendingRow -count=1`
3. Repeat three times.

## Expected Behavior
Passes every run.

## Observed Behavior
```
--- FAIL: TestApplyEditCreatesFragmentPinsAndSecondPendingRow (0.51s)
    edit_test.go:160: edited candidate should read as current: it carries the new fragment the scope now resolves to
```
Every other assertion in the test passes. Timing-dependent: likely the edit fragment's `occurred_at`/`created` ordering against the snapshot's resolved context, or a same-second comparison in the currency check.
