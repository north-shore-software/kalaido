# 07 — Dashboard

Screen: `features/dashboard/pages/Main.tsx` and its components.

## Changes (announce each with its rule, review one at a time)

1. **Pin cards** (`components/pin-card.tsx`): the magenta `FileTextIcon` marking
   projections. Rule: §4 "Entity identity is not accent" + "a screen with nothing
   awaiting the user contains no magenta at all". Change the icon to `fg-3` (both
   entity kinds), letting icon shape carry the type; if Sara wants colour, the
   content palette is the sanctioned channel.
2. **Timeline** (`components/kalaido/timeline.tsx`): `tone` defaults to
   `"magenta"` for snapshot histories. Rule: §4 magenta = demand only. Default to
   `"stable"` (the `summary-log.tsx` caller already chooses it); reserve magenta
   for a timeline that actually shows pending items.
3. **Needs-action rows** (`components/needs-row.tsx`): `bg-yellow-wash` for
   reflections vs `bg-drifting-wash` for projections — entity coding in the
   status channel. Rule: §4 entity identity is not accent; status means the same
   thing everywhere. Make both neutral (`bg-surface-2` tile or none); status
   washes only when the row's item genuinely is drifting/stale.
4. **Caught-up banner** (`components/caught-up-banner.tsx`): off-system on five
   counts. Rules: §3 (no `text-white`; `fg-1` on tokens), §5 radius (no
   `rounded-[10px]` tile), §3 accent tiers (border at `edge` alpha, not full
   `stable`), §2 roles (18px/12.5px → `card-title` / `body-sm`). Rebuild it as a
   §7 hero-ish card: `stable`-tinted wash + edge border, square icon tile,
   role-based type.
5. **Type pass**: the two arbitrary sizes (e.g. `metric.tsx`'s `text-[28px]`)
   → nearest §2 role; if a metric size is genuinely missing from the scale,
   that's a rule conversation (README loop step 4), not an arbitrary value.

## Review

Dashboard front page: no magenta anywhere unless something is pending; the
banner sits flat and hard-edged; needs-action rows read neutral until stale.
Compile check: `npx tsc --noEmit` in `app/`.
