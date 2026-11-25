# React Doctor — Category 2: Modal / Prop-Change State Resets & Uncleaned Timers

**Baseline scan:** `react-doctor` full-repo run (`42 / 100`, 138 issues total)  
**Diagnostics covered (8 non-shadcn issues):**
- `react-doctor/effect-needs-cleanup` — **3 errors** (`Bugs`; excludes 1 in `shadcn/carousel.tsx`, handled in Category 6 baseline config)
- `react-doctor/no-adjust-state-on-prop-change` — **5 warnings** (`Bugs`)

---

## 1. The Anti-Pattern

Two coupled React anti-patterns repeat across modals, hooks, and animated views:

1. **Resetting local state in `useEffect` when a prop (`open`, `enabled`, `ending`) changes:**
   - Modals (`AddFragmentModal`, `EditCandidateModal`) stay mounted while closed and run a `useEffect([open, ...])` to wipe form fields and re-seed drafts whenever `open` flips to `true`.
   - `useColourPreview` runs `useEffect(() => { if (!enabled) setTypeFilter("all"); }, [enabled])` instead of deriving the effective filter or resetting on user action.
   - `OrganizingSplash` runs `useEffect` on `ending` to call `triggerEnd()` which sets React state (`setStatus`, `setStatusOpacity`).
   - This causes double renders (stale content flashes for 1 frame before reset) and entangles prop transitions with imperative effect choreography.

2. **Fire-and-forget `setTimeout` inside `useEffect` without cleanup:**
   - Both modals focus their `<Textarea>` via `setTimeout(() => textareaRef.current?.focus(), 0)` inside `useEffect` without returning `() => clearTimeout(id)`.
   - `OrganizingSplash` schedules a nested `swapTimer = setTimeout(...)` inside `setInterval`, and the effect cleanup only clears `statusTimer` — leaving `swapTimer` able to fire after unmount (or after `ending` triggers).

---

## 2. The New Codebase Pattern

### Pattern 2A — Mount-on-Open Inner Modal Form (Zero Effect Resets)
For modals that reset their draft state on every open:

- Keep `<Dialog open={open} onOpenChange={...}>` in the outer shell.
- Render the stateful form body **only when `open` is true** (or key the inner body on an open session):
  ```tsx
  export function EditCandidateModal({ open, oldText, ...props }: Props) {
    return (
      <Dialog open={open} onOpenChange={(o) => !o && !props.saving && props.onClose()}>
        <DialogContent showCloseButton={false} className="sm:max-w-2xl">
          {open && <EditCandidateForm oldText={oldText} {...props} />}
        </DialogContent>
      </Dialog>
    );
  }
  ```
- Inside `<EditCandidateForm>`, `useState(oldText)` initializes cleanly on mount and unmounts when closed — **eliminating `wasOpenRef`, `useEffect` state resets, and stale 1-frame flashes**.
- For `AddFragmentModal`, the inner body mounts fresh whenever `open` is `true`, so `text`, `colour`, note state, and picker state all start clean naturally on mount (no `useEffect` reset!).

### Pattern 2B — Focus Without Uncleaned Timers
Replace bare `setTimeout(() => ref.current?.focus(), 0)` with one of:
- **Preferred for dialogs:** Focus inside a cleaned-up `requestAnimationFrame` / `setTimeout` on mount of the inner form body:
  ```ts
  useEffect(() => {
    const timer = setTimeout(() => textareaRef.current?.focus(), 0);
    return () => clearTimeout(timer);
  }, []);
  ```
  (Or use Base UI / Radix `DialogContent` initial-focus prop if supported cleanly by `@kalaido/primitives/shadcn/dialog`.)
- **Rule for all timers in effects:** Every `setTimeout` / `setInterval` created inside `useEffect` (including nested timers created inside interval callbacks) must be tracked and cleared in the returned cleanup function (`clearTimeout(swapTimer)`).

### Pattern 2C — Derive Instead of Mirroring Prop Booleans into State
When a prop boolean (`enabled`, `ending`) forces a UI state override:
- **In `useColourPreview`:** Derive `effectiveTypeFilter = enabled ? typeFilter : "all"` (or reset `typeFilter` inside the caller's close handler / render-derived state if persistence across toggles is undesired).
- **In `OrganizingSplash`:** Keep the canvas animation trigger (`stateRef.current.endAt`) in the effect/animation loop, and derive the displayed status text/opacity when `ending` is true (`const displayedStatus = ending ? "finalizing snapshot…" : status; const displayedOpacity = ending ? 1 : statusOpacity;`) instead of calling `setStatus` / `setStatusOpacity` inside a `useEffect([ending])`!

---

## 3. File-by-File Inventory & Migration Plan

| File | Line(s) | Rule(s) | Planned Change |
|---|---|---|---|
| `packages/react/features/src/fragments/components/add-fragment-modal.tsx` | 80, 82, 85 | `effect-needs-cleanup` (×1 error), `no-adjust-state-on-prop-change` (×2) | Split stateful content into an inner `<AddFragmentModalBody>` rendered only while `open` is true (preserving `Dialog` open/close animations). Remove `wasOpenRef` and the reset `useEffect`. If `tab === "write"`, run a dedicated mount-only focus effect that returns `() => clearTimeout(timer)` (or use dialog initial focus). |
| `packages/react/features/src/projections/components/edit-candidate-modal.tsx` | 39 | `effect-needs-cleanup` (×1 error) | Split inner `<EditCandidateForm>` mounted while `open` is true (initializing `useState(oldText)` on mount) + mount focus effect returning `() => clearTimeout(timer)` (or dialog initial focus). |
| `apps/desktop/src/features/onboarding/components/organizing-splash.tsx` | 809, 810, 820 | `no-adjust-state-on-prop-change` (×2), `effect-needs-cleanup` (×1 error) | 1) Derive finalized status text & opacity directly from `ending` (or `ending || endedLocally`) instead of calling `setStatus`/`setStatusOpacity` in `triggerEnd` via `useEffect([ending])`. 2) In the `useEffect` at line 820, clear `swapTimer` in the cleanup function (`if (swapTimer !== undefined) clearTimeout(swapTimer);`) alongside `clearInterval(statusTimer)` and `window.removeEventListener("resize", handleResize)`. |
| `packages/react/features/src/colours/hooks/use-colour-preview.ts` | 78 | `no-adjust-state-on-prop-change` (×1) | Remove `useEffect(() => { if (!enabled) setTypeFilter("all"); }, [enabled])`. Track `typeFilter` keyed to the current enabled session (or derive `const activeFilter = enabled ? typeFilter : "all"` and clear when re-enabling). Verify callers (`colour-detail-pane.tsx` / `new-colour` flow) so re-opening preview starts on `"all"`. |

### Invariants to Preserve
- **Dialog close animation:** Verify `@kalaido/primitives/shadcn/dialog` (Base UI) keeps smooth close behavior when inner form unmounts on `open === false` — if close animation flashes empty content, keep mounted and reset on `open` transition via a `key={openCount}` incremented in the parent or `onOpenChange` handler.
- **`AddFragmentModal` tab switching:** Switching between `write` and `import` tabs while open must still preserve form state within the same open session and focus textarea when opening directly on `write`.
- **`OrganizingSplash` `onSkip` / `ending`:** Check whether anything else calls `triggerEnd()` besides `useEffect([ending])` (e.g. a skip button or canvas completion) so derived status still flips to `"finalizing snapshot…"` in all end paths.

---

## 4. Open Decisions

1. **Modal reset mechanism:**
   - **Option A (Recommended):** Conditional inner body `{open && <InnerForm ... />}` (simplest, guarantees zero stale state; verify close transition visually).
   - **Option B:** Keep inner body mounted during close animation and pass `key={openSessionId}` (or reset inside `onOpenChange` callback).
2. **Modal focus mechanism:**
   - **Option A (Recommended):** Cleaned-up `useEffect` timer (`return () => clearTimeout(id)`) inside the mounted inner form — zero behavior change vs current focus timing.
   - **Option B:** Use Base UI `<DialogContent initialFocus={textareaRef}>` (requires verifying `shadcn/dialog.tsx` forwards `initialFocus`).
3. **`useColourPreview` filter reset semantics:**
   - If a user filters preview to `"notes"`, disables preview, and re-enables preview later, should `typeFilter` reset to `"all"`? (Yes — currently it resets; we can preserve that exact behavior without `useEffect` via an event handler or session counter.)

---

## 5. Verification

- Run `./kalaido.sh test:ts && ./kalaido.sh check:ts`.
- Re-run `pnpm dlx react-doctor@latest . --verbose --yes` and confirm:
  - `effect-needs-cleanup`: `4 → 1` (only `shadcn/carousel.tsx` remaining, ignored by Category 6 config)
  - `no-adjust-state-on-prop-change`: `5 → 0`
