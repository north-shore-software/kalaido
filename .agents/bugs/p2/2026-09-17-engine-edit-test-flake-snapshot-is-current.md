---
title: "engine test flake: TestApplyEditCreatesFragmentPinsAndSecondPendingRow intermittently reads the edited candidate as stale"
status: "open"
author: "agent"
created: "2026-09-17"
---

## Description
`TestApplyEditCreatesFragmentPinsAndSecondPendingRow` (`internal/engine/edit_test.go`) ends by asserting `SnapshotIsCurrent(...)` is true for the candidate a hand-edit just produced. Roughly one run in three it is false and the test fails with "edited candidate should read as current". Nothing in the test is random; the edit fragment and the snapshot are created within the same millisecond, so the staleness comparison most likely resolves on a timestamp tie (PocketBase dates carry millisecond precision) and reads the fragment as newer than the snapshot that pinned it.

## Steps to Reproduce
1. `cd kalaidoscope && for i in $(seq 6); do CGO_ENABLED=0 go test -count=1 -run TestApplyEditCreatesFragmentPinsAndSecondPendingRow ./internal/engine/; done`
2. One or two runs fail at `edit_test.go:160` with the message above; the rest pass.

## Expected Behavior
A candidate whose resolved context already includes the edit fragment reads as current regardless of how close the two rows' `created` timestamps land.

## Observed Behavior
Intermittent `FAIL` on an unmodified tree (observed 2 of 5 runs at `55a8458`); no other test in the package flakes.
