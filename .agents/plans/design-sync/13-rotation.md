# 13 — Rotation

Screen: `features/rotation/pages/Rotation.tsx`, `features/rotation/components/*`.
Section accent: inherits **projections** (violet) — verify step 02 wired it.

## Changes

1. **Active rotation card** (`components/active-rotation-card.tsx`): `shadow-lg
   shadow-black/40` + `rounded-xl` + `bg-card`. Rule: §1/§3 "depth is surface,
   never shadow"; §5 Shadows (hard offsets only, two per screen, tied to an
   accent); §7 Cards. Remove the blurred shadow; restyle as a §7 card (on the
   canvas: `line` border, no fill — or hero recipe in the section accent if Sara
   wants it to lead the page). Its commit button stays magenta.
2. **Yellow counts** (`active-rotation-card.tsx` "{n} windows" / "{entropy}
   new"): counts are not a status. Rule: §4. → neutral `mono-sm` `fg-3`/`fg-4`;
   `drifting` only if the value genuinely means staleness.
3. **Queued row** (`components/queued-rotation-row.tsx`): check stroke 2.4 → 2
   (done in step 06 — verify); the circular index badge is a documented radius
   exception (§5) — keep.
4. **Type pass**: ~8 arbitrary px + 2 t-shirt → §2 roles.
5. Layout: the centred 680px column is a prose pane — legal per §6.

## Review

Rotation with an active card: flat, hard-edged, violet accents, magenta only on
the commit action.
Compile check: `npx tsc --noEmit` in `app/`.
