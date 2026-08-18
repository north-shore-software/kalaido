# 18 — Cleanup (last; only after every screen step is checked off)

Dead code and dead tokens. Rule: §8's token inventory and DESIGN.md generally —
nothing should exist in the token file that the doc doesn't describe, and vice
versa. Low visual risk, but do it in one reviewed commit so a mistake is easy to
revert.

## Changes

In `app/src/index.css`:
- Delete dead tokens (zero call sites, verified during the audit): `--chrome-titlebar`,
  `--chrome-sidebar`, `--chrome-sidebar-collapsed`, `--chrome-utilitybar`,
  `--space-1…12`, `--ease`, `--duration-1…4`, `--shadow-overlay`, `--bg-inset`,
  `--weight-medium`, `--weight-semi`, `--weight-bold` (their only users are
  inside `colors_and_type.css`, deleted below), `--tracking-caps`,
  `--leading-display`, `--leading-body`.
- Delete the legacy t-shirt scale (`--text-xs…3xl`) **only if** steps 07–16
  removed every use (`grep -rE 'text-(xs|sm|base|md|lg|xl|2xl|3xl)\b' app/src`
  — mind that `components/ui` also uses them; those were migrated in step 04 or
  are dead files).
- Keep `clip-mark` — §6 reserves it for a future vector mark.
- Delete `--yellow-line` and StatusPill's `yellow` kind
  (`components/kalaido/status-pill.tsx`) — batch 2 removed the last
  `kind="yellow"` call site, so both are dead.

Elsewhere:
- Delete `app/src/assets/brand/colors_and_type.css` (un-imported, old Geist
  system — see `.agents/bugs/debt-2026-08-17-stale-unimported-colors-and-type-css.md`).
- Delete `app/src/components/ui/card.tsx`, `ui/menubar.tsx` and
  `ui/navigation-menu.tsx` — all three verified zero-importer. Menubar and
  navigation-menu still carry `shadow-md ring-1` (never reskinned in step 04);
  deleting beats reskinning dead code. Check any other `components/ui/*` file
  with grep before deleting it too.
- Fix `ThemeProvider`'s dead default `theme: "light"`
  (`providers/theme-provider.tsx`) to `"dark"`.
- Sweep the ~105 no-op `rounded-md/lg/xl/sm` classes (they render as 0; removing
  them is textual honesty per §5). Mechanical find/remove — but skip
  `components/ui` files that are stock-shadcn and unused, which are being
  deleted anyway.
- `components/kalaido/text.tsx`: `Mono` default `text-xs` → `text-mono-sm`
  (same rendered values; token honesty).

## Review

No visual change at all — Sara flips through Dashboard, Chat, Projections
Review, Settings, Onboarding and confirms nothing moved.
Verification: `npx tsc --noEmit` in `app/`, and the app boots.
