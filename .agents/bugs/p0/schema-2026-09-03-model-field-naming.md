---
title: "`model` columns across the schema are vague and possibly redundant"
status: "open"
author: "human"
created: "2026-09-03"
---

## Description

Five separate collections carry a bare `model` text column. It is unclear in every case what the value is meant to be (a family name? a role? a full versioned API model id?), whether it records the model *used* or the model *to use*, and in at least one case whether the column is needed at all.

Notes left on `kalaidoscope/docs/schema.md`, one per field:

**`colour_fragment.model`** — § 2.4 `colour_fragment` — colour↔fragment links. Type `text`; doc note: "model of a `prompt` row". Sits next to `match_type` select(1) (`manual_positive`, `manual_negative`, `thing`, `prompt`).

> do we need this? why is this here? the model verison that matched a specific colour? should this be "model version" or something more specific? what do we have there?

**`projection.model` / `reflection.model`** — § 2.5 / 2.6 synthesis entities. Type `text`; doc note: "per-entity override".

> we shoudl specify this is the model to be used going forwad, not necesasrily the model used for all prev snapshots. right?

**`projection_snapshot.model` / `reflection_snapshot.model`** — § 2.8 / 2.9 generated outputs. Type `text`; no doc note.

> same question about model - version? what? let's be specific.

**`chat_message.model`** — § 2.13 `chat_message`. Type `text`; doc note: "assistant rows only".

> same - model - let's be specific.

**`fragment_annotation.model`** — § 2.19 `fragment_annotation`. Type `text`; no doc note.

> model, again.

## Context / Relevant Code

- Schema definition: `kalaidoscope/migrations/1748000000_init_schema.go` (the single migration).
- Doc: `kalaidoscope/docs/schema.md` §§ 2.4, 2.5/2.6, 2.8/2.9, 2.13, 2.19.
- Related: `kalaidoscope_config.role_models` is documented in § 3 as `{"<role>": "<model>"}`, and `kalaidoscope_config.model_set` is seeded at boot by `resolveModelSet` (§ 4) — whatever vocabulary those use is presumably the same vocabulary these columns should be named against.
