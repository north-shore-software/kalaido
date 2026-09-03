---
title: "`fragment` and `chat_conversation` are directly client-writeable, bypassing their endpoints"
status: "open"
author: "human"
created: "2026-09-03"
---

## Description

The API rules table in § 2 "Collections" grants full List/View, Create, Update and Delete to `fragment`, `ingest`, `chat_conversation` and `chat_message`. Every other collection is read-only to clients (`kalaidoscope_config` is update-only and hook-guarded; `lens` is fully closed).

Note left on `kalaidoscope/docs/schema.md`:

> why is fragment writeable? shouldn't always be goign through the ingest endpoint?
>
> same thing for chat_converstaion

## Context / Relevant Code

- Rules are (re)assigned on every migration run — see `kalaidoscope/migrations/1748000000_init_schema.go` and `kalaidoscope/docs/schema.md` § 1 "Migration mechanics".
- Doc: `kalaidoscope/docs/schema.md` § 2, API rules table.
- Relevant behaviour that currently depends on hooks rather than rules: `fragment.origin` is defaulted to `app` by a hook, `fragment.source_time` is defaulted to now by a hook, and `fragment.deleted_at` soft-delete is set by the delete-request hook (`kalaidoscope/docs/ingestion.md` § 7).
