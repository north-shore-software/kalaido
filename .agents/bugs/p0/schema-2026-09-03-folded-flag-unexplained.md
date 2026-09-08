---
title: "`folded` on fragment_annotation is an unexplained concept"
status: "open"
author: "human"
created: "2026-09-03"
---

## Description

`fragment_annotation` (§ 2.19) carries `folded`, a `bool` field documented only as "consumed by a consolidation", and indexed as `idx_fragment_annotation_folded`.

Note left on `kalaidoscope/docs/schema.md`:

> what is this concept, seriously. why is this here? what is going on with this?

## Context / Relevant Code

- Schema definition: `kalaidoscope/migrations/1748000000_init_schema.go`.
- Doc: `kalaidoscope/docs/schema.md` § 2.19.
- "Consolidation" is the map v4 whole-scope RoleMap rewrite described in `kalaidoscope/docs/map.md`.
