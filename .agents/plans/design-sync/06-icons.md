# 06 — Icon stroke widths

**Rule being applied:** §6 Icons: "Stroke `1.5` for structural icons, `2` for
check marks and chevrons."

## Context

Today only the rail icons set 1.5 (`components/layout/sidebar-nav.tsx` —
correct, do not touch). Everything else ships Lucide's default 2, and three
check marks are set *above* 2 (2.2 / 2.4).

## Changes

1. Set the app-wide default to 1.5 with one CSS rule in `app/src/index.css`
   (base layer): `svg.lucide { stroke-width: 1.5; }` — Lucide puts the
   `lucide` class on every icon, and CSS `stroke-width` beats the SVG
   attribute.
2. Re-assert 2 on the exceptions, per the rule: add an explicit
   `strokeWidth={2}` (or a `stroke-[2]` class) to check marks and chevrons —
   search for `Check`, `Chevron` icon imports across `app/src`.
3. Normalise the overweight checks to 2: `strokeWidth={2.2}` in
   `features/dashboard/components/caught-up-banner.tsx` and
   `features/rotation/components/rotation-empty-state.tsx`; `2.4` in
   `features/rotation/components/queued-rotation-row.tsx`.
4. The hand-rolled inline SVG in
   `components/kalaido/context-picker/context-picker.tsx` (~line 702) is a
   circle-minus Lucide already ships — replace it with Lucide's `CircleMinus`
   at the same size.

## Review screen

**Dashboard** (icon-dense) plus one look at the rail (must be unchanged) and
any breadcrumb chevron. The app should read slightly lighter/finer everywhere;
checks stay assertive.

Compile check: `npx tsc --noEmit` in `app/`.
