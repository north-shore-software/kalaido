# 12 — Fragments (stream)

Screens: `features/fragments/pages/Stream.tsx`, `features/fragments/components/stream-parts.tsx`,
`components/kalaido/fragment-card.tsx`, `components/kalaido/document-card.tsx`.

## Changes

1. **Yellow left rule on every fragment card** (`fragment-card.tsx`,
   `stream-parts.tsx`): decorative yellow. Rule: §4 — yellow is Chat's hue now,
   and entity identity is not accent. Options to put to Sara: `line-strong`
   (quiet), the fragment's own content-palette colour (identity — §3 sanctions
   it), or the teal section accent. Recommend content colour; she picks.
2. **Loading pill** (`Stream.tsx`): `StatusPill kind="yellow"` for loading.
   Rule: §4 status colours have fixed meanings, none of which is "loading".
   Neutral type pill + spinner (§5 Motion sanctions spinners).
3. **Card recipes** (`stream-parts.tsx`, `document-card.tsx`): `border-line` +
   `bg-card` fills — a canvas-recipe border with a fill, plus a stray
   `shadow-sm` and a `transition-all`. Rule: §7 Cards (canvas card = border, no
   fill; panel card = `line-strong` + `bg-2`) and §5 Motion (colour transitions
   only here). Pick the correct recipe per placement; drop the shadow; scope the
   transition. `document-card.tsx`'s hover fill is legal now (§5 clickable-card
   rule) — keep.
4. **Type pass**: ~7 arbitrary px + 4 t-shirt → roles.

## Review

The stream, teal section: fragment identity via swatches/shape, no yellow
unless something is genuinely drifting.
Compile check: `npx tsc --noEmit` in `app/`.
