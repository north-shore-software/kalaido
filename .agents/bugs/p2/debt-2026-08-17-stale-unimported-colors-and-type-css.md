---
title: "Stale un-imported colors_and_type.css carries a conflicting design system"
status: "open"
author: "agent"
created: "2026-08-17"
---

## Description
`app/src/assets/brand/colors_and_type.css` is not imported anywhere
(`index.css` is the only live token file) but still sits in `src/` carrying
values from a previous design system that contradict the current one:
`--font-heading: "Geist"`, non-zero radii (`--radius-md: 4px`,
`--radius-lg: 8px`), a different `--ease`, a blurred `--shadow-overlay`, and
`--utility-bar-height: 32px` (vs `2rem` in index.css, vs the dead
`--chrome-utilitybar: 24px`).

## Expected Behavior
No dead token file with conflicting values in `src/` — delete it (or move it
out of `src/` if it's kept as a historical reference).

## Observed Behavior
The file survives and reads like a second source of truth; grep for any token
name returns contradictory definitions.

## Context / Relevant Code
- `app/src/assets/brand/colors_and_type.css` (whole file)
- Live tokens: `app/src/index.css`
