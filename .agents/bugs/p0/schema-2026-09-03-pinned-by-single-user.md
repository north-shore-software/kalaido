---
title: "`pinned_by` needs to work for multiple users to be useful"
status: "open"
author: "human"
created: "2026-09-03"
---

## Description

`projection` / `reflection` (§ 2.5 / 2.6) carry `pinned_by`, a `relation(∞) → users` field.

Note left on `kalaidoscope/docs/schema.md`:

> this needs to be able to support multple users if it's going to be useful.

## Context / Relevant Code

- Schema definition: `kalaidoscope/migrations/1748000000_init_schema.go`.
- Doc: `kalaidoscope/docs/schema.md` § 2.5 / 2.6.
- Related: `seedSidecarUser` upserts a single `users` record `user@kalaido.local` at boot (`kalaidoscope/docs/schema.md` § 4), so the current deployment is effectively single-user.
