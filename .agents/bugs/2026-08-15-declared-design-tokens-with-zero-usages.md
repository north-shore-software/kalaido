---
title: "Five families of design tokens are declared but never referenced"
status: "open"
author: "claude"
created: "2026-08-15"
---

## Summary
`--shadow-overlay`, `--ease`, `--duration-1..4`, `--space-1..12` and `--weight-*` are
declared in `:root` and have zero `var()` references anywhere in `src/`. They also sit
outside `@theme`, so they generate no Tailwind utilities either.

## Description
In `app/src/index.css`, all inside the `:root` block (lines 154-184):

| Token family | Lines | `var()` usages in `src/` |
|---|---|---|
| `--weight-medium` / `--weight-semi` / `--weight-bold` | 154-156 | 0 |
| `--space-1` … `--space-12` | 159-168 | 0 |
| `--shadow-overlay` | 171-172 | 0 |
| `--ease`, `--duration-1` … `--duration-4` | 175-178 | 0 |
| `--chrome-*` | 181-184 | 0 (tracked separately) |

Because they are declared in `:root` rather than `@theme`, Tailwind generates no
corresponding utilities, so they are unreachable from both CSS and markup. Components use
Tailwind literals instead — `duration-100`, `duration-200`, `font-semibold`, `p-4`,
`shadow-md`.

The practical cost is that the token sheet reads as though the project has a spacing scale,
a motion system and an elevation token when it does not; anyone reasoning from it will
reach conclusions the rendered app does not support.

## Steps to Reproduce
```
grep -rc "var(--space-1)\|var(--ease)\|var(--shadow-overlay)\|var(--weight-medium)" app/src --include=*.tsx --include=*.ts
```
Returns 0 for each.

## Expected Behavior
Declared tokens are either consumed or removed.

## Observed Behavior
~25 declarations that no code can reach.

## Context / Relevant Code
- `app/src/index.css:154-184`

## Notes
Deleting them is safe but is a decision about what the design system claims to offer —
particularly the spacing scale, which the incoming mock-derived system does have opinions
about. Worth settling alongside that work rather than as a standalone tidy-up.
