# DESIGN.md ↔ implementation diff list

## Context

The kalaido app went through a full re-skin. `/code/kalaido/app/DESIGN.md` and the
implementation have drifted, and **neither side is authoritative**. This plan's
deliverable is a neutral diff list; Louis rules on each item (or each group), then
the losing side gets fixed. No fixes have been made yet.

Audit coverage: `index.css` read directly; three parallel audits over all ~180
non-vendored `.tsx` files (chrome/layout, component recipes, accents/type).

**How to adjudicate:** each diff has an ID. Reply per item or per group with
"doc" (code changes to match doc), "code" (doc changes to match code), or a third
ruling. Group-level rulings are fine — e.g. "Y-group: doc wins".

---

## Group S — Accent semantics (highest stakes)

- **S1. Yellow's meaning.** Doc §4: yellow = local/offline only, never a general
  highlight. Code uses yellow for: "Available" pill (`Connections.tsx:77`), counts
  (`active-rotation-card.tsx:60,65`), stale/refresh state
  (`projection-side-rail.tsx:72`, `projection-card.tsx:22`), a loading pill
  (`Stream.tsx:70`), entity-type coding (`needs-row.tsx:30-36`), a decorative left
  rule on every fragment card (`fragment-card.tsx:29`, `stream-parts.tsx:45`), and
  the "source" tone in the context picker. Meanwhile the one literal "Local" label
  (`nav-kalaidoscope-switcher.tsx:64`) is *not* yellow.
- **S2. Magenta as decoration.** Doc §4: magenta only when a decision is required.
  Code: `pin-card.tsx:16` uses magenta ink to distinguish projection-vs-reflection
  (pure type-coding); `timeline.tsx:22` defaults its tone to magenta for snapshot
  *histories* (nothing pending).
- **S3. Cyan redefined for Capture.** Doc §4: cyan reports state, never asks; the
  shell reports position only. Code comment `nav-sidebar.tsx:78-81` asserts a
  different semantics — cyan on the Capture button means "this makes something".
- **S4. A third chamfered element.** Doc §5: chamfer on exactly two things (primary
  button, chat send). Code has a third: the cyan "Auto-segment my scope" button
  (`resolution-readout.tsx:207`) — chamfered, solid cyan, inside a dialog. Bonus
  bug regardless of ruling: it uses `shadow-cyan` (a box-shadow) on a clipped
  element, which §5 explains renders **nothing** — the exact bug the doc predicts.
- **S5. Danger for warnings.** Doc §4: danger = destructive only. Code:
  critical for "over token budget" (`resolution-readout.tsx:64-76`) and for
  removed diff lines (`diff.tsx:23`, paired with stable for adds).
- **S6. Active nav items take an accent fill.** Doc §6 specifies only a 2px left
  border for active rail/settings items. Code additionally applies `bg-cyan-wash`
  + accent ink + semibold (`sidebar.tsx:462`, `Settings.tsx:56-60`; Danger Zone
  gets a critical variant).


Core change. The accent system keeps its two independent channels but the position channel becomes per-section. Each area of the app (chat, projections, reflections, …) gets
its own hue, which plays the role cyan plays today: active rail border, selected/active items, armed send button, state pills, hero cards. The user always knows where they
are because the page is tinted with its section's colour.

The guardrail. Magenta is never a section hue. It stays reserved app-wide for "a decision is waiting" — pending columns, pending pills, the one chamfered commit button per
screen. That signal only works if magenta means the same thing on every page, especially the pages where review actually happens. Danger likewise stays reserved for
destructive actions. So the final model is:

- Section hue — position and state; varies by where you are
- Magenta — demand; constant everywhere
- Danger — destructive; constant everywhere

Consequences accepted:

1. Cyan demotes from "the system accent" to just one section's hue. Current cyan-everywhere elements (API pill, selection, focus ring, "Active & Running") follow the section
   hue rather than staying a third constant channel.
2. Yellow-for-chat collides with status-drifting (identical hex today), so drift/staleness gets moved to its own distinct colour — the section→hue map decides this.
3. Hues are drawn from the content palette (--content-1…8), accepting that a section hue and an entity swatch may coincide on screen.

Mechanism. A --section-accent token (plus wash/edge/veil/fg tiers) set per-route at the layout level; the ~6 primitives that hard-code cyan (sidebar active, pill primary,
composer armed state, settings nav, hero card, focus ring) re-point to it. Var-swap plus a hue map — not a repaint of every screen.

Interaction with the S-group rulings: this supersedes S1–S3 (yellow's meaning, magenta decoration, cyan Capture). Still standing from earlier discussion: S4 (de-chamfer the
auto-segment button), S5 (danger only for destructive/blocking; diff add/remove colours sanctioned as convention), S6 (keep the active-nav accent fill, now in section hue,
and document it).

First slice for review: DESIGN.md §3/§4 rewrite plus the proposed section→hue map — doc only, so you can tune assignments (which section gets yellow, what drift becomes)
before any code is repainted.

## Group T — Type

- **T1. Display letter-spacing.** Doc §2: `-0.015em`. Code `index.css:213`: `0em`.
  Single call site, no override — shipped titles are tracked at 0.

use 0

- **T2. Page titles off-spec on 5 routes + Settings.** Doc: exactly one serif
  `display` title per screen, never bold. Code: onboarding-landing/-login,
  cloud-workspaces, kalaidoscope-setup (which has *two* identical headings), and
  boot-error all use Archivo semibold t-shirt sizes; **Settings has no page title
  at all** (sections use `card-title` h2s).

fix all to match the doc

- **T3. Deprecated scale dominates ~8 screens.** Doc §2 presents the roles as the
  system with no exceptions. Code: `index.css` keeps a "legacy t-shirt scale…for
  screens that have no mock yet"; onboarding ×3, kalaidoscope-setup, import,
  connections, chat, boot are 100% t-shirt; plus **68 arbitrary `text-[Npx]`**
  values (many near-misses of real roles, e.g. `text-[13.5px]` where `text-row`
  exists) concentrated in projections/reflections/rotation.

remove deprecatd things

- **T4. Off-system tracking.** 49 uses of Tailwind's default `tracking-wide(r/st)`
  (0.025/0.05/0.1em) — none is a system value; `--tracking-caps: 0.08em` exists
  and is used zero times.

fix this to align with best pracrises

- **T5. Undocumented `font-heading` overlay role.** `--font-heading` (= Archivo,
  `index.css:202`) is live on 5 shadcn overlay titles as a 20px uppercase heading
  role that appears nowhere in §2.

document it

- **T6. Micro-label split violations.** "Local" storage-state label uses the
  Archivo `Label` at an off-scale 9px (`nav-kalaidoscope-switcher.tsx:64`); doc
  says data-state labels are mono 10px. Also doc lists `label-mono` as a separate
  role; code deliberately merged it into `--text-label` (13 tokens, not 14).

fix to match spec

## Group C — Component recipes

- **C1. Button variants beyond the doc's three tiers.** Doc: ghost / outlined /
  primary. Code (`button.tsx`): doc-"ghost" is named `default`; a *different*
  variant named `ghost` is borderless with **fill** hover (~25 call sites — the
  2nd-most-used variant, violating the §5 hover rule); plus `secondary` (filled),
  `destructive`, `link` (dead), and sizes `xs/lg/icon-*` the doc doesn't name.
  Default height is `h-8` (32px) vs the doc's padding math (34px). Undocumented
  2px cyan focus ring on everything.

document things that are in the app that are currently undocumented. 
dedupe code if possible. 

- **C2. List row default variant contradicts the recipe.** Doc: bg-1, line border,
  hover promotes border. Code `list-row.tsx`: the *card* variant matches ✓, but
  the default `list` variant is borderless with `bg-surface-2/50` fill hover;
  title weight 500 vs doc's 600; no `···` overflow control exists anywhere in the
  app; row actions use small **outline** buttons, not ghost.

update thee spec, app wins

- **C3. Inputs own a border.** Doc §7: no border, no outline, container owns the
  edge. Code `input.tsx`/`textarea.tsx`: bottom border in `line-strong` promoting
  to cyan on focus.

document two versions - one that has a border, and one that doesn't
you'll see in the app in some palces it makes sense, in others it doesn't

- **C4. Two chat composers; the Chat route uses the wrong one.**
  `refine-composer.tsx` matches §7 exactly (26px chamfered send, cyan when armed).
  But `chat-composer.tsx` — used by ChatPanel, i.e. the actual Chat surface — is a
  plain 28px icon Button: no chamfer, no armed state, 16px padding.

use the refine one

- **C5. Dialogs/popovers not re-skinned.** Doc §5: overlays sit on bg-2 with a
  `line` border, no shadow. Code: 16 shadcn overlay components ship with blurred
  `shadow-md` + `ring-1 ring-foreground/10` + zoom/slide animations. Only 8 of 60
  `components/ui` files were re-skinned at all (radius is neutralised globally,
  shadows/rings/motion are not).

reskin the rest

- **C6. Pending column edge mechanism.** Doc §5: `inset 3px 0 0 magenta`
  box-shadow. Code `snapshot-compare-pane.tsx:29`: `border-l-[3px]` — a real
  border, so the two compare columns aren't exactly equal width. (Elsewhere the
  inset-shadow idiom *is* used — and generalised to cyan/yellow/critical in the
  context picker, which the doc reserves for pending-magenta.)

keep the app

- **C7. StatusPill edge alpha.** `status-pill.tsx:19` uses `border-cyan/45`;
  `--cyan-edge` is 0.40. (`pill.tsx` uses the token correctly.)

fix this

- **C8. Two segmented controls, two selected treatments.** `segmented.tsx` matches
  §7's note (`bg-fg-2` near-white fill) ✓; `theme-toggle.tsx:42` uses
  `bg-background + shadow-xs` instead.

make them match, your choice

- **C9. Hover fill on bordered cards.** Doc §5: bordered controls never change
  fill. Violations: `document-card.tsx:77`, `storage-option-cards.tsx:51`,
  `OnboardingLanding.tsx:188,214`, `CloudWorkspaces.tsx:176`, `icon-picker.tsx:55`.

keep the app, update the doc

- **C10. Motion violations.** Doc §5: colour-only, nothing moves. Code: chevron
  slide on hover (`Connections.tsx:83`), rotating chevrons ×4, `animate-pulse`
  skeletons ×6, spinners ×6, overlay zoom/slide animations, Splash fade
  (700–1000ms), two `transition-all`, smooth scroll in chat.

update the doc, app wins. 

- **C11. True radius violations.** Doc: zero everywhere except 5px dots. Real
  rendered radii: `rounded-[10px]` icon tile (`caught-up-banner.tsx:8`),
  `rounded-[7px]` colour swatch (`colour-detail-pane.tsx:73`), circular radios
  (`radio-group.tsx`), 24px circular index badge (`queued-rotation-row.tsx:18`).
  Also dots at 6px and 8px where doc says 5px (`sidecar-status-dot.tsx:46`,
  `ollama-status-card.tsx:22`). (The ~149 `rounded-md/lg/xl` classes all resolve
  to 0 via the token overrides — visual noise only.)

app wins, update the doc

- **C12. Blurred elevation shadow on a card.** `active-rotation-card.tsx:49`:
  `shadow-lg shadow-black/40` + `bg-card` — against "depth is surface, never
  shadow". `caught-up-banner.tsx` is similarly off-system (full-opacity `stable`
  border, `text-white`, 18px text, rounded tile).

doc wins, update the app

## Group L — Layout & chrome

- **L1. Titlebar + utility bar undocumented.** A 28px transparent Tauri drag
  titlebar offsets the whole app, and a 32px bottom utility bar (DB status +
  tok/s) ships on every PageLayout screen. Doc §6 mentions neither. Settings,
  onboarding, boot and setup routes bypass PageLayout entirely — no rail, no
  utility bar — an asymmetry the doc doesn't describe.

document them as-is

- **L2. Context panel width.** Doc: 300px, bg-1. Code: 300px+bg-1 on exactly two
  surfaces; elsewhere 240, 280, 312, 320, 322, 340, 480px — usually with no bg-1
  fill.

context panel in app wins

- **L3. Pane header horizontal padding.** Doc: 44px tall, 20px horizontal (16px in
  panels). Code `PaneHeader`: 16px unconditionally, used for main columns too;
  only `snapshot-compare-pane` hand-rolls the 20px variant.

app wins

- **L4. Content area 20px/16px is a minority convention.** `PageBody` (p-5, no
  gap) is used by 3 pages; everything else hand-rolls 24–32px padding and
  20–24px gaps; Rotation centres at 680px.
- **L5. Compact card padding.** Doc: 12px. Code: 14px (`p-3.5`) in every real
  compact card (the only 12px one is in the un-imported `ui/card.tsx`).
- **L6. List gap.** Doc: 8px between rows/cards. Code: held once; elsewhere 4, 6,
  10, 12, 16px.
- **L7. Panel body copy max-width.** Doc: 660px. Code: 660 appears nowhere —
  640px (snapshot preview ×5) and 680px (rotation) do.
- **L8. Settings nav padding.** Doc: 14px/10px. Code: `p-3` = 12px all round.
  (Width 216px, gap, item geometry all match.) Undocumented: leading "Back"
  button, Danger-Zone critical treatment.
- **L9. Rail top padding.** Doc: 12px vertical. Code: 16px top (NavSidebar
  override) / 12px bottom.
- **L10. Rail expanded is reachable.** Doc §6: "expanded is unreachable in the
  shipped UI". Code: ⌘B global listener still expands it and persists the choice.
  The toggle-hiding CSS matches the doc; the shortcut contradicts it. A code
  comment (`nav-sidebar.tsx:159-163`) also still describes the toggle as visible.
- **L11. Logo mark.** Doc: 24px, `clip-mark`, fg-1. Code: a raster PNG
  (`brand.tsx`) at 20–28px depending on site, `dark:invert` (pure white), no
  clip. `clip-mark` utility has zero call sites.
- **L12. Kalaidoscope switcher breaks the square-rail-item rule.** 60×56 (h-14,
  no aspect-square) with an off-scale 9px label.

your call for all of the above - make the app and doc consistent

## Group I — Icons

- **I1. Stroke width.** Doc: 1.5 structural, 2 for checks/chevrons. Code: 1.5 in
  exactly two places (rail icons + one inline SVG); everything else ships
  Lucide's default 2; checks are 2.2/2.4.

sidebar is corect in app, don't change. update the rest to follow doc. 

- **I2. 15px (panel/card titles) and 13px (section labels) icon sizes exist
  nowhere in code.** Unimplemented/unexercised.
- **I3. Pill icon size.** `badge.tsx` enforces 10px ✓; the system's own `Pill`
  component sets no icon size.

your pick for the above

## Group K — Tokens: index.css vs doc

- **K1. Spacing rhythm.** Doc §6: 2,4,5,7,8,10,12,14,16,20,24,32,48 — "not a
  doubling scale". Code `--space-1…12`: 4,8,…,96 — a doubling-ish scale. Dead
  (zero call sites; real spacing is Tailwind's 4px scale), but the token file
  contradicts the doc.
update the doc, app wins

- **K2. Yellow tiers + status washes.** Code has `--yellow-wash`, `--yellow-line`
  (breaking the `edge` naming convention) and `--status-{stable,drifting,critical}-wash`
  — all live, none in the doc's tables.
- **K3. Content palette.** `--content-1…8` (oklch) feeds `ColourSwatch` on 11
  screens — an entire second palette absent from the doc. Its comment ("reads on
  either theme") also contradicts §9's "does not transpose".
- **K4. Surface count.** Doc §3: "Three levels." Code: `--bg-3` is live
  (`bg-surface-3` in 4 files); `--bg-inset` exists (dead).
- **K5. `--gray-11`.** Doc: "spare; the system does not use it" (no value given).
  Code: defined as #ffffff; no `gray-11` utility use, but `caught-up-banner.tsx:9`
  uses raw `text-white`.
- **K6. Extra durations.** Doc: single 120ms rule. Code adds
  `--duration-1/3/4` (90/200/400ms) — dead — while shadcn overlays actually
  animate at 100–350ms with foreign easings.
- **K7. `::selection`** — global cyan/dark selection, undocumented (semantically
  consistent with §4).

## Group E — Doc internal errors (doc is simply wrong about the code; no real choice)

- **E1.** §8 maps `--k-on-accent` → `--cyan-fg`/`--magenta-fg`; actual tokens are
  `--accent-cyan-fg`/`--accent-magenta-fg`, utilities `*-foreground`.
- **E2.** §8 lists a `shadow-magenta` utility; it doesn't exist and contradicts
  §5's own (correct) `drop-shadow-magenta`.

fix these

## Group H — Hygiene / dead code (cleanup, likely no ruling needed)

- Dead tokens: `--chrome-*` (contradict live values), `--space-*`, `--ease`,
  `--duration-*`, `--shadow-overlay` (blurred — contradicts §3 by existing),
  `--bg-inset`, `--weight-medium`, `--tracking-caps`, `--leading-display/body`.
- Dead code: `clip-mark` utility, `ui/card.tsx` (zero importers), `link` button
  variant, un-imported stale file `src/assets/brand/colors_and_type.css` (old
  Geist system, conflicting values).
- Stale comment: `nav-sidebar.tsx:159-163` describes the hidden toggle as visible.
- `ThemeProvider` default context `theme: "light"` (dead, misleading).
- ~149 no-op `rounded-*` classes that resolve to 0.
- `Mono` primitive defaults to deprecated `text-xs` instead of `text-mono-sm`
  (same computed values).

do the cleanup

## Confirmed matches (no action)

Greys/surfaces/fg/hairlines/cyan/magenta values; chamfer polygons; shadow token
values; §8 mapping (except E1/E2); rail 76px/squares/8px stacking/26px icons;
settings nav width/geometry; page header; settings main (incl. "hugs"); segmented
control (`segmented.tsx`); pills' core recipe; two-column compare (except C6);
"one chamfered magenta button per screen" holds on all screens; cyan+magenta
never paired; light-mode mechanism (three-layer dark forcing, hidden-but-wired
Appearance) — better implemented than documented.

---

## Next steps after adjudication

1. Louis rules per item/group (doc / code / third value).
2. Apply rulings: edit DESIGN.md where code wins; edit code where doc wins —
   in reviewable slices, one group at a time.
3. Out-of-scope bugs found regardless of ruling (file as individual bugs in
   `.agents/bugs` per convention): S4's invisible `shadow-cyan`, E1/E2 doc
   errors, the stale `colors_and_type.css`, the `nav-sidebar` comment.

## Verification

After each applied slice: `npx tsc --noEmit` in `app/` (node_modules is
macOS-installed — no pnpm in this container), visual check via the running app
(HMR) for code-side changes, and re-read the amended DESIGN.md section for
doc-side changes.
