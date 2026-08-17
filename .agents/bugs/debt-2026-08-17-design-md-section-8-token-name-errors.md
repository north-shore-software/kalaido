---
title: "DESIGN.md §8 names tokens/utilities that don't exist"
status: "open"
author: "agent"
created: "2026-08-17"
---

## Description
Two rows of DESIGN.md §8 ("Token names in code") misdescribe the codebase:

1. `--k-on-accent` is mapped to `--cyan-fg` / `--magenta-fg`. No such tokens
   exist. The actual tokens are `--accent-cyan-fg` / `--accent-magenta-fg`
   (`app/src/index.css:95,97`), exposed as the `text-cyan-foreground` /
   `text-magenta-foreground` utilities (`index.css:306,308`).
2. The utility list names `shadow-magenta`. No such utility exists; the token
   is `--drop-shadow-magenta` → `drop-shadow-magenta` (`index.css:358`), which
   is what `button.tsx:14` uses. §8 here also contradicts §5, which names
   `drop-shadow-magenta` correctly and explains why it must be a filter.

## Expected Behavior
§8's mapping table and utility list match the names that actually exist in
`app/src/index.css`.

## Observed Behavior
Both entries point at nonexistent names; anyone following §8 writes classes
that silently do nothing.

## Context / Relevant Code
- `app/DESIGN.md` §8
- `app/src/index.css:95-97, 306-308, 358`
