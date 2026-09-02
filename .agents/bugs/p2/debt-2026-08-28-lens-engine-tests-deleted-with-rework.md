---
title: "New lens model deleted engine lens tests without replacement"
status: "open"
author: "agent"
created: "2026-08-28"
---

## Description
The `louis/new-lens-model` commit ("what did I even") deleted `internal/engine/lensworker.go` together with `lensworker_test.go` (fine — the worker is gone), but it also deleted `internal/engine/lens_test.go` while `internal/engine/lens.go` still exists in reworked form. The engine side of the new lens model ships with no direct test coverage; the surviving lens coverage lives in `internal/handlers/refinements_test.go`, which exercises extraction/commit paths, not the engine.

## Steps to Reproduce
1. Look at `internal/engine/` after the rebase of `louis/new-lens-model` lands.
2. `lens.go` is present; no `lens_test.go` exists.

## Expected Behavior
The reworked lens engine code has tests covering its invariants, or an explicit decision is recorded that handler-level tests are the intended coverage.

## Observed Behavior
No engine-level lens tests remain after the rework.
