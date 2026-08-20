---
title: "SnapshotIsCurrent picks the latest snapshot by -created, racing same-millisecond ties"
status: "open"
author: "agent"
created: "2026-08-20"
---

## Description
`internal/engine/snapshot.go:117` (`SnapshotIsCurrent`) selects the latest snapshot with
`ORDER BY -created LIMIT 1`. Two snapshots saved within the same `created` timestamp tick
tie, and SQLite returns either row. The schema carries `approval_sequence_number`
precisely because wall-clock ordering is unreliable for approval order, but this query
does not use it.

## Steps to Reproduce
1. `CGO_ENABLED=0 go test ./internal/engine/ -run TestSnapshotIsCurrentConsidersModel -count=20`
2. Some iterations fail at `snapshot_test.go:65` ("legacy snapshot without model must
   stay current"): the test creates two approved snapshots back-to-back; when their
   `created` values tie, the older `model="gemma4"` row is returned as "latest", reads as
   model-drifted against the entity's `other-model` override, and the check returns false.

## Expected Behavior
The newest approved snapshot deterministically wins, regardless of save timing.

## Observed Behavior
Intermittent test failure; in production the same tie can make `SnapshotIsCurrent`
consult the wrong snapshot (worst case a spurious regeneration in a reconcile wave).

## Context / Relevant Code
- `internal/engine/snapshot.go:117-122`
- `internal/engine/snapshot_test.go:13-67`
- Ordering rationale for `approval_sequence_number`: `.agents/spec` "Approval sequence
  numbers".
