# 14 — Connections + Import

Screens: `features/connections/pages/Connections.tsx`,
`features/import/pages/Import.tsx`. Section accent: **neutral** (§3 map) —
`fg-2` plays the accent; these pages are deliberately colourless.

## State: the code changes already landed (batch 2, 2026-08-18)

Sara's tuesday batch did this step's items while sweeping types — verified
against current main:

1. ~~"Available" yellow StatusPill~~ — gone (no `kind="yellow"` remains).
2. ~~Arrow hover-slide~~ — removed; the arrow now speaks through colour only
   (`group-hover:text-fg-2`).
3. ~~Type pass~~ — zero t-shirt sizes left in `features/connections` or
   `features/import`.

## What remains: the review

This step is now review-only. Walk both screens and confirm:

- Both read monochrome + hairlines; nothing coloured except a real status.
- Import's flow states (file pick → preview → progress → done) each look
  right — they were restyled wholesale and have not had a dedicated look.
- Compile check: `npx tsc --noEmit` in `app/`.

Then tick the step in `00-INDEX.md`. Any adjustment Sara wants goes through
the README loop as usual.
