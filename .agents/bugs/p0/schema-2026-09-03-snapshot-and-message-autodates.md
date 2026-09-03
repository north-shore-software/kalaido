---
title: "`created`/`updated` autodates on snapshots and chat messages — when are they written, and are they needed?"
status: "open"
author: "human"
created: "2026-09-03"
---

## Description

Two collections carry PocketBase `autodate` `created`/`updated` pairs whose purpose is unclear, particularly where a more specific timestamp already exists on the same row.

**`projection_snapshot` / `reflection_snapshot`** — § 2.8 / 2.9. Fields `created`, `updated` (autodate), sitting alongside the explicit `approval_timestamp` and `generation_timestamp` date fields.

> when are these udpated? by what? if it's approval/generation, do we need this?

**`chat_message`** — § 2.13. Fields `created`, `updated` (autodate).

> when is this ever updated? when more text is streamed back?

## Context / Relevant Code

- Schema definition: `kalaidoscope/migrations/1748000000_init_schema.go`.
- Doc: `kalaidoscope/docs/schema.md` §§ 2.8/2.9, 2.13.
- Note that snapshot `created` is not purely decorative: `kalaidoscope/docs/context.md` § 3 documents the chain-wave snapshot resolution ordering by `-created`, so any change here has a reader.
