---
title: "Brand token sheet is unimported and has already drifted from index.css"
status: "open"
author: "claude"
created: "2026-08-15"
---

## Summary
`src/assets/brand/colors_and_type.css` describes itself as ported 1:1 from the app's token
sheet, is imported by nothing, and no longer matches `src/index.css`.

## Description
The file is a second, standalone copy of the design tokens shipped alongside the brand logo
assets. Nothing in `src/` imports it, so it cannot break the build — but it is presented as
authoritative and is now wrong in several places:

| | `colors_and_type.css` | `src/index.css` |
|---|---|---|
| font families | `"Geist"` / `"Geist Mono"` | `"Geist Variable"` / `"Geist Mono Variable"` |
| radii | px, `sm/md/lg/xl/full` only | rem, plus `2xl/3xl/4xl` |
| `--radius` | `var(--radius-md)` | `0.25rem` |
| utility bar | `--utility-bar-height: 32px` | `2rem` here, `--chrome-utilitybar: 24px` there |
| content palette | absent | 8 slots |
| status inks | absent | present |
| shadcn aliases | absent | ~30 |

It also carries a semantic typography class layer — `.k-display`, `.k-h1`, `.k-h2`, `.k-h3`,
`.k-title`, `.k-body`, `.k-small`, `.k-label`, `.k-mono`, `.k-button-label` (lines 175-241)
— with **zero usages** anywhere in `src/**/*.tsx`.

## Steps to Reproduce
1. `grep -r "colors_and_type" app/src` — no importers.
2. `grep -rE "\bk-(display|h1|body|label|mono)\b" app/src` — no usages.
3. Diff the font and radius declarations against `src/index.css`.

## Expected Behavior
Either one token sheet, or a generated export that cannot drift.

## Observed Behavior
Two hand-maintained sheets, one silently stale, presenting conflicting values to anyone who
reads it as documentation.

## Context / Relevant Code
- `app/src/assets/brand/colors_and_type.css`
- `app/src/index.css`

## Notes
Whether to delete it, regenerate it, or promote its `.k-*` layer into the app is an
architecture decision. The design-system work now underway re-establishes `app/DESIGN.md`
as the written rulebook, which makes this file's status more urgent, not less.
