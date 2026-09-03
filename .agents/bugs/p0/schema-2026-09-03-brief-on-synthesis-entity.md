---
title: "`brief` on projection/reflection is obsolete almost immediately"
status: "open"
author: "human"
created: "2026-09-03"
---

## Description

`projection` / `reflection` (§ 2.5 / 2.6) carry `brief`, a `text` field documented as "discover's proposed opening message".

Note left on `kalaidoscope/docs/schema.md`:

> does this need to be here? could it also be on the first snapshot? it is obsoluete almost immedaitely so a bit gross to have it on this table.

## Context / Relevant Code

- Schema definition: `kalaidoscope/migrations/1748000000_init_schema.go`.
- Doc: `kalaidoscope/docs/schema.md` § 2.5 / 2.6; discover's proposal flow is in `kalaidoscope/docs/discover.md`.
- The same rows also carry `origin_run_id` → `discover_run`, which is the other piece of discover provenance on the entity.
