# Kalaido design system

The rulebook, extracted from the visual mocks for **Review new snapshot** and
**Manage Kalaidoscopes**. Every value here is taken from those mocks verbatim.

This document exists so screens the mocks do not cover can be built without guessing.
Where it states a value, use that value. Where it states a rule, the rule is the point —
following it matters more than matching any particular screenshot.

`src/index.css` is where these values live in code. This file explains them; that file
enforces them. If the two disagree, the CSS is what ships — fix whichever is wrong.

---

## 1. The idea in one paragraph

Hard-edged, dark, terminal-adjacent. Nothing is rounded. Depth comes from three flat grey
surfaces, never from shadow. Structure comes from 1px hairlines. Accents carry meaning
rather than decoration — each section of the app owns a hue that marks position and live
state, while magenta, constant everywhere, says *this needs you*. A serif display face
sits against a grotesque body face, and a mono face does all the labelling, so type role
is legible at a glance from shape alone.

---

## 2. Type

Three faces, three jobs. Never mix them arbitrarily.

| Family | Token | Job |
|---|---|---|
| **Archivo** | `--font-sans` | body copy, buttons, nav items, section and panel labels |
| **Source Serif 4** | `--font-display` | page titles only |
| **JetBrains Mono** | `--font-mono` | breadcrumbs, column headers, pills, paths, slugs, counts, status text |

Weights loaded: Archivo 400–900 (variable) · Source Serif 4 200–900 (variable, roman
only — the italic axis is not imported) · JetBrains Mono 400–700.

### The micro-label split

Two families do 10px uppercase labels, and which one you pick is meaningful:

- **Archivo** for labels that name a *region of the page* — section headings, panel
  headers ("Context", "Refine with chat", "Local scopes", "Active scope").
- **JetBrains Mono** for labels that name a *state of the data* — column headers
  ("Current", "Pending"), status pills, type pills, breadcrumbs.

Both use the same recipe otherwise: 10px / 600 / `0.14em` / uppercase. The distinction is
the one signal telling the reader whether a label describes the interface or the content.

### Type roles

Use these rather than a t-shirt scale. Each is a `--text-*` token with its leading baked in.

| Role | Size / leading | Weight | Tracking | Case | Family |
|---|---|---|---|---|---|
| `display` | 40px / 1.15 | 400 | 0 | none | Source Serif 4 |
| `card-title` | 18px / 1.4 | 700 | 0 | none | Archivo |
| `body` | 16px / 1.6 | 400 | 0.02em | none | Archivo |
| `row` | 15px / 1.5 | 600 | — | none | Archivo |
| `item` | 14.5px / 1.5 | 400–600 | — | none | Archivo |
| `body-sm` | 14px / 1.55 | 400 | 0.015em | none | Archivo |
| `btn` | 13px / 1 | 600–700 | 0.06em | uppercase | Archivo |
| `meta` | 12.5px / 1.45 | 400 | — | none | Archivo or mono |
| `btn-sm` | 12px / 1 | 600 | 0.06em | uppercase | Archivo |
| `mono-sm` | 12px / 1.45 | 400 | — | none | JetBrains Mono |
| `label` | 11px / 1.4 | 600 | 0.14em | uppercase | Archivo |
| `label-mono` | 11px / 1.4 | 600–700 | 0.14em | uppercase | JetBrains Mono |
| `crumb` | 11px / 1.4 | 400 | 0.12em | uppercase | JetBrains Mono |
| `pill` | 10.5px / 1.4 | 600–700 | 0.12em (0.08em on type pills) | uppercase | JetBrains Mono |
| `overlay-title` | 22px / 1.4 | 600 | 0.08em | uppercase | Archivo (`--font-heading`) |

`label` and `label-mono` share one token (`--text-label`); the family is chosen at the
call site. `overlay-title` is the heading inside dialogs, sheets and empty states — the
one uppercase heading role, and the only consumer of the `--font-heading` alias.

Long-form prose sets `text-wrap: pretty`.

There is exactly one page title per screen, in `display`. It is never uppercase and never
bold — the serif carries the weight. The pre-workspace surfaces (onboarding, boot) are
the exception: they use a centred Archivo semibold hero header beneath the glowing mark
(§5) — the serif page title belongs to the workspace shell.

---

## 3. Colour

### Greys

Eleven steps, cool-neutral. `--gray-11` (`#ffffff`) is spare; the system does not use it.

| Token | Value | Role |
|---|---|---|
| `--gray-0` | `#121315` | text on solid accent |
| `--gray-1` | `#1a1b1e` | app canvas |
| `--gray-2` | `#222327` | rails, sidebars, panels, list rows |
| `--gray-3` | `#2a2c31` | cards on panels, nav hover |
| `--gray-4` | `#36383e` | default hairline |
| `--gray-5` | `#4b4d55` | raised hairline |
| `--gray-6` | `#64666f` | breadcrumb separators, counts |
| `--gray-7` | `#84868f` | metadata, paths, rail icons, placeholders |
| `--gray-8` | `#a3a5ad` | column labels, subtitles, pill text |
| `--gray-9` | `#d6d8dd` | secondary body, inactive nav items |
| `--gray-10` | `#f5f6f8` | headings, primary body, active labels |

### Surfaces

Three levels. **Depth is surface, never shadow.**

| Level | Value | Used for |
|---|---|---|
| `bg-0` | `#1a1b1e` | the canvas — content columns, page body |
| `bg-1` | `#222327` | anything attached to an edge — rails, sidebars, context panels, nested panels, list rows |
| `bg-2` | `#2a2c31` | anything sitting *on* `bg-1` — cards, popovers, nav hover |

A card on the canvas uses a border, not a fill. A card on a panel uses `bg-2`.

A fourth utility, `bg-surface-3`, exists and currently resolves to the same value as
`bg-2`; it marks call sites that want the next step up if one is ever introduced.

### Text

| Level | Value | Used for |
|---|---|---|
| `fg-1` | `#f5f6f8` | headings, primary body, active labels |
| `fg-2` | `#d6d8dd` | secondary body, ghost button labels, inactive nav |
| `fg-3` | `#a3a5ad` | column labels, subtitles, panel copy, pill text |
| `fg-4` | `#84868f` | breadcrumbs, metadata, paths, rail icons, placeholders |
| `fg-5` | `#64666f` | breadcrumb separators, counts |

### Hairlines

| Token | Value | Used for |
|---|---|---|
| `line` | `#36383e` | the default — panel edges, row borders, header underlines |
| `line-strong` | `#4b4d55` | raised — card borders, button borders, dashed affordances |

### Accents

One accent varies, one is constant. Each section of the app owns a hue — the **section
accent** — that plays the same role on every screen: where you are, what is selected,
what is live. Magenta never varies. Danger (§ Status) never varies.

The tier recipe applies to whichever hue the section owns:

| Tier | Section accent (any hue) | Magenta (constant) |
|---|---|---|
| base | the section's hue | `#ff2e93` |
| `wash` — tinted fill | base at 0.08 | `rgba(255,46,147,0.04)` |
| `edge` — border | base at 0.40–0.45 | `rgba(255,46,147,0.45)` |
| `veil` — faintest fill | base at 0.04–0.05 | `rgba(255,46,147,0.05)` |
| `fg` — text on solid | `#121315` | `#ffffff` |
| `ink` — text on wash | the hue itself | `#ff2e93` |

Text on a wash is the accent itself. There is no separate lifted ink.

Text on a *solid* section accent is `#121315` — dark. Solid Magenta and solid Danger use system white (`#ffffff`). The magenta primary button has white text.

In code the section accent is a semantic token set per route — `--section` plus its
`-wash` / `-edge` / `-veil` / `-fg` tiers — so components say `border-section-edge`, never
a hue by name.

#### Section → hue map

| Section / Shell Action | Hue | Source token |
|---|---|---|
| Onboarding · boot (pre-workspace) | brand cyan `#22d3ee` | `--cyan-base` |
| Capture (shell action) | brand cyan `#22d3ee` | `--cyan-base` |
| Dashboard | cyan `#22d3ee` | `--cyan-base` |
| Chat | yellow `#f5d90a` | `--yellow-base` |
| Projections (incl. review, rotation) | green `#4ade80` | `--green-base` |
| Reflections | violet `#c084fc` | `--violet-base` |
| Colours | blush `#fda4af` | `--blush-base` |
| Fragments | lime `#a3e635` | `--lime-base` |
| Connections (incl. import) | neutral — `fg-2` plays the accent | — |
| Settings | neutral — `fg-2` plays the accent | — |

Neutral sections use `fg-2` wherever the accent recipe calls for a hue: monochrome
emphasis, no colour. The pre-workspace surfaces are not a section — there is no
workspace yet — so they wear the brand's own cyan, including its one glow moment
(§5). Sub-routes inherit their section (rotation is a projections workflow; import
belongs to connections).

### Status

Global and orthogonal to the section accent — a status colour means the same thing on
every screen.

| Token | Value |
|---|---|
| `stable` | `#22d3ee` |
| `drifting` | `#ff9f0a` |
| `critical` / `danger` | `#ff3333` |

Each status colour also carries a `wash` tier (0.08 alpha for stable/drifting; 0.04 alpha for critical/danger).

### Content palette

Eight vivid oklch mid-tones, `--content-1…8`, colour the user's own content: the
swatch a Colour carries (`ColourSwatch`), shown wherever a Colour is the subject —
the Colours screens, pickers and @-mentions, and a fragment's drawer detail. A
fragment does *not* wear its Colour in the Stream itself: stream cards and timeline
dots take the section accent, and the Colour appears only once the drawer opens.
They are identity, not meaning: never use them for state, demand or status. They are
*per-item* identity only — what kind of thing an item is (its entity kind) is
carried by the kind's home-section hue instead (§4). Section hues are their own
dedicated tokens, not drawn from this palette.

---

## 4. What the accents mean

This is the part that governs new screens. Three channels; one varies by place, two
never do.

**The section accent is position and state.** Each section owns a hue (map in §3). On
that section's screens the hue does everything one accent used to do: the active rail
item, the selected row, the active settings entry, the armed send button, state pills,
the hero card, the focus ring, text selection. Walking from Chat to Projections, the
accent walks from yellow to violet — the page itself reminds you where you are. The
section accent is reassurance — it reports, it does not ask.

**Magenta is your decision is required.** The pending column and its badge. The inset
edge marking unreviewed content. The primary approve action. Magenta is a demand, and it
is the same demand on every screen.

**Danger is destructive.** Constant everywhere. The one sanctioned exception: diff panes
use the `stable`/`critical` washes as add/remove, a convention readers bring with them.

**The guardrail: magenta is never a section hue.** The whole value of magenta is that
its presence anywhere means a decision is waiting — that signal only survives if no page
is allowed to wear it as wallpaper. No section hue may sit close enough to magenta to be
mistaken for it.

Consequences:

- **Position is not attention.** Where you *are* is the section accent; what *needs you*
  is magenta. They are independent channels and may appear on the same screen at once —
  but never as a pair on one control. The shell — rail, breadcrumbs, page header —
  reports position only, so it is never magenta on its own. Magenta enters the shell only
  where a component has been given the content state that justifies it.
- **The rail is the colour legend.** Each rail item's active border takes its own
  destination's hue. Capture, the shell's one action, tints with the section you are
  currently in.
  **Exception:** Capture always stays brand cyan (`#22d3ee`) rather than tinting with
  the active section — on the icon rail and inside its capture modal (cyan save
  button, cyan field focus). A deliberate one-off, do not extend.
- **A screen with nothing awaiting the user contains no magenta at all.** If you are
  reaching for magenta to make something prominent, you are using it wrong — reach for
  `line-strong` or `fg-1` instead.
- **Exactly one chamfered magenta button per screen.** The chamfer marks *the* action. A
  screen with two is a screen that has not decided what it is for.
- **Warnings are not accent; reassurance is.** `drifting` and `critical` mean the same
  thing on every screen and never vary with the section (drifting covers stale,
  out-of-date, degraded — "true, but getting less true"; diff panes keep their
  stable/critical add/remove washes). But a state that merely reassures — "up to
  date", "latest", a live preview's "draft"/"pending" — wears the section accent,
  like any other all-is-well signal.
- **An entity kind wears its home section's hue — everywhere.** What kind of thing
  something is travels with it: projections are green, reflections violet, fragments
  lime, on any screen (the Dashboard's pin cards mix green and violet side by side).
  This is fixed per kind — it does not follow the current section — and it replaces
  per-entity swatches outside the Colours screens. Never use magenta for kind.
- **Neutral sections are monochrome.** Settings, connections, onboarding and boot use
  `fg-2` where the recipe calls for a hue. Utility is deliberately colourless.

---

## 5. Form

### Radius

Zero. Everywhere.

The exception is the circle: status dots (5px at `border-radius: 50%`), radio controls,
and the rotation queue's circular index badge. One square-ish shape escapes too — the
7px-radius colour swatch on the Colours detail pane, softened so the user's colour
reads as a chip, not interface.

### Borders

1px, always. Two weights only (`line`, `line-strong`) plus the accent `edge` tier.

A dashed `line-strong` border marks an affordance that adds something — the "+ Colour ·
Type · Projection · Reflection" row, an empty scope slot.

### Chamfer

```
polygon(0 0, 100% 0, 100% 68%, 88% 100%, 0 100%)
```

Clips the bottom-right corner. Applied to exactly two things: the primary action button,
and the chat send button. It is the strongest signal in the system — treat it as scarce.

The logo mark uses a deeper variant, `polygon(0 0, 100% 0, 100% 70%, 70% 100%, 0 100%)`.

### Shadows

Hard offsets, no blur, accent-tinted:

| Token | Value | Mechanism | Used on |
|---|---|---|---|
| `drop-shadow-magenta` | `4px 4px 0 rgba(255,46,147,0.5)` | `filter` | the primary action button |
| `shadow-section` | `4px 4px 0 0` — section base at 0.28 | `box-shadow` | the active scope card |

The magenta one is a filter, not a box-shadow, because its target is chamfered: `clip-path`
clips an element's whole rendering, box-shadow included, so a `box-shadow` on a chamfered
button draws nothing. `drop-shadow` follows the clipped outline, which is the intent — the
offset should be chamfered too.

These are decoration tied to an accent, not elevation. Two per screen at most. Popovers and
dialogs do **not** get them — they sit on `bg-2` with a `line` border.

The pending column carries a solid 3px magenta left border — an edge, not a shadow. The
same inset-edge idiom (3px left rule in an accent) may mark a tinted region in other
hues, as the context picker does.

### Glow — the brand moment

One place in the system lets light behave like light: the pre-workspace surfaces
(onboarding, boot). There the brand mark carries `animate-glow-shimmer` — a 5s orbiting
cyan `drop-shadow` glow — and the primary choice card answers hover with a blurred cyan
halo (`0 0 16px rgba(34,211,238,0.35)`) over its `cyan-edge` border. Both are blurred and
one is animated: deliberate breaches of the two rules above, sanctioned only here, before
the workspace shell exists. Inside the shell, shadows stay hard and still. Do not extend
the glow to app screens.

### Hover

**Bordered buttons promote their border colour. They never change fill.**

- ghost button: `line-strong` → `fg-3`
- outlined button: `fg-3` → `fg-1`
- scoped action button: `line-strong` → the section accent
- bordered list row: `line` → `line-strong`
- primary button: the one exception — `opacity: 0.86`

**Borderless controls change fill.** Nav items and text buttons hover to `bg-2`; plain
list rows use it at half alpha.
**Exception:** on the workspace icon rail, nav items show a 2px left border in their destination hue on hover and active, hover with their destination hue's `wash` fill, and retain resting text/icon colour (`fg-2`) rather than hovering to `bg-2`/`fg-1` — a deliberate one-off, do not extend.

**A bordered card acting as a single click target may do both** — promote its border
and take the one-step fill. Cards are destinations, not controls; the fill says "all of
this is the target".

### Motion

`120ms cubic-bezier(0.2, 0.7, 0.2, 1)` on colour properties is the default, and for
static content the only motion. Beyond it, motion is allowed exactly where something is
genuinely in progress or appearing:

- **loading** — skeleton pulses and spinners
- **overlay entrances** — dialogs, popovers and sheets may zoom or slide in (100–350ms)
- **disclosure** — chevrons may rotate to point at what they opened
- **chat** — smooth scroll to the newest message

Decoration never moves: no hover lifts, no parallax, nothing animates just to be
noticed.

The pre-workspace surfaces are again the exception: the mark's 5s shimmer (see *Glow*),
the choice cards' 150ms border/shadow transition, and a 2px arrow slide on hover. These
stay outside the workspace shell.

---

## 6. Layout

### Chrome

| | |
|---|---|
| titlebar | 28px, transparent, a frameless-window drag region; the whole app body sits below it, and every page shell sizes itself against it |
| utility bar | 32px, bottom of every workspace screen, `bg-1`, `line` top border, 12px horizontal padding; carries the sidecar status dot and transient inference rate |
| icon rail | 76px wide, `bg-1`, `line` right border, 16px top / 12px bottom padding, 16px gap |
| rail item | collapsed, a square filling the rail between its 8px gutters, icon centred, stacked 8px apart so the space around every item is equal on all four sides; expanded, a 28px row. `border-left: 2px` in the destination's section hue when active. The kalaidoscope switcher is the one non-square item: a 56px row |
| brand mark | a raster PNG, white; 24–28px in the rail, 64px on the onboarding hero. The chamfered mark polygon (`clip-mark`) is the brand shape, reserved for a future vector mark |
| settings nav | 216px wide, `bg-1`, 12px padding, 2px gap between items; a ghost "Back" button leads |
| settings nav item | 8px/10px padding, `border-left: 2px` (transparent when inactive); active items add the accent `wash` fill, accent ink and semibold — the Danger Zone entry uses the `critical` treatment |
| context panel | width per its content, 280–340px typical (300px on the review screen), `line` left border; `bg-1` where it must read as furniture (review, dashboard) |
| page header | 16px/20px padding, `line` bottom border |
| column / pane header | 44px tall, 16px horizontal (20px in the compare pane), `line` bottom border |
| content area | 20px padding, 16px block gap; long-form prose panes widen to 32px horizontal / 24px vertical with a 20px gap |
| settings main | 32px / 32px / 48px padding, max-width 1000px |

The workspace chrome — rail and utility bar — belongs to workspace screens only.
Settings and the pre-workspace routes (onboarding, boot, workspace setup) are
deliberately chromeless full-height shells; only the titlebar is global.

The rail is the one dimension here that is deliberately not the mock's. The mock draws it at
48px, but the window is frameless and the macOS traffic lights float over the rail's top edge —
so it is widened to clear them. The rail item follows the rail rather than holding the mock's
fixed box, which would leave the active marker stranded mid-gutter. Everything else in this
table is the mock's.

The rail ships collapsed. Its expanded state stays wired — the toggle component, the
stored preference and the ⌘B shortcut all still work — but the visible toggle control is
hidden the same way the Appearance control is (§9). The keyboard shortcut still reaches
the expanded state and the choice persists, so expanded is a real if unadvertised
surface; keep it working, but do not design against it.

### Containers

| | |
|---|---|
| card | 16px padding |
| compact card | 14px padding |
| list row | 12px/16px padding, 16px gap |
| list gap | 8px between rows, 12px between cards |
| panel body copy | max-width 640px |

### Rhythm

Spacing sits on Tailwind's 4px grid, half-steps included: **2, 4, 6, 8, 10, 12, 14, 16,
20, 24, 32, 48**. The half-steps are legitimate — do not round 14 up to 16 or 10 down
to 8. 8px is the workhorse gap; 16px separates blocks; 32px separates sections.

### Icons

Lucide throughout.

| Size | Where |
|---|---|
| 26px | icon rail, collapsed — matched to the brand mark, which the rail sets at the same size |
| 16px | icon rail, expanded (and the rail's settings and collapse controls in both states) |
| 14px | buttons (12px in the `xs` sizes) |
| 10px | inline in pills |

Stroke `1.5` for structural icons, `2` for check marks and chevrons.

---

## 7. Component recipes

### Buttons

Five variants. All: 12px / 600 / `0.06em` / uppercase Archivo, zero radius, 8px icon
gap, 14px icons, and a 2px section-accent focus ring.

**Ghost** (`default`) — the default. Transparent, `line-strong` border, `fg-2` text.
Hover promotes the border to `fg-3` and text to `fg-1`.

**Outlined** (`outline`) — one step up. Transparent, `fg-3` border, `fg-1` text.
Optional leading icon in an accent. Hover promotes the border to `fg-1`.

**Primary** (`commit`) — one per screen. Magenta fill, `#ffffff` text, weight 700,
chamfered, `drop-shadow-magenta`. Hover drops to `opacity: 0.86`.

**Section Action** (`section`) — for section creation actions (e.g. '+ New Projection').
Solid section accent fill (`bg-section`), borderless, `#121315` text, weight 700, zero
radius at rest; on hover it chamfers (`clip-chamfer`) and drops to `opacity: 0.86` —
the cut corner, elsewhere the mark of *the* committed action, appears as a preview of
commitment. Its sanctioned companion (Chat's History button) is the *washed* form:
`section-edge` border, static `section-wash` fill, `section-ink` text — hover promotes
the border to the solid accent, the fill never changes.

**Text** (`ghost`) — borderless, `fg-2` text; hovers by fill to `bg-2` (§5 borderless
rule). For rows of low-stakes actions where a border per button would draw a fence.

**Destructive** — transparent, `danger` border at 0.4 promoting to solid on hover,
`danger` text. Danger Zone only.

Sizes: default 40px tall / 20px horizontal padding; `sm` 25px / 12px at 12px type (used
in list rows); `xs` 24px with 12px icons; icon-only squares of each. A filled
`secondary` variant exists solely for the OAuth provider buttons — do not reach for it
elsewhere.

### Pills

Mono, 10.5px, 600–700, `0.12em`, uppercase, 3px/6px padding, 1px border, zero radius.

- **state pill** (Active scope, Pending): accent `edge` border, accent `wash` fill, accent
  text. `Pill`'s primary tone is the section-accent form — reassurance chips ("latest",
  "plan of record", "draft"/"pending" previews) use it. `StatusPill` keeps the constant
  colours: `drifting`/`critical`, and magenta for a pending decision.
- **type pill** (API, Ollama): `line-strong` border, no fill, `fg-3` text, `0.08em` tracking

A state pill with no accent — a plain count, a neutral tag — collapses to the type-pill
recipe.

A pill may carry a 10px leading icon, or a 5px `bg-current` leading dot.

### Labels

10px / 600 / `0.14em` / uppercase. Archivo for regions, JetBrains Mono for data state — see
§2. `fg-3` on panels, `fg-4` above content groups.

A `label-mono` column header may take a leading 5px `fg-3` dot. A state badge replaces the
dot with a bordered pill.

### Cards

1px border, zero radius, 16px padding.

- **on the canvas**: `line` border, no fill
- **on a panel**: `line-strong` border, `bg-2` fill
- **hero** (one per screen at most): accent `edge` border, accent `veil` fill, accent shadow

### List rows

Two variants share the geometry: 12px/16px padding, 16px gap, 8px apart.

- **Card row** — `bg-1` fill, `line` border. Hover promotes the border to
  `line-strong` (§5 bordered rule). Title `row` at 600.
- **Plain row** — the default: borderless. Selection fills `bg-2`; hover fills `bg-2`
  at half alpha (§5 borderless rule). Title `row` at 500, promoting to 600 selected.

Metadata `mono-sm` in `fg-4`, truncated with ellipsis. Actions sit right as small
outline buttons.

### Inputs

Two recipes. Both transparent fills, 12.5px Archivo, `fg-1` text, `fg-4` placeholder,
no outline ever.

- **Bare** — no border of its own; the container owns the edge. For composers and any
  field already sitting inside a bordered container.
- **Underlined** — a `line-strong` bottom border promoting to the section accent on
  focus. For free-standing form fields.

A chat composer is a `line`-topped bar, 12px/16px padding, with a 26px chamfered send button
that is `line-strong`/transparent/`fg-4` when idle and solid section accent (`bg-section`) with
`#121315` glyph (`text-section-foreground`) once armed.

### Two-column compare

Equal columns split by a `line` border. Left is current: `fg-2` body, a dotted `label-mono`
header. Right is pending: `magenta veil` fill, a solid 3px magenta left border, a
`magenta edge` header underline with a bordered Pending pill, and `fg-1` body — the
candidate reads brighter than what it would replace.

### Choice cards (pre-workspace)

The onboarding landing offers one primary and N secondary choices, all ≥104px tall with
20px padding, centred in a 672px column beneath a 64px glowing mark and a centred
header.

- **primary** (one per screen): `cyan-edge` border, `cyan-veil` fill, a 48px bordered
  icon tile. Title `card-title` / 700, description `body` in `fg-2`. Hover promotes the
  border to solid cyan, halos the card (*Glow*, §5) and tints the icon tile
  `cyan-wash` / `cyan-ink`.
- **secondary**: dashed `line` border, no fill. Hover promotes the border and fills
  `bg-2`. Description `body-sm` in `fg-3`.

Both end in a trailing arrow that slides 2px right and turns cyan on hover — the one
sanctioned slide in the system (§5 Motion).

### Not specified

The mocks do not cover these. What ships is a working guess, not a rule — treat it as open,
and do not extend from it.

- **Segmented control** — zero radius, `btn-sm` uppercase, `line-strong` container. The
  selected segment carries a near-white `fg-2` fill that appears nowhere else in the system.
- **Settings main pane alignment** — the 1000px max-width is specified; whether it hugs the
  nav or centres in the window is not. It currently hugs.

---

## 8. Token names in code

The mock's names and the codebase's names differ in one place worth knowing:

| Mock | Code |
|---|---|
| `--k-bg` / `--k-bg2` / `--k-bg3` | `--bg-0` / `--bg-1` / `--bg-2` |
| `--k-fg` … `--k-fg5` | `--fg-1` … `--fg-5` |
| `--k-line` / `--k-line-strong` | `--border-subtle` / `--border-strong` |
| `--k-cyan-dim` | `--cyan-wash` |
| `--k-cyan-wash` | `--cyan-veil` |
| `--k-on-accent` | `--accent-cyan-fg` / `--accent-magenta-fg` (utilities `text-cyan-foreground` / `text-magenta-foreground`) |
| `--k-status-ok` | `--status-stable` |
| `--k-danger` | `--status-critical` |

Utilities follow Tailwind convention from those: `bg-surface-0`, `text-fg-3`, `border-line`,
`bg-magenta-wash`, `border-cyan-edge`, `drop-shadow-magenta`, `clip-chamfer`.

---

## 9. Light mode

There isn't one. The system is built on a dark ground — `#121315` text on solid section
accents (white on solid magenta and danger),
alpha fills at 0.04–0.08 that only read against dark surfaces — and does not transpose.

The theme mechanism stays wired and working so it cannot rot, and `:root` carries a
mechanically inverted palette that never ships. The Appearance control is hidden, not
removed. Do not build against light-mode values; they are not designed.
