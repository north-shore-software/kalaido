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
surfaces, never from shadow. Structure comes from 1px hairlines. Two accents carry meaning
rather than decoration — cyan says *this is running*, magenta says *this needs you*. A
serif display face sits against a grotesque body face, and a mono face does all the
labelling, so type role is legible at a glance from shape alone.

---

## 2. Type

Three faces, three jobs. Never mix them arbitrarily.

| Family | Token | Job |
|---|---|---|
| **Archivo** | `--font-sans` | body copy, buttons, nav items, section and panel labels |
| **Instrument Serif** | `--font-display` | page titles only |
| **JetBrains Mono** | `--font-mono` | breadcrumbs, column headers, pills, paths, slugs, counts, status text |

Weights loaded: Archivo 400–900 (variable) · Instrument Serif 400 roman and italic ·
JetBrains Mono 400–700.

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
| `display` | 36px / 1.05 | 400 | -0.015em | none | Instrument Serif |
| `card-title` | 16px / 1.4 | 700 | -0.01em | none | Archivo |
| `body` | 14.5px / 1.62 | 400 | — | none | Archivo |
| `row` | 13.5px / 1.5 | 600 | — | none | Archivo |
| `item` | 13px / 1.5 | 400–600 | — | none | Archivo |
| `body-sm` | 12.5px / 1.55 | 400 | — | none | Archivo |
| `btn` | 12px / 1 | 600–700 | 0.06em | uppercase | Archivo |
| `meta` | 11.5px / 1.45 | 400 | — | none | Archivo or mono |
| `btn-sm` | 11px / 1 | 600 | 0.06em | uppercase | Archivo |
| `mono-sm` | 11px / 1.45 | 400 | — | none | JetBrains Mono |
| `label` | 10px / 1.4 | 600 | 0.14em | uppercase | Archivo |
| `label-mono` | 10px / 1.4 | 600–700 | 0.14em | uppercase | JetBrains Mono |
| `crumb` | 10px / 1.4 | 400 | 0.12em | uppercase | JetBrains Mono |
| `pill` | 9.5px / 1.4 | 600–700 | 0.12em (0.08em on type pills) | uppercase | JetBrains Mono |

Long-form prose sets `text-wrap: pretty`.

There is exactly one page title per screen, in `display`. It is never uppercase and never
bold — the serif carries the weight.

---

## 3. Colour

### Greys

Eleven steps, cool-neutral. `--gray-11` is spare; the system does not use it.

| Token | Value | Role |
|---|---|---|
| `--gray-0` | `#16171a` | text on solid accent |
| `--gray-1` | `#252628` | app canvas |
| `--gray-2` | `#2d2f31` | rails, sidebars, panels, list rows |
| `--gray-3` | `#37393c` | cards on panels, nav hover |
| `--gray-4` | `#3a3c3f` | default hairline |
| `--gray-5` | `#4e5155` | raised hairline |
| `--gray-6` | `#64666a` | breadcrumb separators, counts |
| `--gray-7` | `#84868a` | metadata, paths, rail icons, placeholders |
| `--gray-8` | `#a3a5a7` | column labels, subtitles, pill text |
| `--gray-9` | `#d6d8d9` | secondary body, inactive nav items |
| `--gray-10` | `#f5f6f6` | headings, primary body, active labels |

### Surfaces

Three levels. **Depth is surface, never shadow.**

| Level | Value | Used for |
|---|---|---|
| `bg-0` | `#252628` | the canvas — content columns, page body |
| `bg-1` | `#2d2f31` | anything attached to an edge — rails, sidebars, context panels, nested panels, list rows |
| `bg-2` | `#37393c` | anything sitting *on* `bg-1` — cards, popovers, nav hover |

A card on the canvas uses a border, not a fill. A card on a panel uses `bg-2`.

### Text

| Level | Value | Used for |
|---|---|---|
| `fg-1` | `#f5f6f6` | headings, primary body, active labels |
| `fg-2` | `#d6d8d9` | secondary body, ghost button labels, inactive nav |
| `fg-3` | `#a3a5a7` | column labels, subtitles, panel copy, pill text |
| `fg-4` | `#84868a` | breadcrumbs, metadata, paths, rail icons, placeholders |
| `fg-5` | `#64666a` | breadcrumb separators, counts |

### Hairlines

| Token | Value | Used for |
|---|---|---|
| `line` | `#3a3c3f` | the default — panel edges, row borders, header underlines |
| `line-strong` | `#4e5155` | raised — card borders, button borders, dashed affordances |

### Accents

| Tier | Cyan | Magenta | Yellow |
|---|---|---|---|
| base | `#22d3ee` | `#f0189c` | `#f5d90a` |
| `wash` — tinted fill | `rgba(34,211,238,0.12)` | `rgba(240,24,156,0.14)` | — |
| `edge` — border | `rgba(34,211,238,0.4)` | `rgba(240,24,156,0.45)` | — |
| `veil` — faintest fill | `rgba(34,211,238,0.04)` | `rgba(240,24,156,0.05)` | — |
| `fg` — text on solid | `#16171a` | `#16171a` | `#16171a` |
| `ink` — text on wash | `#22d3ee` | `#f0189c` | `#f5d90a` |

Text on a wash is the accent itself. There is no separate lifted ink.

Text on a *solid* accent is `#16171a` — dark. The magenta primary button has dark text.

### Status

| Token | Value |
|---|---|
| `stable` | `#22d3ee` |
| `drifting` | `#f5d90a` |
| `critical` / `danger` | `#ff5a3c` |

---

## 4. What the accents mean

This is the part that governs new screens.

**Cyan is system state.** What is currently true, connected, running, selected. The active
scope. The active settings section. "Active & Running". The API pill. The send button once
it has something to send. Cyan is reassurance — it reports, it does not ask.

**Magenta is your decision is required.** The pending column and its badge. The inset edge
marking unreviewed content. The primary approve action. The active rail item while a review
is open. The final breadcrumb on a review screen. Magenta is a demand.

Consequences:

- **A screen with nothing awaiting the user contains no magenta at all.** If you are
  reaching for magenta to make something prominent, you are using it wrong — reach for
  `line-strong` or `fg-1` instead.
- **Exactly one chamfered magenta button per screen.** The chamfer marks *the* action. A
  screen with two is a screen that has not decided what it is for.
- **Yellow and danger are reserved.** Yellow means local or offline. Danger means
  destructive. Neither is a general-purpose highlight.
- Cyan and magenta never appear as a pair on the same control.

---

## 5. Form

### Radius

Zero. Everywhere.

The single exception is a circle: status dots are 5px at `border-radius: 50%`.

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
| `drop-shadow-magenta` | `4px 4px 0 rgba(240,24,156,0.5)` | `filter` | the primary action button |
| `shadow-cyan` | `4px 4px 0 0 rgba(34,211,238,0.28)` | `box-shadow` | the active scope card |

The magenta one is a filter, not a box-shadow, because its target is chamfered: `clip-path`
clips an element's whole rendering, box-shadow included, so a `box-shadow` on a chamfered
button draws nothing. `drop-shadow` follows the clipped outline, which is the intent — the
offset should be chamfered too.

These are decoration tied to an accent, not elevation. Two per screen at most. Popovers and
dialogs do **not** get them — they sit on `bg-2` with a `line` border.

The pending column carries `inset 3px 0 0 #f0189c` — an inset edge, not a shadow in spirit.

### Hover

**Bordered controls promote their border colour. They never change fill.**

- ghost button: `line-strong` → `fg-3`
- outlined button: `fg-3` → `fg-1`
- scoped action button: `line-strong` → `cyan`
- list row: `line` → `line-strong`
- primary button: the one exception — `opacity: 0.86`

**Borderless nav items change fill**, to `bg-2`.

### Motion

`120ms cubic-bezier(0.2, 0.7, 0.2, 1)`, on colour properties only. Nothing moves, scales or
slides.

---

## 6. Layout

### Chrome

| | |
|---|---|
| icon rail | 48px wide, `bg-1`, `line` right border, 12px vertical padding, 16px gap |
| rail item | 28px box, 16px icon, `border-left: 2px` accent when active |
| logo mark | 24px, clipped, `fg-1` |
| settings nav | 216px wide, `bg-1`, 14px/10px padding, 2px gap between items |
| settings nav item | 8px/10px padding, `border-left: 2px` (transparent when inactive) |
| context panel | 300px wide, `bg-1` |
| page header | 16px/20px padding, `line` bottom border |
| column / pane header | 44px tall, 20px horizontal (16px in panels), `line` bottom border |
| content area | 20px padding, 16px block gap |
| settings main | 32px / 32px / 48px padding, max-width 1000px |

### Containers

| | |
|---|---|
| card | 16px padding |
| compact card | 12px padding |
| list row | 12px/16px padding, 16px gap |
| list gap | 8px between rows and cards |
| panel body copy | max-width 660px |

### Rhythm

The spacing set is **2, 4, 5, 7, 8, 10, 12, 14, 16, 20, 24, 32, 48**. It is not a doubling
scale — do not round to one. 8px is the workhorse gap; 16px separates blocks; 32px separates
sections.

### Icons

Lucide throughout.

| Size | Where |
|---|---|
| 16px | icon rail |
| 15px | panel and card titles |
| 14px | buttons |
| 13px | section labels |
| 10px | inline in pills |

Stroke `1.5` for structural icons, `2` for check marks and chevrons.

---

## 7. Component recipes

### Buttons

Three tiers. All: 12px / 600 / `0.06em` / uppercase Archivo, 10px/14px padding, zero radius,
8px icon gap.

**Ghost** — the default. Transparent, `line-strong` border, `fg-2` text.
Hover promotes the border to `fg-3` and text to `fg-1`.

**Outlined** — one step up. Transparent, `fg-3` border, `fg-1` text. Optional leading icon
in an accent. Hover promotes the border to `fg-1`.

**Primary** — one per screen. Magenta fill, `#16171a` text, weight 700, chamfered,
`shadow-magenta`. Hover drops to `opacity: 0.86`.

Small variant: 11px, 7px/12px padding. Used in list rows.

### Pills

Mono, 9.5px, 600–700, `0.12em`, uppercase, 3px/6px padding, 1px border, zero radius.

- **state pill** (Active scope, Pending): accent `edge` border, accent `wash` fill, accent text
- **type pill** (API, Ollama): `line-strong` border, no fill, `fg-3` text, `0.08em` tracking

A pill may carry a 10px leading icon.

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

`bg-1`, `line` border, 12px/16px padding, 16px gap, 8px apart. Hover promotes the border to
`line-strong`. Title `row`, metadata `mono-sm` in `fg-4`, truncated with ellipsis. Actions
sit right: a small ghost button, then a `···` overflow in `fg-4`.

### Inputs

Transparent, no border, no outline. The container owns the edge. 12.5px Archivo, `fg-1`
text, `fg-4` placeholder.

A chat composer is a `line`-topped bar, 12px/16px padding, with a 26px chamfered send button
that is `line-strong`/transparent/`fg-4` when idle and solid cyan with `#16171a` glyph once
armed.

### Two-column compare

Equal columns split by a `line` border. Left is current: `fg-2` body, a dotted `label-mono`
header. Right is pending: `magenta veil` fill, `inset 3px 0 0 magenta` left edge, a
`magenta edge` header underline with a bordered Pending pill, and `fg-1` body — the
candidate reads brighter than what it would replace.

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
| `--k-on-accent` | `--cyan-fg` / `--magenta-fg` |
| `--k-status-ok` | `--status-stable` |
| `--k-danger` | `--status-critical` |

Utilities follow Tailwind convention from those: `bg-surface-0`, `text-fg-3`, `border-line`,
`bg-magenta-wash`, `border-cyan-edge`, `shadow-magenta`, `clip-chamfer`.

---

## 9. Light mode

There isn't one. The system is built on a dark ground — `#16171a` text on solid accents,
alpha fills at 0.04–0.14 that only read against dark surfaces — and does not transpose.

The theme mechanism stays wired and working so it cannot rot, and `:root` carries a
mechanically inverted palette that never ships. The Appearance control is hidden, not
removed. Do not build against light-mode values; they are not designed.
