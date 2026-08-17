# 17 — Cleanup (last; only after every screen step is checked off)

Dead code and dead tokens. Rule: §8's token inventory and DESIGN.md generally —
nothing should exist in the token file that the doc doesn't describe, and vice
versa. Low visual risk, but do it in one reviewed commit so a mistake is easy to
revert.

## Changes

In `app/src/index.css`:
- Delete dead tokens (zero call sites, verified during the audit): `--chrome-titlebar`,
  `--chrome-sidebar`, `--chrome-sidebar-collapsed`, `--chrome-utilitybar`,
  `--space-1…12`, `--ease`, `--duration-1…4`, `--shadow-overlay`, `--bg-inset`,
  `--weight-medium`, `--weight-semi`, `--weight-bold` (check first — the
  weight vars may have gained users), `--tracking-caps`, `--leading-display`,
  `--leading-body`.
- Delete the legacy t-shirt scale (`--text-xs…3xl`) **only if** steps 07–16
  removed every use (`grep -rE 'text-(xs|sm|base|md|lg|xl|2xl|3xl)\b' app/src`
  — mind that `components/ui` also uses them; those were migrated in step 04 or
  are dead files).
- Keep `clip-mark` — §6 reserves it for a future vector mark.
- Rename `--yellow-line` → `--yellow-edge` if it survived the accent work
  (§3 tier naming), or delete it if nothing yellow remains outside Chat's
  section tiers.

Elsewhere:
- Delete `app/src/assets/brand/colors_and_type.css` (un-imported, old Geist
  system — see `.agents/bugs/debt-2026-08-17-stale-unimported-colors-and-type-css.md`).
- Delete `app/src/components/ui/card.tsx` if still unimported, and any other
  `components/ui/*` file with zero importers (check each with grep before
  deleting).
- Fix `ThemeProvider`'s dead default `theme: "light"`
  (`providers/theme-provider.tsx`) to `"dark"`.
- Sweep the ~149 no-op `rounded-md/lg/xl/sm` classes (they render as 0; removing
  them is textual honesty per §5). Mechanical find/remove — but skip
  `components/ui` files that are stock-shadcn and unused, which are being
  deleted anyway.
- `components/kalaido/text.tsx`: `Mono` default `text-xs` → `text-mono-sm`
  (same rendered values; token honesty).

## Review

No visual change at all — Sara flips through Dashboard, Chat, Projections
Review, Settings, Onboarding and confirms nothing moved.
Verification: `npx tsc --noEmit` in `app/`, and the app boots.
