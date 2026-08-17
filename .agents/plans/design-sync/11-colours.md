# 11 — Colours

Screens: `features/colours/pages/Colours.tsx`, `features/colours/components/*`.

## Changes

1. **Type pass**: 4 arbitrary px + 2 t-shirt sizes → §2 roles (e.g.
   `colour-detail-pane.tsx`'s `text-[11.5px]` → `text-meta`).
2. **Section accent check**: blue section — the two mutually-exclusive commit
   buttons (`colour-composer-pane.tsx` / `colour-detail-pane.tsx`) stay magenta
   (§4); selected list state in blue.
3. **Swatch**: the `rounded-[7px]` colour swatch is now a documented exception
   (§5 Radius) — no change; anything else rounded on this screen is not.
4. **Panel**: `colour-list.tsx` 280px — legal per §6.

## Review

The colours screen is where the content palette and the section hue share the
stage (§3 Content palette says that's accepted) — have Sara confirm the blue
chrome doesn't fight the user's swatches; if it does, this section is the
natural candidate for the neutral treatment instead (a §3 map change — log it).
Compile check: `npx tsc --noEmit` in `app/`.
