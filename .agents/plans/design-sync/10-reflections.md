# 10 — Reflections

Screens: `features/reflections/pages/{Reflections,NewReflection}.tsx`,
`features/reflections/components/*`.

## Changes

1. **Type pass**: ~14 arbitrary `text-[Npx]` values → §2 roles (README map).
2. **Section accent check**: after step 02 this section is green — active/selected
   states, the detail panel's commit button stays magenta (§4), the refresh card
   (`components/refresh-card.tsx`) is a staleness surface → `drifting` tokens if
   it uses yellow.
3. **Panels**: widths (322/340/240/280) are legal per §6 ("width per its
   content, 280–340px typical") except the 240px one in
   `reflection-detail-panel.tsx` — nudge to 280px or ask Sara; add `bg-1` only
   where the panel should read as furniture (§6) — Sara judges per panel.
4. **Compact cards** at `p-3.5` are now the documented 14px — no change.

## Review

Reflections list + detail + new-reflection flow in green. Magenta only on the
pending/commit affordances.
Compile check: `npx tsc --noEmit` in `app/`.
