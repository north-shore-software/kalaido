# React Doctor — Category 4: Nested Interactive Controls & Focus Hygiene

**Baseline scan:** `react-doctor` full-repo run (`42 / 100`, 138 issues total)  
**Diagnostics covered (5 non-shadcn accessibility issues, plus 1 optional unflagged same-pattern site):**
- `react-doctor/prefer-tag-over-role` — **4 warnings** (`Accessibility`; excludes 2 in `shadcn/breadcrumb.tsx:65` and `shadcn/item.tsx:11`, handled in `doctor-06`)
- `react-doctor/no-autofocus` — **1 warning** (`Accessibility`)
- Optional same-pattern cleanup (`D4.4`): 1 unflagged `<div role="button">` + `biome-ignore lint/a11y/useSemanticElements` in `packages/react/features/src/fragments/stream-screen.tsx:338–350`

---

## 1. The Anti-Pattern

All 4 non-shadcn `prefer-tag-over-role` warnings stem from **one layout pattern** across Kalaido's row and card components:

- **Interactive row wrappers are outer `<button>` elements:** Both `ListRow` (`list-row.tsx:70`) and `ProjectionRow` (`projection-row.tsx:62`, which renders its own 4-column `<button className="grid ...">` rather than delegating to `ListRow`) render the entire row as `<button type="button">`. Because HTML forbids nesting `<button>` inside `<button>`, secondary actions rendered inside those rows (`PinToggle` in `ReflectionsScreen` + `ProjectionRow`, and `RowAction` in `ProjectionRow`) are forced to fake buttons with `<span role="button" tabIndex={...} onClick={e => { e.stopPropagation(); ... }} onKeyDown={...}>` + `// biome-ignore lint/a11y/useSemanticElements`.
- **Interactive card wrappers are outer `<div role="button">` elements:** Conversely, `DocumentCard` (`document-card.tsx:70`, whose `PinCard` and `ProposedSection` callers pass real `<button type="button">` Unpin/Dismiss controls in `trailing`) and `FragmentCard` (`fragment-card.tsx:68`, which types `preview?: ReactNode`) wrap the entire card in `<div role="button" tabIndex={0}>` (also with `biome-ignore lint/a11y/useSemanticElements`).

Additionally, `ItemPicker` (`item-picker.tsx:104`) uses the HTML `autoFocus` attribute on its search `<input>` (with `// biome-ignore lint/a11y/noAutofocus`). `react-doctor/no-autofocus` flags `ItemPicker` while skipping `EditableText` (`editable-text.tsx:49`), `ColourDetailPane` (`colour-detail-pane.tsx:240`), `ImportColourField` (`import-colour-field.tsx:82`), and `IconPicker` (`icon-picker.tsx:140`) because `ItemPicker`'s conditional mount (`{open && ...}` / `{picking && ...}` / `{adding && ...}`) lives in its 4 parent callers rather than inside a local conditional branch or modal-dialog wrapper.

---

## 2. The New Codebase Pattern

### Pattern 4A — Stretched Primary Button + Sibling Secondary Buttons (Accessible Card/Row Pattern)
Replace nested interactive elements with a **non-interactive container** (`relative`) holding:
1. A **real `<button type="button">`** for the primary click action — either stretched across the container via `after:absolute after:inset-0 after:content-['']` or sized as an adjacent flex/subgrid primary region (see `D4.1` and `D4.2`).
2. **Real sibling `<button type="button">`** elements for secondary actions (`PinToggle`, `RowAction`, `PinCard` Unpin, `ProposedSection` Dismiss, markdown links) placed at `relative z-10` (with `pointer-events-none [&_a]:pointer-events-auto [&_button]:pointer-events-auto` when mixed with non-interactive badges/pills such as `StatusPill` or `SourceList`) so interactive controls sit above the stretched overlay while non-interactive badges pass clicks through to the primary `<button>`.
3. **Scoped `focus-visible` ring routing:** Put `outline-none` on the stretched `<button>` and `has-[[data-row-primary]:focus-visible]:ring-2 has-[[data-row-primary]:focus-visible]:ring-inset has-[[data-row-primary]:focus-visible]:ring-ring/50` on the outer `rounded-none` shell (`DESIGN.md` §5/§7: zero radius, 2px section-accent focus ring), while secondary `size-6` buttons carry their own `outline-none focus-visible:ring-2 focus-visible:ring-ring/50`. This keeps the full-row/card focus ring when the primary action is focused without double-ringing the shell when keyboard focus tabs onto a secondary button.

```tsx
// Non-interactive shell: owns hover surface + scoped primary focus-visible ring
<div
  className={cn(
    "relative flex items-center gap-4 rounded-none ...",
    "has-[[data-row-primary]:focus-visible]:ring-2 has-[[data-row-primary]:focus-visible]:ring-inset has-[[data-row-primary]:focus-visible]:ring-ring/50",
    className,
  )}
>
  {leading}
  {/* Primary action: real <button> covering the full row via ::after */}
  <button
    type="button"
    data-row-primary
    onClick={onClick}
    className="flex min-w-0 flex-1 cursor-pointer flex-col gap-0.5 text-left outline-none after:absolute after:inset-0 after:content-['']"
  >
    <span className="w-full truncate text-row ...">{title}</span>
    {subtitle != null && <Mono ...>{subtitle}</Mono>}
  </button>

  {/* Secondary actions: real sibling <button>s above the overlay */}
  {trailing && (
    <div className="relative z-10 pointer-events-none flex shrink-0 items-center [&_a]:pointer-events-auto [&_button]:pointer-events-auto">
      {trailing}
    </div>
  )}
</div>
```

Benefits of adopting this pattern across `ListRow`, `ProjectionRow`, `DocumentCard`, and `FragmentCard`:
- **100% valid semantic HTML:** Zero `<div role="button">`, `<span role="button">`, or `<button>`-inside-`<button>` DOM violations.
- **`PinToggle` and `RowAction` become ordinary `<button type="button">` elements:** No manual `tabIndex`, `aria-disabled`, `onKeyDown` Enter/Space handlers, or `e.stopPropagation()` workarounds.
- **Removes all 4 `react-doctor`-flagged `biome-ignore lint/a11y/useSemanticElements` comments** (and all 5 repo-wide if `D4.4` Option B is chosen).
- **Concise screen-reader button labels & clean Tab order:** Tab visits the row/card's primary `<button>` first, then its secondary pin/review/dismiss `<button>`s.

### Pattern 4B — Explicit Mount Focus Hygiene (`ItemPicker`)
For inline/dropdown pickers (`ItemPicker`) that mount only when explicitly opened by a user button press, either focus imperatively via a ref + mount `useEffect` (removing both `autoFocus` and `biome-ignore`) or retain declarative `autoFocus` with a narrow per-file `doctor.config.json` override (see `D4.3`).

---

## 3. File-by-File Inventory & Migration Plan

| File | Line(s) | Rule | Planned Change |
|---|---|---|---|
| `packages/react/primitives/src/kalaido/list-row.tsx` | 68–75 *(enabler for `PinToggle` in `ReflectionsScreen`)* | *(root cause)* | Refactor interactive `ListRow` per `D4.1`: non-interactive outer `<div>` shell + real primary `<button type="button">` + sibling `{trailing}` container, preserving `rounded-none`, hover fills/borders, and 2px section-accent `focus-visible` ring. |
| `packages/react/features/src/projections/components/projection-row.tsx` | 62–102 *(enabler)* & 140–161 | `prefer-tag-over-role` (×1) | 1) Refactor `ProjectionRow`'s outer `<button>` (`:62`) per `D4.1` so `RowAction` and `PinToggle` are sibling `<button>`s rather than descendants of `<button>`, and update `:95` `group-focus-visible:opacity-100` → `group-focus-within:opacity-100` so keyboard focus reveals unpinned `PinToggle`. 2) Convert `RowAction` (`:142`) from `<span role="button">` to `<button type="button">` and remove `biome-ignore`. |
| `packages/react/primitives/src/kalaido/pin-toggle.tsx` | 17–48 | `prefer-tag-over-role` (×1) | Convert `<span role="button" tabIndex={...} aria-disabled={...} onKeyDown={...}>` to `<button type="button" disabled={disabled} aria-label={pinned ? "Unpin" : "Pin"} onClick={onToggle}>` with `focus-visible:ring-2 focus-visible:ring-ring/50`. Remove `e.stopPropagation()`, manual key handling, and `biome-ignore`. |
| `packages/react/primitives/src/kalaido/document-card.tsx` | 68–88 | `prefer-tag-over-role` (×1) | Refactor interactive `DocumentCard` per `D4.2`: outer `<div className="relative ...">`, primary `<button type="button">`, and `trailing` + `footer` as sibling slots (`pointer-events-none [&_a]:pointer-events-auto [&_button]:pointer-events-auto` so `StatusPill`/`SourceList` clicks still open the card while `Unpin`/`Dismiss` buttons receive clicks). Remove `biome-ignore`. *(Optional cleanup: drop now-redundant `e.stopPropagation()` in `pin-card.tsx:62` and `proposed-section.tsx:109`.)* |
| `packages/react/primitives/src/kalaido/fragment-card.tsx` | 65–84 | `prefer-tag-over-role` (×1) | Refactor interactive `FragmentCard` per `D4.2` (stretched header `<button>` or direct `<button type="button">`), keeping `data-testid="fragment-card"` and removing `biome-ignore`. |
| `packages/react/components/src/context-picker/item-picker.tsx` | 103–105 | `no-autofocus` (×1) | Apply `D4.3` (`inputRef` + mount `useEffect` focus, or per-file `doctor.config.json` override). |
| `packages/react/features/src/fragments/stream-screen.tsx` *(if `D4.4` Option B selected)* | 338–372 | *(unflagged `useSemanticElements`)* | Optional: refactor timeline row `<div role="button" aria-pressed={...}>` so the 5th `biome-ignore lint/a11y/useSemanticElements` is also removed. |

### Invariants to Preserve
- **Click target parity (`DESIGN.md` §5 & §7):** Clicking anywhere on a clickable row or card outside secondary buttons/links (including `StatusPill` badges in `PinCard` and `SourceList` footers in `ProposedSection`) must trigger the primary `onClick`.
- **Radius & focus tokens (`AGENTS.md` & `DESIGN.md` §4, §5, §7):** Zero border radius (`rounded-none` only; enforced by `check:design`) and 2px section-accent focus rings (`ring-ring/50`).
- **Text selection vs click target:** Non-clickable `DocumentCard` (`ProposedLoadingCard`) and `FragmentCard` (`ColourComposerPane`, `ColourDetailPane`, `StreamCard`) keep plain `<div>` markup with normal text selection. Clickable cards (`PinCard`, `ProposedSection`, `RecentFragmentsSidebar`) are navigation/open surfaces; see `D4.2` for overlay vs selection tradeoffs.
- **`data-testid="fragment-card"` & jsdom hit-testing:** Zero existing tests in the repo query `fragment-card`. In real browsers, clicking anywhere on a Pattern 4A card hits the `<button>`'s `::after` pseudo-element; in Vitest/jsdom, CSS `::after` geometry does not exist, so clicking the outer `<div data-testid="fragment-card">` does **not** dispatch to a child `<button>` — jsdom tests under `D4.2` Option A must click `getByRole("button", { name: ... })` (whereas `D4.2` Option B places `<button data-testid="fragment-card">` as the root element).

---

## 4. Decision Points

| ID | Decision | Feasible Options | Cross-Plan Coupling | Selected |
|---|---|---|---|---|
| **D4.1** | Interactive row layout for `ListRow`, `ProjectionRow`, `PinToggle`, and `RowAction` | Option A (Stretched `after:inset-0` primary `<button>`), Option B (Adjacent flex / `subgrid` sibling `<button>`) | None | **Option A** |
| **D4.2** | Interactive card layout for `DocumentCard` and `FragmentCard` | Option A (Stretched `after:inset-0` header `<button>` on both), Option B (Stretched `<button>` on `DocumentCard` + direct `<button>` on `FragmentCard`), Option C (Header/title-only `<button>` without card overlay) | None | **Option A** |
| **D4.3** | `ItemPicker` search input focus (`react-doctor/no-autofocus`) | Option A (`inputRef` + mount `useEffect` focus), Option B (Keep `autoFocus` + per-file `doctor.config.json` override) | Option B couples with `doctor-06` Part A (`doctor.config.json`) | **Option A** |
| **D4.4** | Unflagged `<div role="button">` timeline row in `StreamScreen` (`stream-screen.tsx:338`) | Option A (Leave untouched — strictly 4 flagged sites), Option B (Refactor `StreamScreen` row to remove the 5th `biome-ignore`) | Option B touches `stream-screen.tsx` (`doctor-06` Tier 3 `no-giant-component`) | **Option B** |

---

### D4.1 — Interactive Row Layout for `ListRow`, `ProjectionRow`, `PinToggle`, and `RowAction`

**Decision:** **Option A** — Stretched Primary `<button>` (`after:absolute after:inset-0`) + `relative z-10` Sibling Actions

**Files & Callers Verified:**
- `packages/react/primitives/src/kalaido/list-row.tsx:5–76` — 3 callers across the repo:
  - `packages/react/features/src/colours/components/colour-list.tsx:27` (`variant="list"`, `onClick`, `leading={<ColourSwatch>}`, no `trailing`)
  - `packages/react/features/src/reflections/reflections-screen.tsx:80` (`variant="list"`, `onClick`, `leading`, `trailing={<PinToggle ... />}`)
  - `apps/desktop/src/features/create-kalaidoscope/components/kalaidoscope-list.tsx:42` (`variant="list"`, `onClick`, `leading` renders initial letter `<span>P</span>`, no `trailing`)
- `packages/react/features/src/projections/components/projection-row.tsx:49–162` — called by `projections-screen.tsx:141`. **Important finding:** `ProjectionRow` does **not** use `ListRow`; it renders its own outer `<button type="button">` (`:62`) with `COLUMNS = "grid grid-cols-[minmax(0,2fr)_minmax(0,1.1fr)_minmax(0,1.6fr)_4rem] items-center gap-4 px-4"` shared with `ProjectionTableHeader`, containing both `RowAction` (`:84`) and `PinToggle` (`:98`). Also uses `group-focus-visible:opacity-100` (`:95`) to reveal unpinned `PinToggle` on keyboard focus — once the outer `.group` becomes a `<div>`, `:95` must change to `group-focus-within:opacity-100` so keyboard focus on either the row button or `PinToggle` itself reveals it.
- `packages/react/primitives/src/kalaido/pin-toggle.tsx:7–49` — only called in `reflections-screen.tsx:95` and `projection-row.tsx:98` (`PinCard` renders its own `<button>`).
- **Tests:** Zero existing unit tests touch `ListRow`, `ProjectionRow`, or `PinToggle`.

**Cross-Plan Coupling:** None.

#### Option A — Stretched Primary `<button>` (`after:absolute after:inset-0`) + `relative z-10` Sibling Actions
- **How it works:**
  - `ListRow` (`onClick` branch): Outer `<div className={cn(classes, "relative has-[[data-row-primary]:focus-visible]:ring-2 has-[[data-row-primary]:focus-visible]:ring-inset has-[[data-row-primary]:focus-visible]:ring-ring/50")}>` renders `{leading}`, a `<button type="button" data-row-primary className="... outline-none after:absolute after:inset-0 after:content-['']">` wrapping `title` + `subtitle`, and `{trailing}` in `<div className="relative z-10 pointer-events-none flex shrink-0 items-center [&_a]:pointer-events-auto [&_button]:pointer-events-auto">`.
  - `ProjectionRow`: Outer `<div className={cn(COLUMNS, "group relative ... has-[[data-row-primary]:focus-visible]:ring-2 ...")}>` keeps the exact 4-column grid; Column 1 is the stretched `<button type="button" data-row-primary>` (`p.name` + optional `candidate` pill), Columns 2–3 stay unchanged (`GeneratedCell`, `SourceList`), and Column 4 gets `relative z-10` with plain `<button type="button">` `RowAction` and `PinToggle` (`group-focus-within:opacity-100`).
- **Verification:** Prototyped in workspace; passed `biome lint --error-on-warnings`, `check:boundaries`, `check:nav`, `check:design`, `pnpm -r typecheck`, Vitest (`22/22` files including new DOM/click/a11y-name assertions), and `react-doctor` (`prefer-tag-over-role` reduced from `6 → 2`, only `shadcn/` remaining).
- **Pros:**
  - Zero dead zones: 100% of row padding, inter-column gaps, and `{leading}` trigger `onClick` matching row hover highlight.
  - Preserves `ProjectionRow`'s 4-column `COLUMNS` grid alignment with zero `subgrid` changes.
  - Clean screen-reader accessible names: `ProjectionRow`'s button announces `"Quarterly Roadmap"` (not all 3 metadata columns), and `KalaidoscopeList`'s `ListRow` omits the decorative leading initial `"P"` from the button name.
  - Full-row 2px section-accent focus ring on primary focus, individual `size-6` focus ring on `RowAction` / `PinToggle`.
- **Cons:**
  - In Vitest/jsdom tests, clicking the outer `<div>` directly does not trigger `::after` hit-testing; tests must click `getByRole("button", { name: ... })` (standard Testing Library practice).
  - Row text under `::after` cannot be drag-selected while `onClick` is active (identical to current `<button>` rows).

#### Option B — Adjacent Flex / `subgrid` Sibling `<button>` Without `::after` Overlay
- **How it works:**
  - `ListRow` (`onClick` branch): Outer `<div>` holds `<button type="button" className="flex min-w-0 flex-1 items-center gap-4 py-3 pl-4 pr-2 ...">` (`{leading}` + `title` + `subtitle`) next to `<div className="flex shrink-0 items-center py-3 pr-4 pl-2">{trailing}</div>`.
  - `ProjectionRow`: Outer `<div className={cn(COLUMNS, ...)}>` holds `<button type="button" className="col-span-3 grid grid-cols-subgrid items-center gap-4 py-3 ...">` spanning Columns 1–3, with Column 4 as a sibling `<span>` holding `RowAction` and `PinToggle`.
- **Verification:** Prototyped in workspace; passed `biome lint --error-on-warnings`, `check:design`, `pnpm -r typecheck`, Vitest (`22/22` files), and `react-doctor` (`prefer-tag-over-role` `6 → 2`).
- **Pros:**
  - No `::after` pseudo-element positioning or `z-10` stacking layers.
  - Focus ring sits directly on the `<button>` (covering Columns 1–3 or the left flex region).
- **Cons:**
  - Creates unclickable dead zones inside the hovered row box (the `4rem` trailing cell padding/gaps around `24×24` icon buttons) while the full row background highlights on hover.
  - Bloats `ProjectionRow`'s primary `<button>` accessible name with all 3 columns (`Name` + `Last generated` + `entropy` + `Sources`), and includes `KalaidoscopeList`'s leading initial letter (`"P Personal Local"`).
  - Focus ring wraps only the left 3 columns / left flex area rather than the full row perimeter.

#### Ruled-Out Options
- **Converting `PinToggle` / `RowAction` to `<button>` without refactoring `ProjectionRow`'s outer `<button>` (`:62`):** Produces `<button>` nested inside `<button>` in `ProjectionRow`, violating the HTML spec and triggering React DOM `validateDOMNesting` errors.

---

### D4.2 — Interactive Card Layout for `DocumentCard` and `FragmentCard`

**Decision:** **Option A** — Stretched Header/Title `<button>` (`after:absolute after:inset-0`) Across Both `DocumentCard` and `FragmentCard`

**Files & Callers Verified:**
- `packages/react/primitives/src/kalaido/document-card.tsx:5–89` — 3 call sites across 2 files:
  - `packages/react/features/src/dashboard/components/pin-card.tsx:30` — passes `onClick`, `leading`, `title`, `lines` (wireframe bars, no prose), and `trailing` containing `<StatusPill>` + `<button type="button" aria-label="Unpin">`.
  - `packages/react/features/src/dashboard/components/proposed-section.tsx:87` — passes `onClick`, `leading`, `title`, 3-line `<p>` message body, `footer={<SourceList />}` (non-interactive pills), and `trailing` containing `<StatusPill>` + `<button type="button" aria-label="Dismiss">`.
  - `packages/react/features/src/dashboard/components/proposed-section.tsx:30` (`ProposedLoadingCard`) — static (`onClick` omitted).
- `packages/react/primitives/src/kalaido/fragment-card.tsx:7–91` — 4 call sites across 4 files:
  - `packages/react/features/src/dashboard/components/recent-fragments-sidebar.tsx:39` — **sole caller in the repo that passes `onClick`**; passes `compact`, `title`, `time`, and **no `preview`**.
  - `packages/react/features/src/fragments/components/stream-parts.tsx:43` (`StreamCard`) — **does not pass `onClick`** (`StreamScreen` wraps the outer timeline row instead) and passes a plain string `preview` (`content:excerpt(300)`), not `<MarkdownContent>`.
  - `packages/react/features/src/colours/components/colour-composer-pane.tsx:98` — no `onClick`; passes plain 140-char string `preview`.
  - `packages/react/features/src/colours/components/colour-detail-pane.tsx:334` — no `onClick` (hover `CardAction` buttons sit on a parent `<div className="group relative">`); passes plain 140-char string `preview`.
- **Tests:** Repo-wide grep confirms **zero existing tests** reference `DocumentCard`, `FragmentCard`, or `data-testid="fragment-card"`.

**Cross-Plan Coupling:** None.

#### Option A — Stretched Header/Title `<button>` (`after:absolute after:inset-0`) Across Both `DocumentCard` and `FragmentCard`
- **How it works:**
  - Both `DocumentCard` and `FragmentCard` keep a plain `<div>` when `onClick` is omitted.
  - When `onClick` is provided, each renders a `relative` outer `<div>` (`data-testid="fragment-card"` preserved on `FragmentCard`) with `has-[[data-card-primary]:focus-visible]:ring-2 has-[[data-card-primary]:focus-visible]:ring-inset has-[[data-card-primary]:focus-visible]:ring-ring/50`, a primary `<button type="button" data-card-primary>` around `{title}` / `{displayTitle}` with `after:absolute after:inset-0 after:content-['']`, `pointer-events-none [&_a]:pointer-events-auto [&_button]:pointer-events-auto` on `DocumentCard`'s `relative z-10` `trailing` and `footer` slots, and `[&_a]:relative [&_a]:z-10` on `FragmentCard`'s `preview`.
- **Verification:** Prototyped in workspace; passed `biome lint --error-on-warnings`, `check:design`, `pnpm -r typecheck`, Vitest (`22/22` files), and `react-doctor` (`prefer-tag-over-role` `6 → 2`). Empirically verified in jsdom that `getByRole("button", { name: title })` fires `onClick`, `<button>` accessible name is strictly `title` / `displayTitle` (zero body/footer bloat), and nested `<button>` / `<a>` count inside `<button>` is `0`.
- **Pros:**
  - Single uniform accessible card pattern across `DocumentCard` and `FragmentCard`.
  - Preserves 100% full-card click target (`DESIGN.md` §5/§7: *"Cards are destinations, not controls; the fill says 'all of this is the target'"*), including clicks on `PinCard`'s `StatusPill` and `ProposedSection`'s `SourceList` footer.
  - Concise screen-reader button label (`title` / `displayTitle` only) instead of reading multi-sentence card previews on focus.
  - Future-proof if any caller passes interactive links in `FragmentCard`'s `preview: ReactNode` or buttons in `DocumentCard`'s `footer`.
- **Cons:**
  - Users cannot drag-select body prose on clickable cards underneath `::after` (non-clickable cards in `StreamCard`, `ColourComposerPane`, and `ColourDetailPane` are unaffected and remain selectable; clickable `PinCard` and `RecentFragmentsSidebar` have no prose, leaving only `ProposedSection`'s 3-line summary).
  - In Vitest/jsdom, `fireEvent.click(getByTestId("fragment-card"))` on the outer `<div>` returns `0` clicks because jsdom lacks CSS `::after` hit-testing; future jsdom tests must query `getByRole("button", { name: ... })`.

#### Option B — Stretched `<button>` on `DocumentCard` + Direct `<button type="button">` on Interactive `FragmentCard`
- **How it works:**
  - `DocumentCard` uses Option A (required because `PinCard` and `ProposedSection` pass `<button>`s in `trailing`).
  - `FragmentCard` renders `<button type="button" onClick={onClick} data-testid="fragment-card" className={classes}>` directly when `onClick` is set (optionally narrowing `preview?: string` to encode that interactive children are not allowed).
- **Verification:** Prototyped in workspace; all 4 `FragmentCard` callers typechecked (`pnpm -r typecheck`), and `biome lint --error-on-warnings`, `check:design`, Vitest (`22/22` files — verified `fireEvent.click(getByTestId("fragment-card"))` fires `onClick`), and `react-doctor` (`prefer-tag-over-role` `6 → 2`) all passed.
- **Pros:**
  - Simplest 1-element DOM for interactive `FragmentCard` with no `::after` overlay.
  - Clicking `getByTestId("fragment-card")` works directly in Vitest/jsdom as well as browsers.
- **Cons:**
  - Splits card architecture across two patterns (`DocumentCard` stretched button vs `FragmentCard` outer button).
  - If any caller ever passes both `onClick` and `preview` to `FragmentCard`, screen readers read `displayTitle` + `time` + the entire `preview` excerpt as the button label, and any `<a>` inside `preview` re-introduces invalid HTML nesting.

#### Option C — Header/Title-Only `<button>` Without `after:inset-0` Card Overlay
- **How it works:** Make `{title}` / `{displayTitle}` a `<button type="button" onClick={onClick}>` without `after:absolute after:inset-0`, and remove `hover:bg-surface-2*` from the card shell so only the title button is interactive.
- **Verification:** Valid semantic HTML; passes Biome, `tsc`, `check:design`, and `react-doctor`.
- **Pros:**
  - Allows text drag-selection on `ProposedSection`'s 3-line preview body and requires no `z-10` layering.
- **Cons:**
  - Shrinks the click target from the full card to a single line of header text — clicking `PinCard`'s 74px wireframe box or `ProposedSection`'s body/footer becomes a dead click, contradicting `DESIGN.md` §5/§7 and the full-card click parity invariant.

#### Ruled-Out Options
- **Direct outer `<button>` on `DocumentCard`:** Invalid HTML (`<button>` inside `<button>`) because `pin-card.tsx:57` and `proposed-section.tsx:105` render `<button type="button">` inside `trailing`.
- **Card-level `<div onClick={...}>` delegation (without `role="button"`) + inner title `<button>`:** Empirically tested in workspace and rejected by **both** linters:
  - `pnpm exec biome lint --error-on-warnings` fails with **2 errors**: `lint/a11y/noStaticElementInteractions` and `lint/a11y/useKeyWithClickEvents`.
  - `react-doctor` emits **2 new Accessibility warnings**: `react-doctor/no-static-element-interactions` and `react-doctor/click-events-have-key-events`.

---

### D4.3 — `ItemPicker` Search Input Focus (`react-doctor/no-autofocus`)

**Decision:** **Option A** — Imperative Mount Focus (`inputRef` + `useEffect`) in `ItemPicker`

**Files & Callers Verified:**
- `packages/react/components/src/context-picker/item-picker.tsx:65–194` — 4 callers across the repo:
  1. `packages/react/components/src/context-bar/context-bar.tsx:229–245` — conditionally mounted inside `<div className="absolute inset-x-2 bottom-full z-10 mb-1">` when `+ Pin` is clicked (`open === true`).
  2. `packages/react/components/src/fragment-drawer.tsx:374–389` — conditionally mounted inline (`{picking && <ItemPicker ... />}`) inside an *already-open* `SheetContent` when `+ colour` is clicked.
  3. `packages/react/features/src/colours/components/colour-detail-pane.tsx:296–315` — conditionally mounted inline (`{adding && <ItemPicker ... />}`) in the flex column when `Add example` is clicked.
  4. `packages/react/features/src/explore/bookmark-actions.tsx:126–143` — conditionally mounted inline (`{picking && <ItemPicker ... />}`) inside an *already-open* `BookmarksTray` `SheetContent` when `+ Colour` is clicked.
- `packages/react/primitives/src/shadcn/popover.tsx:1–88` — wraps `@base-ui/react/popover` (`PopoverPrimitive.Popup` accepts `initialFocus?: boolean | RefObject<HTMLElement | null> | (...)` and defaults to focusing the first tabbable element on mouse/keyboard open, or the popup itself on touch open). **Verified fact:** `PopoverContent` is only used in `snapshot-edit-markers.tsx:80` — **none of the 4 `ItemPicker` callers mount inside `PopoverContent`**.

**Cross-Plan Coupling:** Option B couples with `doctor-06` Part A (`doctor.config.json`). **Critical monorepo config finding verified empirically:** `react-doctor` evaluates `ignore.files` and `ignore.overrides[].files` relative to each scanned workspace package root (e.g. `src/context-picker/item-picker.tsx` inside `@kalaido/components`), so repo-root prefixes like `"packages/react/components/src/..."` **do not match**; globs must be written `"**/src/context-picker/item-picker.tsx"` (this also applies to `"**/src/shadcn/**"` in `doctor-06`!).

#### Option A — Imperative Mount Focus (`inputRef` + `useEffect`) in `ItemPicker`
- **How it works:** Replace `autoFocus` + `// biome-ignore lint/a11y/noAutofocus` in `item-picker.tsx:103–104` with `const localInputRef = useRef<HTMLInputElement>(null)` (plus optional `inputRef?: RefObject<HTMLInputElement | null>` prop for future `PopoverContent` `initialFocus` callers) and `useEffect(() => { resolvedInputRef.current?.focus(); }, [resolvedInputRef])`.
- **Verification:** Prototyped in workspace; passed `biome lint --error-on-warnings`, `pnpm -r typecheck`, Vitest (`22/22` files — verified `document.activeElement` lands on the search `<input>` both standalone and inside `@base-ui/react/popover` `PopoverContent` with or without `initialFocus={ref}`), and `react-doctor` (`no-autofocus`: `1 → 0`, zero new effect warnings).
- **Pros:**
  - Satisfies both Biome (`lint/a11y/noAutofocus`) and `react-doctor/no-autofocus` with zero suppression comments and zero `doctor.config.json` overrides.
  - Keeps `react-doctor/no-autofocus` active across the entire codebase, including `item-picker.tsx`.
  - Optional `inputRef` prop seamlessly supports `<PopoverContent initialFocus={ref}>` if a future caller ever mounts `ItemPicker` in a Base UI Popover on touch devices.
- **Cons:**
  - Replaces a 1-word declarative attribute with 4 lines of `useRef` + `useEffect` (`react-doctor`'s `no-autofocus` docs caution against moving *page-load* autofocus into an effect, though `ItemPicker` only mounts on explicit user action).

#### Option B — Keep Declarative `autoFocus` and Add a Per-File Override in `doctor.config.json`
- **How it works:** Keep `autoFocus` and `// biome-ignore lint/a11y/noAutofocus` in `item-picker.tsx:103–104`, and add a scoped override in root `doctor.config.json` alongside `doctor-06` Part A:
  ```json
  {
    "ignore": {
      "overrides": [
        {
          "files": ["**/src/context-picker/item-picker.tsx"],
          "rules": ["react-doctor/no-autofocus"]
        }
      ]
    }
  }
  ```
- **Verification:** Prototyped in workspace; passed `biome lint --error-on-warnings`, `pnpm -r typecheck`, Vitest (`22/22` files), and `react-doctor` (`no-autofocus`: `1 → 0` when using `"**/src/context-picker/item-picker.tsx"`).
- **Pros:**
  - Keeps declarative `autoFocus` with zero `useEffect`, consistent with `EditableText` (`editable-text.tsx:48–49`), `ColourDetailPane` (`:240`), and `ImportColourField` (`:82`).
  - Narrow per-file `ignore.overrides` keeps `react-doctor/no-autofocus` enabled everywhere else in the repository.
- **Cons:**
  - Retains the `// biome-ignore lint/a11y/noAutofocus` comment in `item-picker.tsx` and depends on `doctor.config.json` (`doctor-06`).

#### Ruled-Out Options
- **Wrapping all 4 `ItemPicker` callers in Base UI `PopoverContent` with `initialFocus={inputRef}`:** 3 of the 4 callers (`FragmentDrawer`, `ColourDetailPane`, `BookmarkActions`) render `ItemPicker` **inline in normal flex flow** (pushing sibling content down), not as a floating portal popup. Converting them to `PopoverContent` would alter visual layout and interaction design across 3 screens.
- **Disabling `react-doctor/no-autofocus` globally (`rules: { "react-doctor/no-autofocus": "off" }`):** Unnecessarily broad when `ignore.overrides` suppresses only `item-picker.tsx`.
- **Using root-prefixed path `"packages/react/components/src/context-picker/item-picker.tsx"` in `doctor.config.json`:** Verified empirically to **fail to match** (`no-autofocus` still fires on `src/context-picker/item-picker.tsx`) because `react-doctor` matches paths per workspace package.

---

### D4.4 — Adjacent Unflagged `<div role="button">` Timeline Row in `StreamScreen`

**Decision:** **Option B** — Also Refactor `StreamScreen`'s Timeline Row (`stream-screen.tsx:338–372`) to Pattern 4A

**Files & Callers Verified:**
- `packages/react/features/src/fragments/stream-screen.tsx:338–372` — renders each stream timeline row (`<Mono>{f.time}</Mono>` + selection `<Checkbox>` / dot + `<StreamCard f={f} />`) inside `<div role="button" tabIndex={0} aria-pressed={selecting ? isSelected : undefined} onClick={() => openOrToggle(f.id)} onKeyDown={...}>` with `{/* biome-ignore lint/a11y/useSemanticElements: ... */}`.
- Inside that row: `StreamCard` (`stream-parts.tsx:43`) renders `<FragmentCard>` **without `onClick`** and with a plain text excerpt (`f.preview` = `content:excerpt(300)`), while `:357` renders `<Checkbox checked={isSelected} tabIndex={-1} aria-hidden className="pointer-events-none ..." />` (`@base-ui/react/checkbox` renders a `<span role="checkbox">` / interactive root) when `selecting` is true.
- `react-doctor/prefer-tag-over-role` did not flag `:340` in the baseline scan, so leaving it untouched still reaches `0` non-shadcn `prefer-tag-over-role` warnings, but leaves 1 `biome-ignore lint/a11y/useSemanticElements` in the codebase.

**Cross-Plan Coupling:** `stream-screen.tsx:80` is a Tier 3 `no-giant-component` decomposition target in `doctor-06`.

#### Option A — Keep Scope Strictly to the 4 `react-doctor`-Flagged `prefer-tag-over-role` Sites
- **How it works:** Do not modify `stream-screen.tsx` in Category 4; revisit only if desired during `doctor-06` `StreamScreen` decomposition.
- **Verification:** Confirmed baseline + Prototype 1 reaches `prefer-tag-over-role`: `6 → 2` (only `shadcn/`) without touching `stream-screen.tsx`.
- **Pros:**
  - Smallest diff (`AGENTS.md`: *"Solve exactly what was asked with the smallest diff that works"*); zero overlap with `doctor-06`'s `StreamScreen` split.
- **Cons:**
  - Leaves 1 remaining `biome-ignore lint/a11y/useSemanticElements` in `packages/react/features/src/fragments/stream-screen.tsx:338`.

#### Option B — Also Refactor `StreamScreen`'s Timeline Row (`stream-screen.tsx:338–372`) to Pattern 4A
- **How it works:** Convert the outer timeline row `<div role="button">` (`:340`) to a non-interactive `<div className="group relative flex w-full min-w-0 items-start gap-4 text-left ...">` with a stretched `<button type="button" aria-pressed={selecting ? isSelected : undefined} onClick={() => openOrToggle(f.id)} className="... after:absolute after:inset-0 after:content-['']">` (keeping `<Checkbox aria-hidden>` outside `<button>` so no interactive ARIA widget nests inside `<button>`), and remove the `biome-ignore` comment.
- **Verification:** Same Pattern 4A mechanics verified in `D4.1`/`D4.2`; preserves `aria-pressed` toggle semantics in `selecting` mode and eliminates invalid ARIA nesting around `Checkbox`.
- **Pros:**
  - Eliminates **all 5** `biome-ignore lint/a11y/useSemanticElements` suppressions across the entire repository.
- **Cons:**
  - Expands Category 4 by 1 file (`stream-screen.tsx`) beyond the 5 diagnostics reported by `react-doctor`.

---

## 5. Verification

- Run `./kalaido.sh test:ts && ./kalaido.sh check:ts` (including `biome lint --error-on-warnings`, `check:boundaries`, `check:nav`, `check:design`, `check:routes`, `pnpm -r typecheck`, and all 3 app builds).
- Smoke-test keyboard Tab navigation, `focus-visible` rings, and click interactions on:
  - Dashboard pins & proposed cards (`PinCard` and `ProposedSection` → `DocumentCard` + sibling `Unpin` / `Dismiss` buttons + `StatusPill` / `SourceList` click-through)
  - Dashboard recent fragments sidebar (`RecentFragmentsSidebar` → `FragmentCard` with `onClick`)
  - Colours & Kalaidoscope lists (`ColourList`, `KalaidoscopeList` → `ListRow`) and Reflections list (`ReflectionsScreen` → `ListRow` + `PinToggle`)
  - Projections table (`ProjectionsScreen` → `ProjectionRow` + `RowAction` + hover/focus-revealed `PinToggle`)
  - `ItemPicker` across `ContextBar`, `FragmentDrawer`, `ColourDetailPane`, and `BookmarkActions` (plus `StreamScreen` timeline rows if `D4.4` Option B is chosen)
- Re-run `pnpm dlx react-doctor@latest . --verbose --yes` and confirm:
  - `prefer-tag-over-role`: `6 → 2` (only `shadcn/breadcrumb.tsx:65` and `shadcn/item.tsx:11` remaining, handled by `doctor-06` config)
  - `no-autofocus`: `1 → 0`
