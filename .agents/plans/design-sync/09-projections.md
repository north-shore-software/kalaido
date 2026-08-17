# 09 — Projections (list · detail · draft · review)

Screens: `features/projections/pages/{Projections,ProjectionDetail,ProjectionReview,NewProjection}.tsx`
and `features/projections/components/*`. Review is the mock's own screen — it is
the reference; expect it to change least.

## Changes

1. **De-chamfer the auto-segment button**
   (`components/kalaido/context-picker/resolution-readout.tsx` ~line 207). Rule:
   §5 Chamfer — "applied to exactly two things… treat it as scarce"; §5 Shadows —
   overlays carry no accent shadow (and this one's `shadow-cyan` renders nothing
   on a clipped element; see `.agents/bugs/ux-2026-08-17-shadow-cyan-…`). Make it
   an **outlined** button with the scoped-action hover (`line-strong` → section
   accent). Its over-budget warning state: `critical` → `drifting` (§4 danger is
   destructive-only).
2. **Stale/refresh yellows → drifting** (`components/projection-side-rail.tsx`
   stale card, `components/projection-card.tsx` freshness text). Rule: §3 Status —
   drifting covers stale, and it has a new hue from step 01; yellow now belongs
   to Chat. Swap `yellow-*` → `drifting-*` tokens.
3. **Type pass**: this feature has ~22 arbitrary `text-[Npx]` values, most
   near-misses of real roles (`text-[13.5px]`→`row`, `text-[10.5px]`→`label`…).
   Rule: §2 type roles. Migrate per the README map, one component at a time.
4. **Review screen check**: compare pane, pending column, commit button, refine
   composer — should all match §7 already; the commit button and pending column
   stay magenta (§4: demand is constant). Armed composer is now violet.

## Review

Walk list → detail → draft → review. Magenta appears only where something is
pending; staleness reads in the new drifting colour; one chamfered element per
screen except review's commit+send pair (§5's two sanctioned chamfers).
Compile check: `npx tsc --noEmit` in `app/`.
