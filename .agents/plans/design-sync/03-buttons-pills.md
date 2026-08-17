# 03 — Buttons and pills

**Rules being applied:** §7 Buttons (five variants, sizes); §7 Pills;
§3 accent tiers (edge alpha).

## Changes

1. `app/src/components/ui/button.tsx`:
   - Delete the `link` variant (dead — zero call sites; §7 doesn't define it).
   - Keep `default` (ghost), `outline`, `commit`, `ghost` (text), `destructive`,
     `secondary` — all now documented in §7. No recipe changes expected; verify
     each matches its §7 paragraph and fix any drift.
   - Focus ring should already follow the section accent via `--ring` (step 02) —
     verify.
2. `app/src/components/kalaido/status-pill.tsx`:
   - Replace hand-rolled `border-cyan/45` (and friends) with the `*-edge` tokens
     (§3: edge = 0.40–0.45; the token is the source of truth). Cyan kind may now
     be rare — most former cyan state pills become section-accented via `Pill`.
3. `app/src/components/kalaido/pill.tsx`:
   - Add the 10px icon constraint (§7: "A pill may carry a 10px leading icon") —
     same pattern `ui/badge.tsx` uses (`[&>svg]:size-2.5`).

## Review screen

**Projections list** (ghost/outline/commit side by side) and **Settings › Manage
Kalaidoscopes** (pills, hero card). Buttons elsewhere are the same components —
tell Sara any screen with buttons is fair game for spot-checks.

Compile check: `npx tsc --noEmit` in `app/`.
