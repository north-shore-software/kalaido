---
title: "index.css names two design source files that do not exist"
status: "open"
author: "claude"
created: "2026-08-15"
---

## Summary
The header comment of `src/index.css` names `/DESIGN.md` and
`/design-system/colors_and_type.css` as its source of truth. Neither path exists.

## Description
`app/src/index.css:14-18`:

```
/* =============================================================
   Kalaido — design tokens
   Source of truth: /DESIGN.md + /design-system/colors_and_type.css
   ...
   ============================================================= */
```

The repository root contains `AGENTS.md`, `CLA.md`, `CONTRIBUTING.md`, `LICENSE`, `NOTICE`,
`README.md`, `app/`, `kalaidoscope/`, `kalaido.sh` — no `DESIGN.md`, no `design-system/`.
The nearest surviving artefact is `app/src/assets/brand/colors_and_type.css`, which is
itself unimported and drifted (tracked separately).

So the token sheet points at documentation that was either never committed or has been
deleted, leaving `index.css` as the de facto and undocumented source of truth.

## Steps to Reproduce
1. Read `app/src/index.css:14-18`.
2. `ls /code/kalaido/DESIGN.md /code/kalaido/design-system` — both missing.

## Expected Behavior
Comments cite paths that resolve, or cite nothing.

## Observed Behavior
A dangling reference that sends a reader looking for a rulebook that is not there.

## Context / Relevant Code
- `app/src/index.css:14-18`

## Notes
Being addressed in part: the design-system work creates `app/DESIGN.md`. The comment will
need updating to that path — note it is `app/DESIGN.md`, not the repo-root `/DESIGN.md` the
comment currently claims.
