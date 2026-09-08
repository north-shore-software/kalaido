---
title: "`approval_sequence_number` — could ordering come from timestamps instead?"
status: "open"
author: "human"
created: "2026-09-03"
---

## Description

`projection_snapshot` / `reflection_snapshot` (§ 2.8 / 2.9) carry `approval_sequence_number`, a `number` field, alongside the `approval_timestamp` and `generation_timestamp` date fields.

Note left on `kalaidoscope/docs/schema.md`:

> is there no way of just having greater precision on date? or enforcing that the approval/generation timestamps of a new row are always monotonically increasing?

## Context / Relevant Code

- Schema definition: `kalaidoscope/migrations/1748000000_init_schema.go`.
- Doc: `kalaidoscope/docs/schema.md` § 2.8 / 2.9.
- The field backs two unique partial indexes: `idx_projection_snapshot_approval_seq (projection_id, approval_sequence_number)` and `idx_reflection_snapshot_approval_seq (reflection_id, window_key, approval_sequence_number)`, both unique where `status = 'approved'`.
- It is also the ordering key for ordinary snapshot resolution: `-approval_sequence_number` (`kalaidoscope/docs/context.md` § 3).
