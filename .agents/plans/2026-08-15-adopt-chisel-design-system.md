---
title: "Adopt the chisel design system across the app shell and screens"
status: "draft"
author: "claude"
created: "2026-08-15"
---

**Scope**: retrofit the existing React app onto the design system recorded in
`app/DESIGN.md`, which was extracted verbatim from the visual mocks for *Review new
snapshot* and *Manage Kalaidoscopes*. Eight slices, each independently reviewable. Slice 7
contains the only functional (non-cosmetic) work.

**Status of the source**: the mocks are a statement of intent, not an implementation to
port. They are a design-doc canvas — inline styles against a `--k-*` variable sheet, two
screens, no interaction states beyond hover. Everything they show is treated as
specification; everything they do not show is extrapolated from the rules in `DESIGN.md`
and called out as extrapolation where it matters.

## Context

The app is stock `base-sera` shadcn on Tailwind v4 — rounded corners, soft shadows, Geist
and Playfair, a neutral token palette. The mocks describe something else: zero radius, 1px
hairlines, chamfered primary actions, hard offset shadows, a serif display face against a
grotesque body face with a mono face doing all labelling, and two accents that carry
meaning rather than decoration.

The migration is cheaper than it looks. The codebase already runs a four-layer token
indirection — raw palette → semantic (`--bg-0..3`, `--fg-1..4`, `--border-subtle/strong`)
→ shadcn aliases → `@theme` utilities — and the app leans on the custom middle layer
heavily: `border-line` appears 132 times, `text-fg-*` 123, `bg-surface-*` 34. The mocks'
three accents map onto the existing `action`/`truth`/`ingest` triad with the same
semantics, and `Button variant="commit"` is already `bg-truth`, which is the mocks' magenta
primary. The mocks' eleven greys fit the existing twelve-slot `--gray-*` ramp exactly.

So the bulk of this is a value swap in `:root` and `.dark`, not a rewrite of call sites.

Both mocked screens exist. `ProjectionReview.tsx` is already three columns plus a context
panel, a refine-chat panel, and Approve / Approve-and-next actions — cosmetic work only.
`kalaidoscopes-section.tsx` is 31 lines against a mock showing an active-scope card, a
grouped local-scope list with paths and switch actions, and a PocketBase configuration
panel. That gap is section 8.

## Decisions already taken

1. **No light theme.** The system is built on a dark ground — `#16171a` text on solid
   accents, alpha fills at 0.04–0.14 that only read against dark surfaces — and does not
   transpose. The mechanism stays wired so it cannot rot: `ThemeProvider`, `theme.ts`,
   `AppearanceSection` and `ThemeToggle` all remain mounted and functional, `:root` carries
   a mechanically inverted palette that never ships, and the Appearance nav entry and
   toggle are hidden with CSS rather than deleted.
2. **Accents rename to colour names.** `action`/`truth`/`ingest` → `cyan`/`magenta`/
   `yellow`, so the code reads like the mock and `DESIGN.md` needs no translation table.
   Costs a mechanical rename across ~300 call sites; bought deliberately.
3. **`DESIGN.md` is plain markdown with values inline.** No drift-check script. It will rot
   if nobody maintains it; that risk was accepted in exchange for one readable palette.
4. **Manage Kalaidoscopes is built only as far as the backends reach.** Switch-to, paths,
   grouping and the active-scope card all have working code to reuse. The two PocketBase
   configuration actions render disabled pending a product spec.

## 1. Slice 0 — fonts

Cannot run in the Linux container; `node_modules` is the macOS install and the container's
copy is a stale snapshot that does not see new packages.

```
pnpm add @fontsource-variable/archivo @fontsource-variable/jetbrains-mono @fontsource/instrument-serif
pnpm remove @fontsource-variable/noto-sans @fontsource-variable/playfair-display
```

`noto-sans` and `playfair-display` are imported nowhere and are safe to drop immediately.
`geist` and `geist-mono` are imported at `index.css:4-5` and must survive until section 2
rewrites those lines.

Registered families, confirmed from the installed packages: `'Archivo Variable'`,
`'JetBrains Mono Variable'`, `'Instrument Serif'`.

Entry points: Archivo `/wght.css` (it ships `wght`, `wdth`, `standard` and italic variants;
the mock pins `font-stretch: 100%`, so the weight axis alone is correct and smallest),
JetBrains Mono `/wght.css`, Instrument Serif `/400.css` and `/400-italic.css`. If Archivo
renders condensed, switch it to `/standard.css`.

## 2. Slice 1 — token values

`src/index.css` only. Token *names* do not change in this slice, so every existing call site
keeps working and the diff is purely a value swap. Verifiable by looking at any screen.

- Re-author `--gray-0..10` to the mocks' hex ramp (`DESIGN.md` §3). The current ramp is warm
  `oklch(L% 0.005 90)`; the mocks' is cool. `--gray-11` becomes spare.
- Remap `.dark` onto the new ramp: `--bg-0..2` ← `gray-1..3`, `--fg-1..4` ← `gray-10..7`,
  `--border-subtle` ← `gray-4`, `--border-strong` ← `gray-5`, accent foregrounds ← `gray-0`.
- Add `--fg-5` (← `gray-6`) and expose it as `--color-fg-5`. The mocks use five text levels;
  the app has four.
- Collapse `--bg-3` onto `--bg-2`. The mocks define three surfaces, not four. Do not invent
  a fourth.
- Retune the accents to `DESIGN.md` §3: base values, `-wash` to the mocks' 0.12/0.14 fill
  (it keeps its name and role, only the value moves), and two new tiers `-edge` (0.4/0.45,
  for borders) and `-veil` (0.04/0.05, for hero-card fills). Alias `-ink` to base — the
  mocks use the accent directly as text on its own wash.
- Invert the accent foreground: `--accent-truth-fg` currently resolves light; the mocks put
  `#16171a` on solid magenta.
- Retune status: `stable` → `#22d3ee`, `drifting` → `#f5d90a`, `critical` → `#ff5a3c`.
- Zero `--radius` and `--radius-sm/md/lg/xl/2xl/3xl/4xl`. **Keep `--radius-full: 9999px`** —
  the mocks' 5px status dots are circles.
- Swap the font stacks; add `--font-display`; point `--font-heading` at Archivo.
- Add the type roles from `DESIGN.md` §2 to `@theme` as `--text-*`. These are **additive**.
  The existing t-shirt scale stays for the thirteen features that have no mock and is
  deprecated in place; screens adopt roles as they are restyled. Renumbering `--text-base`
  from 14px to 13px would shift every unmocked screen and is not done.
- Add `--shadow-magenta` and `--shadow-cyan`, and `@utility clip-chamfer` / `clip-mark`.
- Derive the never-shipped light palette in `:root` by inverting the ramp.
- Remove the Geist imports and the two dead font packages' traces.
- Preserve the unlayered `[data-slot="sidebar-container"]` block at the end of the file — it
  sits outside `@layer` deliberately, to outrank Tailwind utilities. Moving it breaks the
  sidebar geometry.

## 3. Slice 2 — accent rename

`action` → `cyan`, `truth` → `magenta`, `ingest` → `yellow`, across `@theme` and roughly 300
call sites in `features/`, `components/kalaido/` and `button.tsx`'s `commit` variant.

Visually a no-op, so it reviews as a rename and nothing else. This is why it follows the
value swap rather than preceding it: each slice then carries exactly one kind of risk.

Watch for two things. The unsuffixed keys `--color-cyan` and `--color-yellow` coexist with
Tailwind's built-in `cyan-*`/`yellow-*` scales; they are distinct keys and legal, but
`tailwind-merge` is unconfigured (v3.5.0) and `cn()` deduping across the two groups should
be spot-checked. And `--color-ingest-line` needs a name that survives the rename without
colliding with `--color-line`.

## 4. Slice 3 — primitives

`src/components/ui/`. The library is `base-sera`, not stock Radix shadcn — most components
wrap `@base-ui/react` primitives and five use the `useRender`/`mergeProps` polymorphism API.

- `button.tsx` — tracking `0.06em`, not `tracking-widest` (0.1em). Mock paddings (10px/14px
  default, 7px/12px small) replace `h-10 px-6` / `h-9 px-4`. Icon gap 8px, not `gap-1.5`.
  The `commit` variant gains `clip-chamfer` and `shadow-magenta` and flips to dark
  on-accent text.
- `badge.tsx` — currently text-only (`border-0 bg-transparent px-0 py-0`). Becomes the
  mocks' bordered pill: 1px border, wash fill, 3px/6px padding, `pill` type role. The
  state/type pill distinction in `DESIGN.md` §7 becomes two variants.
- `card.tsx` — `ring-1 ring-border` → a real 1px border, zero radius. `CardTitle` drops
  `font-heading uppercase tracking-wider` for the `card` role (16px/700/-0.01em, not
  uppercase).
- `label.tsx` — the `label` role. This file sets the uppercase language for the whole app,
  so changing its tracking from `tracking-wide` to `0.14em` moves a lot at once.
- `input.tsx`, `textarea.tsx` — the underline treatment (`border-b-input`) is not in the
  mocks; the container owns the edge and the field is bare.
- `tooltip.tsx` — zero radius; the inverted `bg-foreground` surface needs rechecking against
  the new ramp.
- Unify the two competing focus idioms: `ring-2 ring-ring/30 border-ring` (Button, Switch,
  Toggle) versus `ring-[3px] ring-ring/50` (Badge, Tabs, Item, ScrollArea).

No Ladle stories exist for `components/ui/`. The closest harness is
`components/kalaido/*.stories.tsx` — chip, pill, status-pill, segmented, surface-card,
list-row, text — which exercise these primitives indirectly.

## 5. Slice 4 — app shell

- `nav-sidebar.tsx` and `sidebar.tsx` — rail items become 28px boxes with 16px icons
  (`sidebarMenuButtonVariants` currently forces `size-5`). The active marker changes from a
  background fill to `border-left: 2px` in the accent. `SIDEBAR_WIDTH_ICON` is already
  `3rem`, which matches.
- `page-chrome.tsx` — `PageHeader` gets `crumb`-role breadcrumbs (mono, 10px, `0.12em`,
  `fg-4`, `fg-5` separators, magenta final segment), a 36px Instrument Serif title in place
  of `text-lg font-semibold`, and 16px/20px padding in place of `px-6 py-3 min-h-[60px]`.
  `PaneHeader` is already `h-11` (44px) and needs only the label recipe.
  Keep the existing behaviour where `PageHeader` prepends the active kalaidoscope's
  `displayName` to the crumb trail.
- `utility-bar.tsx` — `mono-sm` metadata, `line` top border. Status dots go from `size-1.5`
  (6px) to the mocks' 5px.

## 6. Slice 5 — Review new snapshot

`ProjectionReview.tsx` and `snapshot-compare-pane.tsx`.

- Column headers to the mocks' two recipes: a dotted `label-mono` for *current*, a bordered
  magenta pill for *pending*.
- The pending column gains `magenta veil` fill and `inset 3px 0 0` magenta left edge; its
  header underline becomes `magenta edge`. Body text brightens to `fg-1` against the current
  column's `fg-2` — the candidate reads brighter than what it would replace.
- Body rhythm: 20px padding, 16px block gap, `body` role (14.5px/1.62, `text-wrap: pretty`).
- Context panel 340px → 300px.
- The refine composer's send button becomes the 26px chamfered control with the armed cyan
  state described in `DESIGN.md` §7.

Preserve, untouched: the force-remount on `id` change, the auto-redirect to the newest
pending candidate, and the three body states (compare / advancing / not-found).

The mocks show a compact scope selector where the app has `ContextPicker`, a fuller
item-list picker with chips and an "Everything" fallback. Restyle the picker; do not
reshape it. If the mock intends a different control, that is a product change and needs its
own decision.

## 7. Slice 6 — Settings shell

`Settings.tsx` renders its own two-pane layout and does not use `PageLayout`, so it has no
nav rail, no page header and no utility bar.

- Nav 192px (`w-48`) → 216px; items to 8px/10px padding with a 2px `border-left` active
  marker over a cyan wash, replacing the current background fill.
- Main pane `p-8` → 32px/32px/48px at max-width 1000px.
- Hide the `appearance` entry and the `ThemeToggle` with CSS. Both stay mounted and wired.
- The mocks order Manage Kalaidoscopes first; the app lists it third.

## 8. Slice 7 — Manage Kalaidoscopes

The only slice with functional work. Currently `kalaidoscopes-section.tsx` (31 lines) maps
every workspace to an identical `KalaidoscopeRow` showing a name and, when active, a pill.

Build:

- The active scope splits into its own hero card above the list — cyan `edge` border, cyan
  `veil` fill, `shadow-cyan`, `card`-role title, mono slug, state and type pills.
- The remainder group under a "Local scopes" `label` with a count in `fg-5`.
- Rows gain the locator path (`mono-sm`, `fg-4`, ellipsis-truncated) and a type pill.
- A "Switch to" small ghost button per row.
  `create-kalaidoscope/components/kalaidoscope-list.tsx` already implements exactly this —
  `switchLocalKalaidoscope(id)` with a `switching` guard and an `excludeId` prop — and is
  the reference. `nav-kalaidoscope-switcher.tsx` is a second existing caller.

Render disabled, pending a spec: "In-scope configurations" and "PocketBase schema &
backups". The mocks also show a live connection status row ("Active & Running"); wire it
only if a real signal exists, otherwise omit it rather than hardcode a green light.

Once the path is visible here, the note at `utility-bar.tsx:17-20` records that the locator
can leave the utility bar. **That removal is not part of this slice** — it is a separate
change with its own review.

## 9. Verification

Only `npx tsc --noEmit` and `node scripts/check-navigation-discipline.mjs` run in the
container. Everything else is macOS-side.

- `npx tsc --noEmit` after every slice.
- `pnpm ladle` — fastest visual check, with the `components/ui/` gap noted in section 4.
- `pnpm dev` — open Review new snapshot and Settings › Manage Kalaidoscopes beside the mocks
  and check against the dimension tables in `DESIGN.md` §6.
- Toggle the rail with `Cmd/Ctrl+B`. Collapse styling is entirely
  `group-data-[collapsible=icon]:*` descendant rules and is easy to break.
- Confirm the theme mechanism still works with its UI hidden: set `localStorage.theme` to
  `light` and verify `ThemeProvider` applies it.
- `pnpm test`, `pnpm check:routes`, `pnpm check:nav`, `biome check`, `pnpm build`.

## 10. Known defects, not addressed here

Eight defects were found while surveying and are filed individually in `.agents/bugs/`
(2026-08-15). Three touch files this plan edits and are deliberately left alone:

- the anti-flash script in `index.html` reads a localStorage key nothing writes;
- `sonner.tsx` reads its theme from an unmounted `next-themes` provider;
- `index.css` names two design source files that do not exist — section 2 could update that
  comment to `app/DESIGN.md`, but the rest of the fix is not in scope.
