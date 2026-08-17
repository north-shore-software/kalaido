# 14 — Connections + Import

Screens: `features/connections/pages/Connections.tsx`,
`features/import/pages/Import.tsx`. Section accent: **neutral** (§3 map) —
`fg-2` plays the accent; these pages are deliberately colourless.

## Changes

1. **"Available" pill** (`Connections.tsx`): `StatusPill kind="yellow"`. Rule:
   §4 — availability is not a status colour. → neutral type pill.
2. **Arrow slide on hover** (`Connections.tsx` `group-hover:translate-x-0.5` +
   `transition-transform`, and a `transition-all`): Rule: §5 Motion — the arrow
   slide is sanctioned **only pre-workspace**. Remove the slide; hover speaks
   through colour. (If Sara wants to keep it, that's extending the exception —
   a rule conversation: it would then also be legal on every workspace card.)
3. **Type pass**: Connections 4 t-shirt, Import 13 t-shirt → §2 roles.
4. Both pages use `PageBody` (20px padding) — already §6-correct.

## Review

Both screens read monochrome + hairlines, nothing coloured except a real
status. Compile check: `npx tsc --noEmit` in `app/`.
