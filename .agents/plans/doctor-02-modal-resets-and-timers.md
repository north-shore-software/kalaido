# React Doctor — Category 2: Modal / Prop-Change State Resets & Uncleaned Timers

**Baseline scan:** `react-doctor` full-repo run (`42 / 100`, 138 issues total)  
**Diagnostics covered (8 non-shadcn issues across 4 files):**
- `react-doctor/effect-needs-cleanup` — **3 errors** (`Bugs`; excludes 1 in `packages/react/primitives/src/shadcn/carousel.tsx:93`, handled in Category 6 baseline config)
- `react-doctor/no-adjust-state-on-prop-change` — **5 warnings** (`Bugs`)

---

## 1. The Anti-Pattern

Two coupled React anti-patterns appear across modals, hooks, and animated views:

1. **Adjusting local state in `useEffect` when a prop (`open`, `enabled`, `ending`) changes (`no-adjust-state-on-prop-change`, ×5):**
   - `AddFragmentModal` (`add-fragment-modal.tsx:80–92`) stays mounted while closed inside `PageLayout` and runs `useEffect([open, ...])` with `wasOpenRef` to wipe `text` (`:82`), `colour` (`:85`), note state, and picker state whenever `open` transitions from `false` to `true`. (`EditCandidateModal` `:39–44` similarly runs `setText(oldText)` in `useEffect([open, oldText])`.)
   - `useColourPreview` (`use-colour-preview.ts:77–79`) runs `useEffect(() => { if (!enabled) setTypeFilter("all"); }, [enabled])` instead of deriving the effective filter, scoping filter state to the mounted composer UI, or resetting on workflow transitions.
   - `OrganizingSplash` (`organizing-splash.tsx:806–818`) runs `useEffect([ending, triggerEnd])` to call `triggerEnd()`, which synchronously calls `setStatus("finalizing snapshot…")` (`:809`) and `setStatusOpacity(1)` (`:810`).
   - Effects that reset or override state after commit pay an extra render (allowing stale content to flash for 1 frame) and entangle prop transitions with imperative effect choreography.

2. **Timers in `useEffect` without statically verifiable per-allocation cleanup (`effect-needs-cleanup`, ×3):**
   - `AddFragmentModal` (`:88`) and `EditCandidateModal` (`:42`) focus their `<Textarea>` via `setTimeout(() => textareaRef.current?.focus(), 0)` inside `useEffect` with no returned `clearTimeout` cleanup (and race with Base UI `DialogContent`'s built-in `FloatingFocusManager`).
   - `OrganizingSplash` (`:840–850`) allocates a nested `swapTimer = setTimeout(..., 650)` inside a repeating `setInterval(..., 9000)` callback inside the giant canvas `useEffect` (`:820–1078`). Although `:1075` already calls `clearTimeout(swapTimer)` on unmount, reassigning a mutable `let swapTimer` inside a nested repeating callback cannot be statically verified as leak-free by `oxlint-plugin-react-doctor` (even adding `clearTimeout(swapTimer)` right before reassignment still triggers `effect-needs-cleanup`).

---

## 2. Target Codebase Patterns

### Pattern 2A — Inner Modal Form Body Inside `DialogContent` (Preserving Base UI Exit Animations)
`packages/react/primitives/src/shadcn/dialog.tsx` wraps `@base-ui/react/dialog` (`1.9.0`):
- `DialogContent` (`DialogPrimitive.Popup`) plays a `100ms` CSS exit animation (`duration-100 ... data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95`).
- Base UI's `useUnmountAfterClose` keeps `mounted === true` for the `100ms` exit animation, and `DialogPortal` (`keepMounted = false` by default) returns `null` while `mounted === false` and unmounts its children automatically once the exit animation completes.
- Therefore, rendering `{open && <InnerForm />}` inside `<DialogContent>` is an anti-pattern here: it unmounts `<InnerForm />` at `t = 0ms` while `DialogPrimitive.Popup` stays visible for `100ms` as an empty `p-6` box.
- Instead, render an unconditional `<InnerForm key={sessionKey} />` inside `<DialogContent>` (see **D2.1** for `sessionKey` mechanism):
  - Does **not** mount while closed (`DialogPortal` returns `null` when `mounted === false`).
  - Initializes fresh draft state on open with zero `useEffect` resets or `wasOpenRef`.
  - Remains intact during the `100ms` exit animation and unmounts cleanly once the animation finishes.
  - Uses a `busyRef` synced via `useLayoutEffect` (not an upward `onBusyChange` state callback, which would trip `no-prop-callback-in-effect`) when the outer `<Dialog onOpenChange>` needs to block dismissal while saving/uploading.

### Pattern 2B — Dialog Initial Focus Without Uncleaned Timers
`shadcn/dialog.tsx` (`:44, :56`) already types `DialogContent` as `DialogPrimitive.Popup.Props` and forwards `{...props}` directly to `DialogPrimitive.Popup`, which natively supports `initialFocus={textareaRef}` with zero edits to `shadcn/dialog.tsx`. Where imperative focus is used on mount or tab change, every `setTimeout` / `requestAnimationFrame` in `useEffect` must return its matching `clearTimeout` / `cancelAnimationFrame` cleanup (see **D2.2**).

### Pattern 2C — Render Derivation + Async Phase State Instead of Prop-Sync Effects
- **In `OrganizingSplash`:** `ending` cannot simply override `status` and `statusOpacity` unconditionally (`ending ? "finalizing snapshot…" : status`), because `ending` stays `true` throughout the 5.2s end sequence while the `requestAnimationFrame` `tick()` loop transitions status to `"snapshot ready"` at `te > 3.0s` (`:894–898`) and fades opacity to `0` at `te > 5.2s` (`:900–904`). Instead, track async end-sequence milestones (`endPhase`: `"none" | "finalizing" | "ready" | "faded"`, mutated only from the rAF loop) and derive `inEndSequence = ending || endPhase !== "none"`, `displayedStatus`, and `displayedOpacity` during render — while decoupling phrase cycling from nested `setInterval` + `setTimeout` timers (see **D2.3**).
- **In `useColourPreview`:** Remove `useEffect(() => { if (!enabled) setTypeFilter("all"); }, [enabled])` and handle filter reset via composer lifecycle, workflow events, or render derivation (see **D2.4**).

---

## 3. File-by-File Inventory & Migration Plan

| File | Line(s) | Rule(s) | Planned Change |
|---|---|---|---|
| `packages/react/features/src/fragments/components/add-fragment-modal.tsx` | 80, 82, 85 | `effect-needs-cleanup` (×1 error), `no-adjust-state-on-prop-change` (×2) | Split stateful draft content (`text`, `colour`, `useNoteIngest`, `useImportPicker`, `useImportSubmit`, `useLiveCollection("colour")`) into `<AddFragmentModalBody>` rendered inside `<DialogContent>` per **D2.1**, **D2.2**, and **D2.5**. Guard `Dialog` dismissal via a `busyRef` synced in `useLayoutEffect` (avoiding `no-prop-callback-in-effect` and keeping cyclomatic/cognitive complexity below threshold). Remove `wasOpenRef` and the open-reset `useEffect`. |
| `packages/react/features/src/projections/components/edit-candidate-modal.tsx` | 39 | `effect-needs-cleanup` (×1 error) | Remove `useEffect([open, oldText])` (`setText` + uncleaned `setTimeout`); adopt the modal reset and initial focus mechanisms selected in **D2.1** and **D2.2**. |
| `apps/desktop/src/features/onboarding/components/organizing-splash.tsx` | 809, 810, 820 | `no-adjust-state-on-prop-change` (×2), `effect-needs-cleanup` (×1 error) | 1) Remove `setStatus`/`setStatusOpacity` from `useEffect([ending])`; record `stateRef.current.endAt` in `useEffect([ending])`, track rAF milestones (`"ready"` at `te > 3.0s`, `"faded"` at `te > 5.2s`) in `endPhase` state, and derive `displayedStatus` & `displayedOpacity` during render. 2) Replace the nested `setTimeout`-inside-`setInterval` phrase swap (`:840–850`) per **D2.3**. |
| `packages/react/features/src/colours/hooks/use-colour-preview.ts` | 78 | `no-adjust-state-on-prop-change` (×1) | Remove `useEffect(() => { if (!enabled) setTypeFilter("all"); }, [enabled])` and apply the filter reset / ownership model selected in **D2.4** (updating sole caller `colours-screen.tsx` / `colour-composer-pane.tsx` if selected). |

### Invariants & Out-of-Scope Findings
- **Base UI dialog animations:** `<DialogContent>` must retain its children while `data-closed` plays its `100ms` exit animation (`shadcn/dialog.tsx:53`).
- **`AddFragmentModal` tab switching:** Switching between `write` and `import` tabs within one open session must preserve draft `text`, picked `file`, and `colour` within that session, and focus the `<Textarea>` when switching to `write`.
- **`OrganizingSplash` end timeline:** Must preserve `"finalizing snapshot…"` (opacity `1`) at `te = 0..3.0s`, `"snapshot ready"` + `onSnapshotReady?.()` at `te > 3.0s`, and opacity `0` + `onEnded?.()` at `te > 5.2s`, as well as immediate navigation on `onSkip`.
- **Adjacent bug noted (not modified without direction):** In `packages/react/features/src/projections/components/projection-canvas.tsx:61,97,196`, `EditCandidateModal`'s sole caller clears `editError` only at the start of `handleApplyEdit`, not in `onClose` or when selecting a new block — so cancelling after a failed hand-edit and clicking `Edit` on another block shows the stale error message from the previous attempt. Also note `projection-canvas.tsx:190` currently wraps `<EditCandidateModal>` in `{selectedBlock && ...}`, which unmounts `<Dialog>` immediately on close and skips its 100ms close animation.

---

## 4. Decision Points

| ID | Decision | Feasible Options | Cross-Plan Coupling | Selected |
|---|---|---|---|---|
| **D2.1** | Modal draft state reset mechanism (`AddFragmentModal` & `EditCandidateModal`) | Option A (`<InnerBody key={sessionKey} />` with render-phase `prevOpen` transition), Option B (`<InnerBody key={sessionKey} />` incremented in `<Dialog onOpenChangeComplete>`), Option C (Caller-owned `key` / conditional mount) | `doctor-01` (`busyRef` via `useLayoutEffect`), `doctor-03` (avoids `no-prop-callback-in-effect`), `doctor-06` (keeps CC/Cog ≤ 15) | **Option A** |
| **D2.2** | Modal initial & tab-switch `<Textarea>` focus (`AddFragmentModal` & `EditCandidateModal`) | Option A (Base UI `<DialogContent initialFocus={...}>`), Option B (Cleaned-up `useEffect` with `requestAnimationFrame` / `setTimeout`) | `doctor-04` (`no-autofocus` focus hygiene) | **Option A** |
| **D2.3** | `OrganizingSplash` `ending` state transitions & phrase-timer cleanup | Option A (`endPhase` derivation + split declarative `setInterval` / `setTimeout` effects), Option B (`endPhase` derivation + rAF `tick()` elapsed-time phrase calculation) | `doctor-01` (`organizing-splash.tsx:801–804` ref writes & lazy `generateChips()`), `doctor-06` (`organizing-splash.tsx:770` `no-giant-component` canvas extraction) | **Option A** |
| **D2.4** | `useColourPreview` `typeFilter` reset semantics & ownership | Option A (Own `typeFilter` inside conditionally mounted `ColourComposerPane`), Option B (Render-phase `prevEnabled` reset inside `useColourPreview`), Option C (Derive `effectiveTypeFilter` + reset in `ColoursScreen` `openComposer`), Option D (Derive `effectiveTypeFilter` only; persist choice across composer toggles) | `None` | **Option A** |
| **D2.5** | `AddFragmentModal` active tab (`"write"` vs `"import"`) across close/reopen | Option A (Keep `tab` in outer `AddFragmentModal` — preserves last-used tab across opens), Option B (Move `tab` into `AddFragmentModalBody` — resets to `"write"` on every open) | `None` | **Option B** |

---

### D2.1 — Modal Draft State Reset Mechanism (`AddFragmentModal` & `EditCandidateModal`)

**Decision:** **Option A** — `<InnerBody key={sessionKey} />` Inside `DialogContent` with Render-Phase `prevOpen` Guard

**Files & Callers Verified:**
- `packages/react/primitives/src/shadcn/dialog.tsx:7–9, 39–77` + `@base-ui/react/dialog` (`DialogPortal.mjs:24–30`, `useUnmountAfterClose.mjs:53–91`, `useTransitionStatus.mjs:15–30`):
  - `DialogContent` has `duration-100 ... data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95`.
  - `DialogPortal` (`keepMounted = false`) does **not** render children while closed (`mounted === false`), keeps children mounted while `data-closed` animates (`100ms`), and unmounts them when the animation completes.
  - Note: in `AddFragmentModal`, moving `useLiveCollection("colour", ...)` (`:74–77`) into the inner body inside `DialogContent` also stops subscribing to the `colour` collection on every workspace screen while the modal is closed!
- `AddFragmentModal` (`packages/react/features/src/fragments/components/add-fragment-modal.tsx:47–297`):
  - Sole caller: `PageLayout` (`apps/desktop/src/components/layout/page-layout.tsx:54–63`), always mounted on workspace routes and controlled by `desktopScope` (`addFragmentModalOpen` via `apps/desktop/src/state/app-state-actions.ts:9–15`).
  - No existing unit tests.
- `EditCandidateModal` (`packages/react/features/src/projections/components/edit-candidate-modal.tsx:28–96`):
  - Not exported from `packages/react/features/src/projections/index.ts`; internal to `projections/`.
  - Sole caller: `ProjectionCanvas` (`packages/react/features/src/projections/components/projection-canvas.tsx:190–199`), currently rendered as `{selectedBlock && <EditCandidateModal open={!!selectedBlock} ... />}`.
  - No existing unit tests.

**Cross-Plan Coupling:**
- **`doctor-01` (`no-ref-current-in-render`):** Tracking `sessionKey` via `useRef` in render (`if (open && !wasOpenRef.current) sessionRef.current++`) is forbidden by Category 1. Similarly, sharing `busy` (`saving || importSubmitting`) from `<AddFragmentModalBody>` to `<Dialog onOpenChange>` uses a `busyRef` updated inside `useLayoutEffect` (matching Category 1 Pattern 1A).
- **`doctor-03` (`no-prop-callback-in-effect`):** Passing `onBusyChange={setBusy}` to `<AddFragmentModalBody>` and calling it in `useEffect`/`useLayoutEffect` was empirically tested and **trips `react-doctor/no-prop-callback-in-effect`**. Using `busyRef` avoids this completely.
- **`doctor-06` (`no-high-complexity-react-function`):** `AddFragmentModal` currently sits at cognitive complexity 15 (1 below React Doctor's warning threshold of 16). Using `busyRef` keeps `<AddFragmentModalBody>` ≤ 15 with zero new maintainability warnings.

#### Option A — `<InnerBody key={sessionKey} />` Inside `DialogContent` with Render-Phase `prevOpen` Guard
- **How it works:**
  - Keep `<Dialog open={open}>` and `<DialogContent>` in the outer modal component (`add-fragment-modal.tsx`, `edit-candidate-modal.tsx`).
  - Track `const [prevOpen, setPrevOpen] = useState(open); const [sessionKey, setSessionKey] = useState(0); if (open !== prevOpen) { setPrevOpen(open); if (open) setSessionKey((k) => k + 1); }` in the outer shell (for `EditCandidateModal`, `key={`${sessionKey}:${oldText}`}`).
  - Render `<AddFragmentModalBody key={sessionKey} ... />` / `<EditCandidateForm key={...} ... />` unconditionally inside `<DialogContent>`.
- **Verification:**
  - Prototyped in both `add-fragment-modal.tsx` and `edit-candidate-modal.tsx`; verified with Vitest + `@testing-library/react` DOM animation test, `pnpm --filter @kalaido/features typecheck`, `pnpm exec biome lint --error-on-warnings`, `pnpm check:boundaries`, `pnpm check:design`, and `pnpm dlx react-doctor@latest . --verbose --yes` (`0` errors/warnings on both files; `no-adjust-state-on-prop-change` and `no-derived-state` both `0`).
- **Pros:**
  - Preserves Base UI's full `100ms` exit animation with form content intact until `DialogPortal` unmounts.
  - Guarantees fresh state even if the modal is closed and reopened mid-exit-animation (<100ms) or closed externally via `closeAddFragmentModal()`.
  - Self-contained inside the two modal files; zero caller changes required.
- **Cons:**
  - Uses React's render-phase `if (open !== prevOpen)` state transition idiom (4 lines per modal).

#### Option B — `<InnerBody key={sessionKey} />` Inside `DialogContent` Incremented in `<Dialog onOpenChangeComplete>`
- **How it works:**
  - Same inner body split in `add-fragment-modal.tsx` and `edit-candidate-modal.tsx`, without `prevOpen` state.
  - Pass `onOpenChangeComplete={(o) => { if (!o) setSessionKey((k) => k + 1); }}` to `<Dialog>` (`DialogPrimitive.Root` forwards `onOpenChangeComplete` in `shadcn/dialog.tsx:7–9`). When the 100ms close animation finishes, `DialogPortal` unmounts `<InnerBody />` and `sessionKey` advances. (For `EditCandidateModal`, `key={`${sessionKey}:${oldText}`}` also resets if `oldText` changes.)
- **Verification:**
  - Prototyped in `add-fragment-modal.tsx`; verified with `pnpm --filter @kalaido/features typecheck`, `pnpm exec biome lint --error-on-warnings`, and `pnpm dlx react-doctor@latest . --verbose --yes` (`0` errors/warnings).
- **Pros:**
  - No render-phase `setState` guard; uses Base UI's native post-animation lifecycle callback.
  - Preserves exit animations and self-contained modal APIs.
- **Cons:**
  - If `open` flips `true → false → true` programmatically within `<100ms` before the exit animation completes, `onOpenChangeComplete(false)` has not fired yet, so the mid-animation reopen would retain the previous draft.

#### Option C — Caller-Controlled Session Key / Conditional Mount
- **How it works:**
  - For `EditCandidateModal`: `ProjectionCanvas` (`projection-canvas.tsx:190–199`) already conditionally mounts `{selectedBlock && <EditCandidateModal ... />}` (or can pass `key={selectedBlock.index}`), so `EditCandidateModal` simply initializes `useState(oldText)` on mount with no inner split.
  - For `AddFragmentModal`: store `addFragmentSession: number` in `apps/desktop/src/state/app-state.ts` (incremented on `setAddFragmentModalOpen` when `open: true`) and pass `key` into `<AddFragmentModalBody key={sessionKey} />` (note: putting `key` on `<AddFragmentModal>` itself would remount `<Dialog open={true}>` on open, which skips Base UI's enter animation because `animateInitialOpen` defaults to `false` in `useTransitionStatus.mjs:15`).
- **Verification:**
  - Verified against `@base-ui/react` `useTransitionStatus.mjs:15–24` and `desktopScope` architecture.
- **Pros:**
  - Moves session identity into explicit event transitions for `ProjectionCanvas` / `desktopScope`.
- **Cons:**
  - Couples callers to modal reset mechanics; future callers of `AddFragmentModal` (e.g. `apps/web` or `apps/mobile`) or `EditCandidateModal` would have to remember to manage `sessionKey` externally, and `{selectedBlock && <EditCandidateModal />}` continues to skip close animations.

#### Ruled-Out Options
- **`{open && <InnerForm />}` inside `<DialogContent>`:** Verified in Vitest (`jsdom` with mocked `Element.prototype.getAnimations`) and `shadcn/dialog.tsx:53`: when `open` flips to `false`, `<InnerForm />` unmounts at `t = 0ms` while `DialogPrimitive.Popup` stays mounted with `data-closed` for `100ms`, collapsing the modal to an empty `p-6` bordered box during fade-out.
- **Resetting fields inside `handleClose` / `onOpenChange(false)` only:** Fails in two ways: (1) wipes visible text/file fields at `t = 0ms` on the first frame of the `100ms` fade-out animation, and (2) misses programmatic closes via `closeAddFragmentModal()` (`apps/desktop/src/state/app-state-actions.ts:13`) or `oldText` prop changes in `EditCandidateModal`.

---

### D2.2 — Modal Initial & Tab-Switch `<Textarea>` Focus (`AddFragmentModal` & `EditCandidateModal`)

**Decision:** **Option A** — Base UI `<DialogContent initialFocus={...}>` (+ Tab-Switch Focus in `AddFragmentModal`)

**Files & Callers Verified:**
- `packages/react/primitives/src/shadcn/dialog.tsx:39–57` + `@base-ui/react/dialog/popup/DialogPopup.d.ts:12–25` + `FloatingFocusManager.mjs:357–420`:
  - `DialogContent` already accepts `DialogPrimitive.Popup.Props` and spreads `{...props}` onto `DialogPrimitive.Popup` — **no edit to `shadcn/dialog.tsx` is required** (respecting `AGENTS.md` / `biome.json` rules on `shadcn/`).
  - Without `initialFocus`, Base UI's `FloatingFocusManager` focuses the first tabbable element (`"Start writing"` button in `AddFragmentModal:143`; `<Textarea>` in `EditCandidateModal:66` since `showCloseButton={false}`), which is why `AddFragmentModal` previously raced it with `setTimeout(..., 0)`.
- `packages/react/features/src/fragments/components/add-fragment-modal.tsx:87–89, 144–147`:
  - Needs `<Textarea>` focus both when opening on `tab === "write"` and when clicking the `"Start writing"` tab button from `tab === "import"`.
- `packages/react/features/src/projections/components/edit-candidate-modal.tsx:42, 66–73`:
  - Always opens with `<Textarea>` as the primary control (unless `saving` is true).

**Cross-Plan Coupling:**
- **`doctor-04` (`no-autofocus`):** Category 4 eliminates HTML `autoFocus` attributes (`item-picker.tsx:104`) in favor of ref-based focus; neither Option A nor Option B uses HTML `autoFocus`, so neither conflicts with `react-doctor/no-autofocus` or Biome `lint/a11y/noAutofocus`.

#### Option A — Base UI `<DialogContent initialFocus={...}>` (+ Tab-Switch Focus in `AddFragmentModal`)
- **How it works:**
  - In `edit-candidate-modal.tsx`: pass `initialFocus={textareaRef}` directly to `<DialogContent>` — zero `useEffect` and zero timers.
  - In `add-fragment-modal.tsx`: pass `initialFocus={tab === "write" ? textareaRef : undefined}` to `<DialogContent>` for open focus; for switching from `"import"` to `"write"` while already open, either keep the inline `onClick` focus or run a `[tab]` effect with `cancelAnimationFrame` cleanup when `tab === "write"`. (Note: if a timer is used for tab-switch, keep it either in a cleaned-up `useEffect([tab])` or directly inline in JSX `onClick`; extracting an uncleaned `setTimeout` into a named component helper function trips `react-doctor/effect-needs-cleanup`.)
- **Verification:**
  - Verified in Vitest (`expect(screen.getByLabelText("target-textarea")).toHaveFocus()` passed with zero edits to `shadcn/dialog.tsx`), `tsc --noEmit`, `biome lint --error-on-warnings`, and `react-doctor` (`0` issues).
- **Pros:**
  - Integrates natively with Base UI's `FloatingFocusManager` instead of racing a macrotask timer against Base UI's initial focus.
  - Eliminates all `useEffect` / timer code from `EditCandidateModal`.
  - Respects Base UI's touch-device safeguard (avoids unexpectedly popping virtual keyboards when opened by touch if using a resolver, or focuses `textareaRef` directly).
- **Cons:**
  - `AddFragmentModal` still needs a small focus step when switching `"import" → "write"` while the dialog is already open (since `initialFocus` only runs on dialog open).

#### Option B — Cleaned-Up `useEffect` (`requestAnimationFrame` or `setTimeout`) Inside Inner Modal Body
- **How it works:**
  - In `edit-candidate-modal.tsx` (`EditCandidateForm`): `useEffect(() => { const id = requestAnimationFrame(() => textareaRef.current?.focus()); return () => cancelAnimationFrame(id); }, []);` (or `setTimeout(..., 0)` + `clearTimeout(id)`).
  - In `add-fragment-modal.tsx` (`AddFragmentModalBody`): a single `useEffect(() => { if (tab !== "write") return; const id = requestAnimationFrame(() => textareaRef.current?.focus()); return () => cancelAnimationFrame(id); }, [tab]);` handles **both** initial open on `"write"` and switching `"import" → "write"`, removing the duplicate `setTimeout` from the tab button `onClick` (`:146`).
- **Verification:**
  - Prototyped in both files; verified with `pnpm --filter @kalaido/features typecheck`, `pnpm exec biome lint --error-on-warnings`, and `pnpm dlx react-doctor@latest . --verbose --yes` (`0` errors/warnings, CC/Cog stays ≤ 15).
- **Pros:**
  - One unified 5-line `useEffect([tab])` in `AddFragmentModalBody` handles both initial open and tab switching cleanly.
  - Preserves exact existing focus behavior across desktop and tests without touching `DialogContent` props.
- **Cons:**
  - Still runs Base UI's default first-tabbable focus on `"Start writing"` button before moving focus to `<Textarea>` on the next frame/tick.

---

### D2.3 — `OrganizingSplash` `ending` State Transitions & Phrase-Timer Cleanup

**Decision:** **Option A** — `endPhase` State + Render Derivation & Split Declarative Phrase Effects

**Files & Callers Verified:**
- `apps/desktop/src/features/onboarding/components/organizing-splash.tsx:770–1111`:
  - `triggerEnd` (`:806–812`) is called **only** in `useEffect([ending, triggerEnd])` (`:814–818`) — neither `onSkip` (`:1085`) nor `tick` calls `triggerEnd()`.
  - However, once `stateRef.current.endAt` is non-null, the `requestAnimationFrame` `tick()` loop (`:889–905`) drives two subsequent React state transitions:
    - `te > 3.0`: `setStatus("snapshot ready")` + `st.onSnapshotReady?.()` (`:894–898`).
    - `te > 5.2`: `setStatusOpacity(0)` + `st.onEnded?.()` (`:900–904`).
  - `:840–850` & `:1074–1075`: `clearTimeout(swapTimer)` **already exists** at `:1075`, yet `oxlint-plugin-react-doctor` still reports `effect-needs-cleanup` at `:820` because `swapTimer = setTimeout(..., 650)` is allocated inside a repeating `setInterval` callback.
- Sole caller: `OnboardingOrganizing` (`apps/desktop/src/features/onboarding/pages/OnboardingOrganizing.tsx:14–19`), passing `progress={progress}`, `ending={stage === "idle"}` (from `usePipelineProgress` in `apps/desktop/src/features/onboarding/hooks/use-pipeline-progress.ts:13–23`), `onSkip={toApp}`, and `onEnded={toApp}`.

**Cross-Plan Coupling:**
- **`doctor-01` (`organizing-splash.tsx:784–804`):** Category 1 touches the exact same hook preamble in `OrganizingSplash` (moving `stateRef.current.{speed,progress,onEnded,onSnapshotReady}` render-phase writes into `useLayoutEffect` and lazy-initializing `generateChips()`). Also note `stateRef.current.ending` (`:786`) is dead (never updated or read in `tick`) and can be removed alongside Category 1/2 edits.
- **`doctor-06` (`organizing-splash.tsx:770` `no-giant-component`):** Category 6 Tier 3 extracts the canvas loop (`runSplashLoop`) out of `OrganizingSplash` into a sibling `.ts` module. Option B below aligns directly with moving all time-based animation state into that loop, whereas Option A keeps phrase timers as React effects in the component.

#### Option A — `endPhase` State + Render Derivation & Split Declarative Phrase Effects
- **How it works:**
  - Replace `triggerEnd` + `setStatus`/`setStatusOpacity` in `useEffect([ending])` with:
    - `endPhase` state (`"none" | "finalizing" | "ready" | "faded"`), updated **only** inside the rAF `tick()` loop (`"finalizing"` on first frame with `endAt !== null`, `"ready"` at `te > 3.0`, `"faded"` at `te > 5.2`).
    - `useEffect([ending])` sets only `if (ending && stateRef.current.endAt === null) { stateRef.current.endAt = performance.now(); }` (zero `setState` in effect).
    - Derive `inEndSequence = ending || endPhase !== "none"`, `displayedStatus` (`"finalizing snapshot…"` → `"snapshot ready"`), and `displayedOpacity` (`1` → `0`) during render.
  - Replace the nested `statusTimer` + `swapTimer` inside the canvas `useEffect` with two small top-level `useEffect` hooks gated on `!inEndSequence`:
    1. `useEffect([inEndSequence])`: `const statusTimer = setInterval(() => setPhraseFading(true), 9000); return () => clearInterval(statusTimer);`
    2. `useEffect([phraseFading, inEndSequence])`: when `phraseFading` is `true`, `const swapTimer = setTimeout(() => { setPhraseIdx((i) => (i + 1) % PHRASES.length); setPhraseFading(false); }, 650); return () => clearTimeout(swapTimer);`
- **Verification:**
  - Prototyped in `apps/desktop/src/features/onboarding/components/organizing-splash.tsx`; verified with `pnpm --filter @kalaido/desktop typecheck`, `pnpm exec biome lint --error-on-warnings`, `vitest`, and `pnpm dlx react-doctor@latest . --verbose --yes` (`no-adjust-state-on-prop-change`: `0`, `effect-needs-cleanup` on `organizing-splash.tsx`: `0`).
- **Pros:**
  - Preserves exact `9000ms` + `650ms` timer cadence even if canvas 2D context is unavailable (e.g. headless/jsdom tests).
  - Immediately cancels both timers via React cleanup as soon as `inEndSequence` becomes `true`.
  - Preserves immediate frame-0 `"finalizing snapshot…"` override, permanently latches once ending starts, and preserves `"snapshot ready"` (`te > 3.0s`) and fade-out (`te > 5.2s`).
- **Cons:**
  - Adds two small `useEffect` blocks to `OrganizingSplash` (before Category 6's decomposition).

#### Option B — `endPhase` State + Render Derivation & rAF `tick()` Elapsed-Time Phrase Calculation
- **How it works:**
  - Same `endPhase` (`"none" | "finalizing" | "ready" | "faded"`) + render-derived `displayedStatus` / `displayedOpacity` as Option A.
  - Remove `setInterval` and `setTimeout` altogether: inside the existing rAF `tick()` loop (which already computes `t = (now - st.t0) / 1000` and updates `setPercent` on change at `:1036–1040`), compute `const step = Math.floor(t / 9.0); const nextFading = step > 0 && t - step * 9.0 < 0.65; const nextIdx = (nextFading ? step - 1 : step) % PHRASES.length;` and call `setPhraseState({ idx: nextIdx, fading: nextFading })` only when `nextIdx` or `nextFading` changes.
- **Verification:**
  - Prototyped in `apps/desktop/src/features/onboarding/components/organizing-splash.tsx`; verified with `pnpm --filter @kalaido/desktop typecheck`, `pnpm exec biome lint --error-on-warnings`, `pnpm check:boundaries`, `pnpm check:design`, and `pnpm dlx react-doctor@latest . --verbose --yes` (`0` Category 2 errors/warnings; shrinks `OrganizingSplash` by ~17 lines).
- **Pros:**
  - Zero `setInterval` or `setTimeout` timers anywhere in `OrganizingSplash`; single clock (`performance.now()`) drives canvas, percentage, phrase rotation, and end milestones together.
  - Makes Category 6's extraction of the splash loop into a `.ts` module even cleaner.
- **Cons:**
  - Phrase rotation depends on `canvas.getContext("2d")` being non-null so the rAF loop starts (always true in Tauri WebView; in jsdom without a canvas mock, phrases remain on `PHRASES[0]`, matching `percent` which is also rAF-driven).

#### Ruled-Out Options
- **Adding `if (swapTimer !== undefined) clearTimeout(swapTimer)` to cleanup (or `clearTimeout(swapTimer)` before reassignment inside `setInterval`):** Empirically tested against `react-doctor@0.9.23` (`exp1.txt`) and verified in `oxlint-plugin-react-doctor/dist/index.js`: `:1075` *already* calls `clearTimeout(swapTimer)`, and adding `clearTimeout(swapTimer)` before reassignment inside `setInterval` **still** fires `react-doctor/effect-needs-cleanup` (`organizing-splash.tsx:817`) because `oxlint-plugin-react-doctor`'s `df` check rejects timers allocated inside a nested repeating callback (`j(t.node) !== e`).
- **Naive render override `const displayedStatus = ending ? "finalizing snapshot…" : status; const displayedOpacity = ending ? 1 : statusOpacity;`:** Ruled out because `ending` stays `true` during `te = 0..5.2s`, which would mask `"snapshot ready"` at `te > 3.0s` (`:896`) and prevent the `statusOpacity → 0` fade-out at `te > 5.2s` (`:902`).

---

### D2.4 — `useColourPreview` `typeFilter` Reset Semantics & Ownership

**Decision:** **Option A** — Move `typeFilter` UI State & Client-Side Narrowing into Conditionally Mounted `ColourComposerPane`

**Files & Callers Verified:**
- `packages/react/features/src/colours/hooks/use-colour-preview.ts:18–87`:
  - Owns `typeFilter`, `matches`, `previewing`, and client-side filtered `fragments`.
  - Line 77–79: `useEffect(() => { if (!enabled) setTypeFilter("all"); }, [enabled]);` triggers `no-adjust-state-on-prop-change`.
- **All callers across the workspace (verified via repo-wide grep):**
  - `ColoursScreen` (`packages/react/features/src/colours/colours-screen.tsx:121`): `const preview = useColourPreview(draftPrompt, composing, seedExamples);` — **sole caller** in the entire repository (`colour-detail-pane.tsx` does **not** call `useColourPreview`).
  - `ColoursScreen:141` (`saveNew`) uses `preview.matches.map((f) => f.id)` (unfiltered).
  - `ColoursScreen:201–216` passes `preview.typeFilter`, `preview.fragments`, and `preview.setTypeFilter` **exclusively** to `<ColourComposerPane>` (`packages/react/features/src/colours/components/colour-composer-pane.tsx:15–110`), which is conditionally mounted only while `composing === true` and unmounts whenever `composing` becomes `false` (`closeComposer`, `selectColour`, or `created` in `colours-screen.tsx:59–75`).
  - No existing unit tests for `useColourPreview`.

**Cross-Plan Coupling:** `None` (`ColourDetailPane` is in `doctor-06`, but `ColoursScreen` / `ColourComposerPane` / `useColourPreview` are not touched by Categories 1, 3, 4, 5, or 6).

#### Option A — Move `typeFilter` UI State & Client-Side Narrowing into Conditionally Mounted `ColourComposerPane`
- **How it works:**
  - Simplify `useColourPreview` (`use-colour-preview.ts`) to own only the debounced stream state (`{ matches, previewing }`), keeping `TYPE_FILTERS` and `TypeFilter` exported for `ColourComposerPane`.
  - Move `const [typeFilter, setTypeFilter] = useState<TypeFilter>("all")` and `const previewFragments = useMemo(...)` into `ColourComposerPane` (`colour-composer-pane.tsx`), passing `matches={preview.matches}` from `ColoursScreen` (`colours-screen.tsx`).
  - Because `{composing ? <ColourComposerPane ... /> : ...}` in `ColoursScreen` unmounts `ColourComposerPane` whenever `composing` turns `false`, `typeFilter` naturally initializes to `"all"` on every new composer session with zero effects.
- **Verification:**
  - Verified callers (`colours-screen.tsx`, `colour-composer-pane.tsx`), package boundaries (`useColourPreview` is internal to `packages/react/features/src/colours/`, not re-exported from `colours/index.ts`), `tsc`, and `react-doctor`.
- **Pros:**
  - Eliminates the prop-sync problem at the architectural root: UI chip state lives in the component that renders the chips and mounts per composing session.
  - Removes 2 props (`typeFilter`, `onTypeFilter`) from `ColourComposerPane` and removes unused client filtering while `!composing`.
  - Preserves exact current UX (`typeFilter` resets to `"all"` whenever leaving and re-entering New Colour).
- **Cons:**
  - Touches 3 files (`use-colour-preview.ts`, `colour-composer-pane.tsx`, `colours-screen.tsx`) instead of 1.

#### Option B — Render-Phase `prevEnabled` Guard Inside `useColourPreview` (1-File Drop-In)
- **How it works:**
  - Keep `useColourPreview`'s exact signature and return object in `use-colour-preview.ts`.
  - Replace `useEffect(() => { if (!enabled) setTypeFilter("all"); }, [enabled])` with:
    `const [prevEnabled, setPrevEnabled] = useState(enabled); if (prevEnabled !== enabled) { setPrevEnabled(enabled); if (!enabled) setTypeFilter("all"); }`
- **Verification:**
  - Prototyped in `packages/react/features/src/colours/hooks/use-colour-preview.ts`; verified with `pnpm --filter @kalaido/features typecheck`, `pnpm exec biome lint --error-on-warnings`, and `pnpm dlx react-doctor@latest . --verbose --yes` (`0` errors/warnings).
- **Pros:**
  - Single-file, 5-line diff in `use-colour-preview.ts`; zero changes to `ColoursScreen` or `ColourComposerPane`.
  - Preserves 100% identical runtime behavior and hook contract for any future caller.
- **Cons:**
  - Uses React's render-phase `prevEnabled` state adjustment pattern rather than component lifecycle or event transitions.

#### Option C — Derive `effectiveTypeFilter` in `useColourPreview` + Reset in `ColoursScreen` Workflow Action
- **How it works:**
  - In `use-colour-preview.ts`: delete the `useEffect` and derive `const effectiveTypeFilter: TypeFilter = enabled ? typeFilter : "all"` for `fragments` and the returned `typeFilter`.
  - In `colours-screen.tsx`: call `preview.setTypeFilter("all")` in the `"New Colour"` button `onClick` (`openComposer`, `:184`) so opening a new composer session always starts on `"all"`.
- **Verification:**
  - Prototyped in `use-colour-preview.ts` + `colours-screen.tsx`; verified with `pnpm --filter @kalaido/features typecheck`, `pnpm exec biome lint --error-on-warnings`, and `pnpm dlx react-doctor@latest . --verbose --yes` (`0` errors/warnings).
- **Pros:**
  - Pure derivation in `useColourPreview` plus explicit user-event reset in `ColoursScreen`; no `prevEnabled` state.
  - Preserves `useColourPreview`'s external signature and resets to `"all"` on every `"New Colour"` click.
- **Cons:**
  - Splits reset responsibility between the hook and its caller (`ColoursScreen`).

#### Option D — Derive `effectiveTypeFilter = enabled ? typeFilter : "all"` Only (Persist Filter Choice Across Toggles)
- **How it works:**
  - Same 3-line change in `use-colour-preview.ts` as Option C, with **no** `setTypeFilter("all")` call in `ColoursScreen`.
- **Verification:**
  - Prototyped in `use-colour-preview.ts`; verified with `tsc`, `biome lint`, and `react-doctor` (`0` errors/warnings).
- **Pros:**
  - Smallest possible diff (deletes 3 lines, adds 1 derived `const` in 1 file).
- **Cons:**
  - **User-visible behavior change:** if a user selects `"Email"` or `"Note"` in New Colour, cancels/selects an existing colour, and clicks `"New Colour"` again without leaving `ColoursScreen`, the previous filter chip stays active instead of resetting to `"All"`.

---

### D2.5 — `AddFragmentModal` Active Tab (`"write"` vs `"import"`) Across Close/Reopen

**Decision:** **Option B** — Move `tab` State into `AddFragmentModalBody` (Reset to `"write"` on Every Open)

**Files & Callers Verified:**
- `packages/react/features/src/fragments/components/add-fragment-modal.tsx:52, 80–92`:
  - Currently, `const [tab, setTab] = useState<FragmentTab>("write")` lives at the top of `AddFragmentModal` (mounted inside `PageLayout`), and the open-reset `useEffect` (`:80–92`) resets `text`, `note`, `picker`, `colour`, and `importError` — **not** `tab` (and `:87` explicitly checks `if (tab === "write")` before focusing `<Textarea>`).
  - Splitting `AddFragmentModal` into an outer `<Dialog>` shell + inner `<AddFragmentModalBody>` requires choosing whether `tab` stays in the outer shell or moves into the inner body.

**Cross-Plan Coupling:** `None`

#### Option A — Keep `tab` State in Outer `AddFragmentModal` (Preserve Current Behavior)
- **How it works:**
  - Keep `const [tab, setTab] = useState<FragmentTab>("write")` in `AddFragmentModal` (`add-fragment-modal.tsx`) and pass `tab` + `onTabChange={setTab}` to `<AddFragmentModalBody>`.
- **Verification:**
  - Prototyped in `add-fragment-modal.tsx`; verified with `tsc`, `biome lint`, and `react-doctor` (`0` errors/warnings).
- **Pros:**
  - 100% behavioral parity with current `AddFragmentModal`: if a user switches to `"Import file"`, closes the modal, and reopens it during the workspace session, `"Import file"` remains selected while the picked file/errors are cleared.
  - Also allows outer `<DialogContent initialFocus={tab === "write" ? textareaRef : undefined}>` (if **D2.2 Option A** is chosen) to read `tab` directly.
- **Cons:**
  - Passes `tab` and `onTabChange` as props from `AddFragmentModal` to `AddFragmentModalBody`.

#### Option B — Move `tab` State into `AddFragmentModalBody` (Reset to `"write"` on Every Open)
- **How it works:**
  - Declare `const [tab, setTab] = useState<FragmentTab>("write")` inside `<AddFragmentModalBody>` in `add-fragment-modal.tsx`.
- **Verification:**
  - Verified compatible with both **D2.1** Options A/B and **D2.2** Options A/B (`initialFocus={textareaRef}` always applies on open since every open starts on `"write"`).
- **Pros:**
  - Every modal open consistently starts on `"Start writing"` with `<Textarea>` focused; fewer props between outer shell and inner body.
- **Cons:**
  - **User-visible behavior change:** closing the modal while on `"Import file"` and reopening it resets the active tab back to `"Start writing"`.

---

## 5. Verification

- Run `./kalaido.sh test:ts && ./kalaido.sh check:ts`.
- Add/run focused Vitest component/hook tests covering modal close exit-animation retention + reopen draft reset, initial `<Textarea>` focus, `OrganizingSplash` end-phase progression (`"finalizing snapshot…"` → `"snapshot ready"` → fade-out), and `useColourPreview` filter behavior.
- Re-run `pnpm dlx react-doctor@latest . --verbose --yes` and confirm:
  - `effect-needs-cleanup`: `4 → 1` (only `packages/react/primitives/src/shadcn/carousel.tsx:93` remaining, excluded by Category 6 config)
  - `no-adjust-state-on-prop-change`: `5 → 0`
  - Zero new diagnostics (`no-prop-callback-in-effect`, `no-high-complexity-react-function`, `no-ref-current-in-render`) introduced in modified files.
