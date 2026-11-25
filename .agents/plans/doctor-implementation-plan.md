# React Doctor — Master Implementation Plan

**Branch:** `louis/doctor-fixes` (starting after commit `0c00b3a`)  
**Execution Model:** Single agent, strictly sequential phases; **STOP after each phase/wave** so the user can review and commit manually (no agent git mutations per `AGENTS.md`).  
**Target Outcome:** `react-doctor` score **`100 / 100` (`0` errors, `0` warnings)**, zero `ignore.overrides`, zero inline `react-doctor-disable` comments, full `./kalaido.sh test:ts && ./kalaido.sh check:ts` green at every checkpoint.

---

## 1. Starting State & Settled Decisions Reference

Categories 1, 2, and 3 were already implemented on `louis/doctor-fixes` (`4b9da70`, `54107ef`, `0ad7f19`, `3114f35`), prior to finalizing two revised decisions (**D1.1 Option D** and **D2.3 Option B**). Categories 4, 5, and 6 remain unimplemented.

| Plan | Status at `0c00b3a` | Selected Decisions |
|---|---|---|
| [doctor-01-refs-and-render-purity.md](./doctor-01-refs-and-render-purity.md) | Committed (`4b9da70`) — **needs D1.1 rework** | **D1.1:** Option D (`@kalaido/hooks/use-sync-ref` + native `useRef`) · **D1.2:** Option C · **D1.3:** Option A · **D1.4:** Option A |
| [doctor-02-modal-resets-and-timers.md](./doctor-02-modal-resets-and-timers.md) | Committed (`54107ef`) — **needs D2.3 rework** | **D2.1:** Option A · **D2.2:** Option A · **D2.3:** Option B (rAF `tick()` phrases) · **D2.4:** Option A · **D2.5:** Option B |
| [doctor-03-effect-sync-and-data-flow.md](./doctor-03-effect-sync-and-data-flow.md) | Committed (`0ad7f19`, `3114f35`) — **adopt `useSyncRef` in Phase 0** | **D3.1:** Option A (`@kalaido/hooks`) · **D3.2:** Option B · **D3.3:** Option B · **D3.4:** Option B · **D3.5:** Option A · **D3.6:** Option A |
| [doctor-04-interactive-card-accessibility.md](./doctor-04-interactive-card-accessibility.md) | Not started | **D4.1:** Option A · **D4.2:** Option A · **D4.3:** Option A · **D4.4:** Option B |
| [doctor-05-async-perf-and-keys.md](./doctor-05-async-perf-and-keys.md) | Not started | **D5.1:** Option A · **D5.2:** Option A · **D5.3:** Option A · **D5.4:** Option B · **D5.5:** Option B · **D5.6:** Option A |
| [doctor-06-decomposition-and-config.md](./doctor-06-decomposition-and-config.md) | Not started | **D6.1:** Option A · **D6.2:** Option C · **D6.3:** Option A · **D6.4:** Option B · **D6.5:** Option A · **D6.6:** Option A · **D6.7:** Option A |

**Approved in-scope adjacent bug fixes (included in Phase 2):**
1. `packages/react/features/src/projections/components/projection-canvas.tsx`: stale `editError` when cancelling/switching blocks + preserving `<EditCandidateModal>` exit animation.
2. `apps/desktop/src/features/onboarding/pages/CloudWorkspaces.tsx`: wrap `handleOpen` (`switchLocalKalaidoscope`) in `try / catch / finally` so `openingId` never gets stuck.

---

## 2. Standard Phase Gate (Run After Every Phase / Wave)

Before stopping for user review & commit on **every** phase/wave:
1. Run `./kalaido.sh test:ts && ./kalaido.sh check:ts` (Biome format + lint, `check:boundaries`, `check:nav`, `check:design`, `check:routes`, `pnpm -r typecheck`, and production builds for `desktop`, `mobile`, and `web`).
2. Run `./kalaido.sh doctor:react . --no-cache --verbose --yes` and verify expected diagnostic counts drop with zero regressions.
3. For phases touching UI (`apps/desktop` or shared UI), check `added + subtracted` LOC per `apps/desktop/AGENTS.md` and report to the user if `>= 250` LOC.
4. **Do NOT run git commit/add/branch/checkout.** Report exact files changed, verification output, and stop for human review.

---

## Phase 0 — Baseline Config (`D6.1 A`) & Cat 1–3 Rework (`D1.1 D`, `D2.3 B`)

**Goal:** Commit the clean `doctor.config.json` baseline, replace `@kalaido/primitives/hooks/use-latest-ref` with `@kalaido/hooks/use-sync-ref` across **all** ref-sync sites outside `@kalaido/state`, and switch `OrganizingSplash` phrase rotation to the rAF `tick()` clock.

### Checklist
1. **Baseline config (`D6.1 A`):**
   - **Create** `doctor.config.json` at repo root with dual root + package globs (both required because `react-doctor` resolves `ignore.files` per workspace package):
     ```json
     {
       "$schema": "https://react.doctor/schema/config.json",
       "ignore": {
         "files": [
           "packages/react/primitives/src/shadcn/**",
           "src/shadcn/**"
         ]
       }
     }
     ```
2. **Create `useSyncRef` & remove `useLatestRef` (`D1.1 D`):**
   - **Create** `packages/react/hooks/src/use-sync-ref.ts` (auto-exported via `"./*": "./src/*.ts"`, zero `package.json` edits):
     ```ts
     import { type RefObject, useLayoutEffect } from "react";

     /** Synchronizes a ref's `.current` to the latest committed value after render. */
     export function useSyncRef<T>(ref: RefObject<T>, value: T): void {
       useLayoutEffect(() => {
         ref.current = value;
       });
     }
     ```
   - **Delete** `packages/react/primitives/src/hooks/use-latest-ref.ts`.
3. **Migrate all 5 ref-sync sites outside `@kalaido/state`:**
   - **Edit** `apps/desktop/src/features/onboarding/components/organizing-splash.tsx`:
     - Replace `useLatestRef` with `const propsRef = useRef({ speed, progress, onEnded, onSnapshotReady }); useSyncRef(propsRef, { speed, progress, onEnded, onSnapshotReady });` (imported from `@kalaido/hooks/use-sync-ref`).
     - Change the mount canvas `useEffect` dependency array from `[propsRef]` back to `[]`.
   - **Edit** `packages/react/features/src/fragments/components/add-fragment-modal.tsx`:
     - Replace `useLatestRef(onClose)` (`:112`) with `const onCloseRef = useRef(onClose); useSyncRef(onCloseRef, onClose);` (imported from `@kalaido/hooks/use-sync-ref`).
     - Keep `busyRef`'s `useLayoutEffect` (`:131–136`) untouched because it carries a `return () => { busyRef.current = false; }` unmount cleanup.
   - **Edit** `packages/react/hooks/src/use-kalaido-chat.ts`:
     - Import `useSyncRef` from `#use-sync-ref`.
     - Group the 9 read-only latest-value refs currently synced in `:277–287` (`context`, `timeWindow`, `onTurnComplete`, `quotaHit`, `messages`, `isLoading`, `sendMessage`, `appendSpecChanges`, `createChatInstance`) into a single `latestRef` synced via `useSyncRef(latestRef, { ... })` (keep `lastSentSpecRef`, `lastSentWindowRef`, `seededForIdRef`, `pendingWindowResendRef`, and the `chatId`-gated baseline-seed `useLayoutEffect` at `:289–297` unchanged).
   - **Edit** `packages/react/hooks/src/use-refine-session.ts`:
     - Import `useSyncRef` from `#use-sync-ref`; replace `useLayoutEffect(() => { identityRef.current = identity; })` (`:255–257`) with `useSyncRef(identityRef, identity)`.
   - **Edit** `packages/react/features/src/reflections/hooks/use-persist-schedule.ts`:
     - Import `useSyncRef` from `@kalaido/hooks/use-sync-ref`; replace `useLayoutEffect(() => { onPersistedRef.current = onPersisted; })` (`:31–33`) with `useSyncRef(onPersistedRef, onPersisted)`.
4. **Rework `OrganizingSplash` phrase rotation (`D2.3 B`):**
   - **Edit** `apps/desktop/src/features/onboarding/components/organizing-splash.tsx`:
     - Delete the two timer `useEffect` blocks (`:816–831`: `setInterval(9000)` and `setTimeout(650)`).
     - Consolidate `phraseIdx` + `phraseFading` into a single `phraseState` (`{ idx: 0, fading: false }`) updated inside the rAF `tick()` loop only when changed, computed from `t = (now - st.t0) / 1000` when `endAtRef.current === null`:
       - `const step = Math.floor(t / 9.0);`
       - `const nextFading = step > 0 && t - step * 9.0 < 0.65;`
       - `const nextIdx = (nextFading ? step - 1 : step) % PHRASES.length;`
   - **Edit** `apps/desktop/src/features/onboarding/components/organizing-splash.test.tsx`:
     - Call `flushRaf()` after `vi.advanceTimersByTime(9000)` and `vi.advanceTimersByTime(650)` so the existing test verifies rAF-driven phrase fade and swap alongside the 3.0s / 5.2s end phases.

### Phase 0 Exit Criteria
- `grep -rn "useLatestRef\|use-latest-ref" apps/ packages/` returns 0 matches (excluding `node_modules`).
- `./kalaido.sh test:ts && ./kalaido.sh check:ts` passes.
- `./kalaido.sh doctor:react . --no-cache --verbose --yes` reports **`0` errors**, `0` `shadcn/` diagnostics, and `0` warnings on all edited Phase 0 files.
- **STOP for user review & commit.**

---

## Phase 1 — Category 4: Interactive Card & Row Accessibility + Focus Hygiene (`D4.1 A`, `D4.2 A`, `D4.3 A`, `D4.4 B`)

**Goal:** Eliminate all 4 `prefer-tag-over-role` warnings, 1 `no-autofocus` warning, and all 5 `biome-ignore lint/a11y/useSemanticElements` comments repo-wide (including `StreamScreen`).

### Checklist
1. **Interactive rows (`D4.1 A`):**
   - **Edit** `packages/react/primitives/src/kalaido/list-row.tsx`:
     - In the `onClick` branch, render a non-interactive `<div className={cn(classes, "relative has-[[data-row-primary]:focus-visible]:ring-2 has-[[data-row-primary]:focus-visible]:ring-inset has-[[data-row-primary]:focus-visible]:ring-ring/50")}>`, a stretched primary `<button type="button" data-row-primary onClick={onClick} className="... outline-none after:absolute after:inset-0 after:content-['']">` around `title` + `subtitle`, and `{trailing}` in `<div className="relative z-10 pointer-events-none flex shrink-0 items-center [&_a]:pointer-events-auto [&_button]:pointer-events-auto">`.
   - **Edit** `packages/react/primitives/src/kalaido/pin-toggle.tsx`:
     - Convert `<span role="button">` to `<button type="button" disabled={disabled} aria-label={pinned ? "Unpin" : "Pin"} onClick={onToggle}>` with `focus-visible:ring-2 focus-visible:ring-ring/50`. Remove `tabIndex`, `aria-disabled`, `onKeyDown`, `e.stopPropagation()`, and `biome-ignore`.
   - **Edit** `packages/react/features/src/projections/components/projection-row.tsx`:
     - Convert outer `<button>` (`:62`) to `<div className={cn(COLUMNS, "group relative ... has-[[data-row-primary]:focus-visible]:ring-2 has-[[data-row-primary]:focus-visible]:ring-inset has-[[data-row-primary]:focus-visible]:ring-ring/50")}>`.
     - Make Column 1 the stretched `<button type="button" data-row-primary>` (`p.name` + optional `candidate` pill).
     - Change `:95` `group-focus-visible:opacity-100` → `group-focus-within:opacity-100` so keyboard focus on the row or `PinToggle` reveals unpinned `PinToggle`.
     - Put `relative z-10` on Column 4; convert `RowAction` (`:142`) to `<button type="button">` and remove `biome-ignore`.
2. **Interactive cards (`D4.2 A`):**
   - **Edit** `packages/react/primitives/src/kalaido/document-card.tsx`:
     - Keep plain `<div>` when `onClick` is omitted.
     - When `onClick` is set: `relative` outer `<div>` with `has-[[data-card-primary]:focus-visible]:ring-2 has-[[data-card-primary]:focus-visible]:ring-inset has-[[data-card-primary]:focus-visible]:ring-ring/50`, stretched `<button type="button" data-card-primary>` around `{title}`, and `relative z-10 pointer-events-none [&_a]:pointer-events-auto [&_button]:pointer-events-auto` on `trailing` and `footer` slots (so `StatusPill` and `SourceList` clicks still open the card while `Unpin`/`Dismiss` buttons fire cleanly). Remove `biome-ignore`.
     - Optionally remove now-redundant `e.stopPropagation()` in `pin-card.tsx:62` and `proposed-section.tsx:109`.
   - **Edit** `packages/react/primitives/src/kalaido/fragment-card.tsx`:
     - Same Pattern 4A layout when `onClick` is set: `relative` outer `<div>` keeping `data-testid="fragment-card"`, stretched `<button type="button" data-card-primary>` around `{displayTitle}`, `[&_a]:relative [&_a]:z-10` on `preview`. Remove `biome-ignore`.
3. **`ItemPicker` mount focus (`D4.3 A`):**
   - **Edit** `packages/react/components/src/context-picker/item-picker.tsx`:
     - Replace `autoFocus` + `// biome-ignore lint/a11y/noAutofocus` with `const localInputRef = useRef<HTMLInputElement>(null)`, optional `inputRef?: RefObject<HTMLInputElement | null>` prop, and `useEffect(() => { resolvedInputRef.current?.focus(); }, [resolvedInputRef])`.
4. **`StreamScreen` timeline row (`D4.4 B`):**
   - **Edit** `packages/react/features/src/fragments/stream-screen.tsx`:
     - Refactor timeline row `<div role="button">` (`:338–372`) to Pattern 4A: non-interactive outer `<div className="group relative ...">` with stretched `<button type="button" aria-pressed={selecting ? isSelected : undefined} onClick={() => openOrToggle(f.id)} className="... after:absolute after:inset-0 after:content-['']">` and `<Checkbox aria-hidden>` outside `<button>`. Remove `biome-ignore`.
5. **Focused tests:**
   - Add Vitest + `@testing-library/react` tests covering `ListRow` + `PinToggle`, `DocumentCard` + sibling action button, `FragmentCard`, and `ItemPicker` mount focus (verifying `document.activeElement` and zero nested `<button>`s).

### Phase 1 Exit Criteria
- `./kalaido.sh test:ts && ./kalaido.sh check:ts` passes (including `check:design` for `rounded-none`).
- `./kalaido.sh doctor:react . --no-cache --verbose --yes` confirms `prefer-tag-over-role: 0` and `no-autofocus: 0`.
- Zero `biome-ignore lint/a11y/useSemanticElements` comments remain in the repository.
- **STOP for user review & commit.**

---

## Phase 2 — Category 5: Mechanical Correctness, Performance, Keys, Module Hygiene + Adjacent Bug Fixes (`D5.1 A`, `D5.2 A`, `D5.3 A`, `D5.4 B`, `D5.5 B`, `D5.6 A`)

**Goal:** Eliminate all 19 Category 5 warnings and fix the 2 approved adjacent bugs (`projection-canvas.tsx` stale `editError` / close animation and `CloudWorkspaces.tsx` `try/catch/finally`).

### Checklist
1. **Async busy-flag safety (`D5.1 A` + adjacent `CloudWorkspaces.tsx` fix):**
   - **Edit** `packages/react/features/src/auth/cloud-workspace-picker-screen.tsx`: wrap `onSyncWorkspaces()` in `load()` and `onOpenWorkspace(id)` in `handleOpen(id)` with `try / catch (e) / finally`, resetting `setLoading(false)` / `setOpeningId(null)` in `finally` and surfacing `toError(e).message` (`@kalaido/client/lib/errors`) into `setListError` / `setOpenError`.
   - **Edit** `apps/desktop/src/features/onboarding/components/restore-provider-dialog.tsx`: wrap `validateWorkspaceLlmConfig(config)` in `try / catch (e) / finally` (`setBusy(false)` in `finally`, `toError(e).message` into `setError`, keeping `onConfirm(config)` outside `try`).
   - **Edit** `apps/desktop/src/features/onboarding/pages/CloudWorkspaces.tsx` *(adjacent fix)*: wrap `switchLocalKalaidoscope(id, { surfaceError: false })` in `handleOpen` (`:62–68`) with `try / catch (e) / finally`, resetting `setOpeningId(null)` in `finally` and setting `setOpenError(toError(e).message)` on unexpected rejection.
2. **Performance & allocation hygiene (`D5.2 A`, `D5.3 A`, `D5.4 B` + adjacent `ProjectionCanvas` fix):**
   - **Edit** `packages/react/features/src/projections/sources.ts`: build `colourById`, `projectionById`, `reflectionById` `Map`s once per non-empty spec ID list before iterating.
   - **Edit** `packages/react/features/src/rotation/next-target.ts`: build `const skipSet = new Set(skip);` before `.find(...)`.
   - **Edit** `packages/react/components/src/chat-messages.tsx` (`D5.4 B`): add module-scope `lastSettledIndices(messages: UIMessage[]): { regenerate: number; context: number }` walking backwards once with early exit, memoize with `useMemo`, and replace `settledBy(...)` with `settledAfter.regenerate > index` and `settledAfter.context > index`.
   - **Edit** `packages/lib/client/src/lib/datetime.ts` (`D5.3 A`): hoist `const shortDateTimeFormatter = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });` at module scope and use it in `formatShortDateTime`.
   - **Edit** `packages/lib/client/src/kalaidoscope/chat.ts` (`D5.2 A`): slice `records` into `CHUNK = 30` batches in `listConversations`, fetch concurrently via `Promise.all` **preserving `requestKey: null`** (catching per-chunk errors with `console.warn` and returning `[]`), and merge in deterministic chunk order.
   - **Edit** `packages/react/features/src/projections/components/projection-canvas.tsx`:
     - Hoist `const EMPTY_EDITS: SnapshotEdit[] = [];` at module scope and use `edits = EMPTY_EDITS`.
     - *(Adjacent fix)* Separate `editOpen: boolean` from `selectedBlock` (retaining `selectedBlock` during close so `EditCandidateModal`'s `key={`${sessionKey}:${oldText}`}` doesn't flash empty during the 100ms Base UI fade-out), keep `<EditCandidateModal>` mounted when `selectedBlock` has ever been set with `open={editOpen}`, and clear `setEditError(undefined)` in both `handleCloseEdit` and `handleOpenEdit(index, text)`.
3. **Stable list keys (`D5.5 B`):**
   - **Edit** `packages/react/features/src/map/map-screen.tsx`: change `:178` key to `` `${rel.from}|${rel.kind}|${rel.to}` `` and remove `i` + `biome-ignore`.
   - **Edit** `apps/desktop/src/features/status/pages/Status.tsx`: add module-scope `keyRunningTasks(runningTasks)` building `` `${t.role}\0${t.priority}\0${t.model}\0${t.started}#${occurrence}` `` via `Map<string, number>`, use at `:338`, and remove `biome-ignore`.
4. **Non-page `only-export-components` cleanup (`D5.6 A`):**
   - **Create** `apps/desktop/src/components/layout/sidecar-status.ts` exporting `phaseLabel`; remove `phaseLabel` from `sidecar-status-dot.tsx`, unexport `phaseDotClass` in `sidecar-status-dot.tsx`, and update import in `utility-bar.tsx`.
   - **Create** `apps/desktop/src/components/layout/queue-labels.ts` exporting `queueHeldLabels`; update imports in `utility-bar.tsx` and `Status.tsx`.
   - **Unexport** the 4 remaining zero-caller symbols:
     - `packages/react/primitives/src/kalaido/colour.tsx` (`contentColour`) + remove `contentColour` re-export from `packages/react/primitives/src/kalaido/index.ts`.
     - `packages/react/primitives/src/layout/location-label.tsx` (`truncatePath`).
     - `apps/desktop/src/features/settings/components/workspace-backups-panel.tsx` (`sanitizeExportName`).
     - `apps/desktop/src/routes/app-router.tsx` (`routeElements`).

### Phase 2 Exit Criteria
- `./kalaido.sh test:ts && ./kalaido.sh check:ts` passes.
- `./kalaido.sh doctor:react . --no-cache --verbose --yes` confirms all 19 Category 5 warnings are eliminated (`no-loading-flag-reset-outside-finally: 0`, `js-index-maps: 0`, `js-set-map-lookups: 0`, `js-hoist-intl: 0`, `async-await-in-loop: 0`, `rerender-memo-with-default-value: 0`, `no-array-index-as-key: 0`, and `only-export-components` reduced solely to the 26 desktop `pages/*.tsx` route exports).
- **STOP for user review & commit.**

---

## Phase 3 — Category 6 Part A (`D6.2 C`) + Part B (`D6.3 A`, `D6.4 B`)

**Goal:** Centralize desktop route definitions into `apps/desktop/src/routes/`, deduplicate the mobile/web cloud shell, and adopt shared `ConfirmDialog` across all 5 simple confirmation dialogs — reaching **`~88+ / 100 Great`** (`0` errors, `0` Bug/Perf/A11y warnings; only Part C Maintainability warnings remaining).

### Checklist
1. **Centralize desktop route definitions (`D6.2 C`):**
   - **Create** `apps/desktop/src/routes/definitions.ts` holding all 26 `defineRoute(...)` declarations (keeping every desktop URL, alias, `requiredScope`, `feature`, `transitions`, and `Component` visible in one place).
   - **Edit** `apps/desktop/src/routes/registry.ts` to import the route list from `./definitions` instead of 25 individual page files.
   - **Edit** all 25 `apps/desktop/src/features/*/pages/*.tsx` files to remove `export const *Route = defineRoute(...)` and unused `defineRoute` imports (exporting only the page React component; keep `*.transitions.ts` co-located in feature folders).
2. **Deduplicate mobile & web cloud shells (`D6.3 A`):**
   - **Create** `packages/react/components/src/cloud-error-boundary.tsx` (re-exported from `packages/react/components/src/index.ts`) accepting `onBeforeClear: () => Promise<void>`.
   - **Extract** router-free `pathForCloudStage` and `useCloudWorkspacesList` into `@kalaido/hooks` (e.g., `packages/react/hooks/src/cloud-root-scope.ts`) and router-free cloud boot-error/explore page views into `@kalaido/features/auth` (or `@kalaido/components`), with **zero `react-router-dom` imports in `packages/*`**.
   - **Edit** `apps/mobile/src/app.tsx` and `apps/web/src/app.tsx` to become thin router shells (~75 lines each) rendering routes via `<Routes>{CLOUD_ROUTES.map((r) => <Route key={r.path} path={r.path} Component={r.Component} />)}</Routes>` (`5` JSX nodes `< 6` threshold).
3. **Shared `ConfirmDialog` across all 5 simple confirm sites (`D6.4 B`):**
   - **Create** `packages/react/primitives/src/kalaido/confirm-dialog.tsx` (re-exported from `packages/react/primitives/src/kalaido/index.ts`) wrapping `#shadcn/alert-dialog`:
     - Props: `title: ReactNode`, `description: ReactNode`, `confirmLabel?: ReactNode` (default `"Confirm"`), `cancelLabel?: ReactNode` (default `"Cancel"`), `variant?: "default" | "destructive"`, `busy?: boolean`, `onConfirm: () => void`, plus optional `trigger?: ReactElement` and optional `open?: boolean` / `onOpenChange?: (open: boolean) => void`.
   - **Adopt** at all 5 simple confirm sites:
     1. `packages/react/features/src/colours/components/colour-detail-pane.tsx` (`trigger={<Button ...>}`)
     2. `packages/react/features/src/projections/projection-detail-screen.tsx` (controlled `open`/`onOpenChange`)
     3. `packages/react/features/src/projections/projection-review-screen.tsx` (controlled `open`/`onOpenChange`, `busy`, `variant="destructive"`)
     4. `apps/desktop/src/features/onboarding/components/duplicate-workspace-dialog.tsx`
     5. `apps/desktop/src/features/settings/components/workspace-backups-panel.tsx`
   - Leave `restore-provider-dialog.tsx` on raw `AlertDialog` (embeds `<ProviderFields />`).

### Phase 3 Milestone Gate
- Run `./kalaido.sh test:ts && ./kalaido.sh check:ts` (explicitly confirms `validate-routes OK — 26 desktop routes`, `check:nav`, `check:boundaries`, `check:design`, and desktop/mobile/web production builds).
- Run `./kalaido.sh doctor:react . --no-cache --verbose --yes` and confirm:
  - `only-export-components: 0`
  - `duplicate-jsx-subtree: 0`
  - `0` errors; `0` Bug/Perf/A11y warnings; **record the exact surviving list of `no-giant-component` and `no-high-complexity-react-function` warnings** (e.g., `ChatPanel` is already ~232 LOC after Cat 3 and should no longer appear).
- Report LOC budget for UI changes and **STOP for user review & commit.**

---

## Phase 4 — Category 6 Part C: Structural Decomposition Waves (`D6.5 A`, `D6.6 A`, `D6.7 A`) → `100 / 100`

**Governing Rules Across All Phase 4 Waves:**
- **Re-check actual surviving list from the Phase 3 milestone scan:** Skip any target that already dropped to `<= 300` LOC and `CC <= 15 && Cog <= 15` during Phases 0–3.
- **Strictly private co-location (`D6.6 A`):** Never expand public barrels or `package.json` exports. Inside `packages/react/components/`, place extracted files in private subdirectories (`src/chat/`, `src/fragment-drawer/`) so `"./*": "./src/*.tsx"` does not leak them as public exports.
- **Pure `.ts` helpers & action hooks first (`D6.7 A`):** Extract pure branching/status/formatting logic into `.ts` modules and workflow handlers into feature-local hooks before splitting JSX; split JSX sub-components only along genuine visual/domain seams.
- **Checkpoints:** Run the Standard Phase Gate (including the `apps/desktop/AGENTS.md` 250-LOC UI change budget check) and **STOP for user review & commit after each wave**.

### Wave 4A — Projections (`packages/react/features/src/projections/`)
- `projection-review-screen.tsx`: extract `outdated-reason.ts` (`formatOutdatedCandidate`), `hooks/use-projection-review-actions.ts`, `components/review-header-actions.tsx`, and `components/review-refine-column.tsx`.
- `projection-detail-screen.tsx`: extract pure timeline/fork-seed `.ts` helpers (`buildSnapshotTimeline`, `buildForkSeed`) and `components/projection-detail-actions.tsx` (Branch + More menus).
- `components/projection-side-rail.tsx`: extract `components/projection-freshness-card.tsx` (or per-status helper).
- `components/snapshot-preview.tsx`: split `readOnly` (`<HistoricalSnapshotPreview>`) from live (`<LiveSnapshotPreview>`).
- `components/projection-draft-editor.tsx`: extract pure `draftPhaseStatus` / `approveButtonLabel` helpers and `<DraftPreviewColumn>`.
- **Gate + STOP for user review & commit.**

### Wave 4B — Reflections, Colours, Map & Rotation (`packages/react/features/src/`)
- `reflections/reflection-refine-screen.tsx`: extract `components/reflection-refine-middle-pane.tsx` and seed/action helpers.
- `reflections/components/reflection-series-panel.tsx`: extract `<SelectedWindowView>` + pure button-label helpers.
- `reflections/components/live-preview-pane.tsx`: extract pure `previewPhasePillLabel` & `emptyPreviewCopy` helpers at module top (zero extra `.tsx` files).
- `colours/components/colour-detail-pane.tsx`: if still `> 300` LOC after `ConfirmDialog`, extract `<ColourPromptSection>`.
- `map/map-screen.tsx`: extract `<MapThingsSection>` and `<MapRelationshipsSection>`.
- `rotation/components/active-rotation-card.tsx`: extract pure badge/CTA presentation `.ts` helper (zero extra `.tsx` files if complexity drops `<= 15`).
- **Gate + STOP for user review & commit.**

### Wave 4C — Shared Components (`packages/react/components/src/`)
- `chat-messages.tsx`: extract `src/chat/edit-notice.ts` (`describeEditNotice`) + `src/chat/edit-notice-card.tsx` (`<EditNoticeUndoControl>`, `<EditNoticeBody>`).
- `fragment-drawer.tsx`: extract `src/fragment-drawer/fragment-drawer-body.tsx` (or loading body).
- `context-meter/use-prompt-estimate.ts`: extract pure `buildPromptEstimate(...)` helper in `.ts` (drops CC from 16 to ~8).
- `chat-panel.tsx`: *only if still flagged after Phase 3* — extract private helpers into `src/chat/`.
- **Gate + STOP for user review & commit.**

### Wave 4D — Explore & Stream (`packages/react/features/src/`)
- `explore/explore-screen.tsx`: extract `hooks/use-explore-session.ts` (recent-conversation restore + history context sync) or `<ExploreHistoryAside>` + `<ExploreHeaderActions>`.
- `explore/explore-compact-screen.tsx`: extract `components/compact-explore-header.tsx` (workspace switcher + action buttons).
- `fragments/stream-screen.tsx`: extract `<StreamTimelineRow>` into `fragments/components/stream-parts.tsx`.
- **Gate + STOP for user review & commit.**

### Wave 4E — Desktop Screens (`apps/desktop/src/features/`)
- `onboarding/components/organizing-splash.tsx`: move pure canvas math/drawing helpers + `requestAnimationFrame` `runSplashLoop` (including D2.3 B's rAF phrase calculation) into `onboarding/components/organizing-splash-canvas.ts`, leaving `OrganizingSplash` as a ~110-line React wrapper.
- `status/pages/Status.tsx`: extract `status/components/organize-pipelines-column.tsx`, `llm-queue-card.tsx`, and `workspace-event-log-card.tsx`.
- `create-kalaidoscope/pages/KalaidoscopeSetup.tsx`: extract `cloud-id.ts` (`deriveCloudId`, `randomFallbackCloudId`, `describeCloudIdStatus`), `hooks/use-cloud-id-check.ts`, `components/setup-sign-in-gate.tsx`, and `components/cloud-id-field.tsx`.
- `settings/components/kalaidoscope-row.tsx`: extract `settings/components/kalaidoscope-row-actions.tsx`.
- **Final Gate:**
  - `./kalaido.sh test:ts && ./kalaido.sh check:ts` — 100% green.
  - `./kalaido.sh doctor:react . --no-cache --verbose --yes` — **`100 / 100` (`0` errors, `0` warnings)**.
  - **STOP for final user review & commit.**
