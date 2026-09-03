---
title: "Reflection snapshots carry four window fields — why so many?"
status: "open"
author: "human"
created: "2026-09-03"
---

## Description

`reflection_snapshot` (§ 2.9) carries four reflection-only window fields: `window_spec` (json), `resolved_window` (json), `window_key` (text) and `window_spec_version_number` (number).

Note left on `kalaidoscope/docs/schema.md`, against `window_key`:

> what is this? we have spec, resolved, key, and version number? why so many?

## Context / Relevant Code

- Schema definition: `kalaidoscope/migrations/1748000000_init_schema.go`.
- Doc: `kalaidoscope/docs/schema.md` § 2.9; JSON shapes in § 3 — `reflection.window_spec_versions` is `[{versionNumber, effectiveFrom, spec: {mode?, startTime, endTime?, period, duration}}]`, and `reflection_snapshot.window_spec` is one such `spec` with `resolved_window` = `{start, end}`.
- `window_key` also appears outside this table: in the unique index `idx_reflection_snapshot_approval_seq (reflection_id, window_key, approval_sequence_number)`, and in the `reflection_window` collection (§ 2.18), which stores explicitly backfilled windows keyed by `idx_reflection_window_key (reflection_id, window_key)` unique — grid windows are never stored there.
- Window behaviour overall: `kalaidoscope/docs/rotation.md`.
