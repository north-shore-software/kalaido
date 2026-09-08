---
title: "`grounded_count` may just be a count of `things`"
status: "open"
author: "human"
created: "2026-09-03"
---

## Description

`fragment_annotation` (§ 2.19) carries `grounded_count`, a `number` field documented as "things shown to the model". The same row also carries a `things` json field.

Note left on `kalaidoscope/docs/schema.md`:

> isnt' that just counting "things" ? why is there a separate field?

## Context / Relevant Code

- Schema definition: `kalaidoscope/migrations/1748000000_init_schema.go`.
- Doc: `kalaidoscope/docs/schema.md` § 2.19; the `things` shape is given in § 3 as `[{ref} | {name, kind, note}]`.
- Annotation flow: `kalaidoscope/docs/map.md`.
