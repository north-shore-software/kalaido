---
title: "Two utility-bar height tokens disagree; one is unused"
status: "open"
author: "claude"
created: "2026-08-15"
---

## Summary
`--utility-bar-height: 2rem` (32px) and `--chrome-utilitybar: 24px` both describe the same
strip and give different answers. Only the former is consumed.

## Description
In `app/src/index.css`:

- `:23` — `--utility-bar-height: 2rem;`
- `:184` — `--chrome-utilitybar: 24px;`
- `:370` — the only consumer:
  `height: calc(100svh - var(--titlebar-height) - var(--utility-bar-height));`

`--chrome-utilitybar` has zero `var()` references anywhere in `src/`. It sits in a block of
`--chrome-*` tokens alongside `--chrome-sidebar: 240px` and
`--chrome-sidebar-collapsed: 48px`, which are also unused — the real sidebar widths are
JavaScript constants in `components/ui/sidebar.tsx:28-30` (`11rem` / `3rem`), and those
disagree with `--chrome-sidebar` too.

The rendered bar is `h-8` (32px) in `components/layout/utility-bar.tsx:79`, so `2rem` is
the truthful value.

## Steps to Reproduce
Read the three lines above; grep for `--chrome-utilitybar` and `--chrome-sidebar` in `src/`.

## Expected Behavior
One token per dimension, consumed by both the CSS and the components that render it.

## Observed Behavior
Two tokens, one dead and wrong, plus a third source of truth in JS constants.

## Context / Relevant Code
- `app/src/index.css:23,180-184,370`
- `app/src/components/layout/utility-bar.tsx:79`
- `app/src/components/ui/sidebar.tsx:28-30`

## Notes
Deciding which layer owns chrome dimensions (CSS tokens vs JS constants) is an architecture
call, not a cleanup.
