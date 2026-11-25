# React Doctor — Category 4: Nested Interactive Controls & Focus Hygiene

**Baseline scan:** `react-doctor` full-repo run (`42 / 100`, 138 issues total)  
**Diagnostics covered (5 non-shadcn accessibility issues):**
- `react-doctor/prefer-tag-over-role` — **4 warnings** (`Accessibility`; excludes 2 in `shadcn/breadcrumb.tsx` and `shadcn/item.tsx`)
- `react-doctor/no-autofocus` — **1 warning** (`Accessibility`)

---

## 1. The Anti-Pattern

All 4 non-shadcn `prefer-tag-over-role` warnings stem from **one single layout pattern** across Kalaido's card and row primitives:

- `ListRow` renders the entire row as `<button type="button" onClick={onClick}>`.
- Because HTML forbids nesting `<button>` inside `<button>`, secondary actions rendered inside a row (`PinToggle`, `ProjectionRow`'s `RowAction`) are forced to fake buttons with `<span role="button" tabIndex={0} onClick={e => { e.stopPropagation(); ... }} onKeyDown={...}>` + `// biome-ignore lint/a11y/useSemanticElements`.
- Conversely, `DocumentCard` and `FragmentCard` wrap the entire card in `<div role="button" tabIndex={0}>` (also with `biome-ignore`) because their `trailing`, `footer`, or markdown `preview` slots may contain interactive elements.

Additionally, `ItemPicker` uses the HTML `autoFocus` attribute on its search `<input>` (with `// biome-ignore lint/a11y/noAutofocus`).

---

## 2. The New Codebase Pattern

### Pattern 4A — Stretched Primary Button + Sibling Secondary Buttons (Accessible Card/Row Pattern)
Replace nested interactive elements with a **non-interactive container** (`relative`) holding:
1. A **real `<button type="button">`** for the primary click action — using a stretched hit area (`after:absolute after:inset-0 after:content-[""]`) or flex primary region (`flex-1`).
2. **Real sibling `<button type="button">`** elements for secondary actions (`PinToggle`, `RowAction`, footer buttons, markdown links) placed at `relative z-10` so they sit above the stretched overlay and never nest inside another button!

```tsx
// Non-interactive shell
<div className={cn("relative flex items-center gap-4 ...", className)}>
  {/* Primary action: real <button> covering the full row via ::after */}
  <button
    type="button"
    onClick={onClick}
    className="flex min-w-0 flex-1 items-center gap-4 text-left focus-visible:outline-none after:absolute after:inset-0 after:content-['']"
  >
    {leading}
    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
      <span className="truncate text-row ...">{title}</span>
      {subtitle != null && <Mono ...>{subtitle}</Mono>}
    </div>
  </button>

  {/* Secondary actions: real sibling <button>s above the overlay */}
  {trailing && <div className="relative z-10 flex shrink-0 items-center gap-2">{trailing}</div>}
</div>
```

Benefits of adopting this pattern across `ListRow`, `DocumentCard`, and `FragmentCard`:
- **100% valid semantic HTML:** Zero `<div role="button">` or `<span role="button">`.
- **`PinToggle` and `RowAction` become ordinary `<button type="button">` elements:** No manual `tabIndex`, `onKeyDown` Enter/Space handlers, or `e.stopPropagation()` workarounds.
- **Removes all 4 `biome-ignore lint/a11y/useSemanticElements` comments** across primitives and features.
- **Preserves full-card/full-row click targets and keyboard Tab order** (Tab visits the card's primary action, then its secondary pin/review buttons).

### Pattern 4B — Imperative Mount Focus Instead of `autoFocus`
For popovers/pickers (`ItemPicker`) that mount only when explicitly opened by a user click:
- Replace the `autoFocus` HTML attribute with a `useRef<HTMLInputElement>(null)` + mount `useEffect(() => { inputRef.current?.focus(); }, [])` (which also removes `// biome-ignore lint/a11y/noAutofocus`).

---

## 3. File-by-File Inventory & Migration Plan

| File | Line(s) | Rule | Planned Change |
|---|---|---|---|
| `packages/react/primitives/src/kalaido/list-row.tsx` | 68–75 *(enabler for `PinToggle` & `RowAction`)* | *(root cause)* | Refactor interactive `ListRow` to Pattern 4A: outer `<div className="relative ...">`, primary `<button type="button">` with `after:absolute after:inset-0`, and `{trailing}` rendered as a `relative z-10` sibling outside the primary `<button>`. Preserve focus ring (`has-[:focus-visible]` or `focus-visible:` on the shell) and hover states. |
| `packages/react/primitives/src/kalaido/document-card.tsx` | 71 | `prefer-tag-over-role` (×1) | Refactor interactive `DocumentCard` to Pattern 4A: outer `<div className="relative ...">`, primary `<button type="button">` on the card title/header with `after:absolute after:inset-0`, and `trailing` + `footer` slots as `relative z-10` siblings. Remove `biome-ignore`. |
| `packages/react/primitives/src/kalaido/fragment-card.tsx` | 69 | `prefer-tag-over-role` (×1) | Refactor interactive `FragmentCard` to Pattern 4A: outer `<div className="relative ...">`, primary `<button type="button">` on the header/title with `after:absolute after:inset-0`, and any interactive links inside `preview` raised above the overlay (`[&_a]:relative [&_a]:z-10`). Remove `biome-ignore`. |
| `packages/react/primitives/src/kalaido/pin-toggle.tsx` | 19 | `prefer-tag-over-role` (×1) | Convert `<span role="button" tabIndex={...} onKeyDown={...}>` to a plain `<button type="button" disabled={disabled} aria-label={...} onClick={onToggle}>`. Remove manual keyboard handling and `biome-ignore`. |
| `packages/react/features/src/projections/components/projection-row.tsx` | 142 | `prefer-tag-over-role` (×1) | Convert `RowAction`'s `<span role="button" tabIndex={0} onKeyDown={...}>` to a plain `<button type="button" aria-label={label} title={label} onClick={onClick}>`. Remove `biome-ignore`. |
| `packages/react/components/src/context-picker/item-picker.tsx` | 104 | `no-autofocus` (×1) | Replace `autoFocus` attribute + `biome-ignore` with `inputRef` + mount `useEffect(() => { inputRef.current?.focus(); }, [])`. |

### Invariants to Preserve
- **Click target parity:** Clicking anywhere on a `ListRow`, `DocumentCard`, or `FragmentCard` (outside explicit secondary buttons/links) must still trigger `onClick`.
- **Text selection vs click:** Note that on `FragmentCard` / `DocumentCard`, `after:inset-0` covers the entire card just like the existing `<div role="button">`, so click behavior is identical.
- **Radius & design classes:** Follow `AGENTS.md` zero-border-radius rule (`rounded-none` only; verified by `check:design`).
- **`data-testid="fragment-card"`:** Keep `data-testid="fragment-card"` on the outer card element (and verify any tests clicking `[data-testid="fragment-card"]` still trigger `onClick` — note: clicking the outer `<div>` center hits the stretched `<button>` `::after` pseudo-element, which dispatches the button's `onClick`!).

---

## 4. Open Decisions

1. **Stretched-link (`after:inset-0`) vs split-area button for `DocumentCard` / `FragmentCard`:**
   - **Option A (Recommended):** Stretched primary `<button>` (`after:absolute after:inset-0`) + `relative z-10` sibling buttons — preserves 100% full-card clickable area while using real `<button>` elements everywhere.
   - **Option B:** Only make the card title a `<button>` (reduces click target area — probably undesirable for cards).
2. **`ItemPicker` `no-autofocus`:**
   - **Option A (Recommended):** Replace `autoFocus` with a ref + mount `useEffect` focus (satisfies both Biome and React Doctor while preserving immediate search-first UX).
   - **Option B:** Keep `autoFocus` and disable `no-autofocus` in `doctor.config.json` (if you prefer declarative `autoFocus` for conditionally mounted pickers).

---

## 5. Verification

- Run `./kalaido.sh test:ts && ./kalaido.sh check:ts` (including `check:design`).
- Smoke-test keyboard Tab navigation + click interactions on Dashboard pins (`DocumentCard` + `PinToggle`), Colours/Reflections list (`ListRow` + `PinToggle`), Projections list (`ProjectionRow` + `RowAction`), Stream (`FragmentCard`), and Context Picker (`ItemPicker`).
- Re-run `pnpm dlx react-doctor@latest . --verbose --yes` and confirm:
  - `prefer-tag-over-role`: `6 → 2` (only `shadcn/` remaining)
  - `no-autofocus`: `1 → 0`
