# React Doctor — Category 3: Effect-Driven Upward Sync & Navigation Side Effects

**Baseline scan:** `react-doctor` full-repo run (`42 / 100`, 138 issues total)  
**Diagnostics covered (21 non-shadcn issues across 5 files — heavily overlapping rules on the same effect sites):**
- `react-doctor/no-prop-callback-in-effect` — **7 warnings** (`Bugs`; excludes 1 in `shadcn/carousel.tsx`)
- `react-doctor/no-pass-live-state-to-parent` — **6 warnings** (`Bugs`; excludes 1 in `shadcn/carousel.tsx`)
- `react-doctor/no-pass-data-to-parent` — **6 warnings** (`Bugs`; excludes 1 in `shadcn/carousel.tsx`)
- `react-doctor/exhaustive-deps` — **2 warnings** (`Bugs`)

> Because React Doctor fires 2–3 of these rules on the same `useEffect` call, there are only **9 distinct `useEffect` blocks across 5 files** behind all 21 warnings.

---

## 1. The Anti-Pattern

These 9 effects represent three distinct architectural smells:

1. **Pushing child-owned state back up to a parent via `useEffect` (4 sites):**
   - `ChatPanel` owns `useChat().messages` and mirrors every change upward with `useEffect(() => { onMessagesChange?.(messages); }, [messages, onMessagesChange])`.
   - `ContextBar` computes `blocked === "size"` from `useWholeScopeFits(timeWindow)` and mutates parent-owned `items` via `useEffect(() => { if (...) onChange(setScopeMode(items, "summaries")); })`.
   - `useResumeRefinement` queries PocketBase messages and pushes them into a caller-passed `session` object via `useEffect(() => { session.resume(...); })`.
   - `ProjectionDetailScreen` calls `adoptDraftName(...)` inside `useEffect` once `resumed` + `projection` arrive.

2. **Imperative effect triggers with suppressed `exhaustive-deps` (2 sites in `ChatPanel`):**
   - `initialPrompt` one-shot send (`chat-panel.tsx:271-278`) and `timeWindow` change auto-send (`chat-panel.tsx:298-305`) call `appendSpecChanges()` (a plain render-scoped function) inside `useEffect`, requiring `biome-ignore lint/correctness/useExhaustiveDependencies` and tripping both `exhaustive-deps` and `no-pass-live-state-to-parent`.

3. **Live-data-driven navigation redirects inside screen components (3 sites):**
   - `ProjectionDetailScreen` (`:122-139`): when a `pending_review` snapshot appears on a projection with no live snapshot, calls `onReviewCandidate(id, pendingCandidate.id, { replace: true })`.
   - `ProjectionReviewScreen` (`:202-206`): when `pendingId !== snapshotId` (stale candidate URL superseded by a newer pending candidate), calls `onViewReview(id, pendingId, { wave: inWave, replace: true })`.
   - `ProjectionReviewScreen` (`:376-413`): post-approval fold-in effect watches `snapshots` until `pendingFoldIn.snapshotId` resolves, then calls `onViewReview` or `onApproveSuccess`.

---

## 2. The New Codebase Pattern

### Pattern 3A — Invert Upward Sync: Derive, Lift, or Bind at the Source
- **Never mirror state upward in `useEffect`.** Instead:
  - **For `ChatPanel` (`onMessagesChange`):** Check all callers of `onMessagesChange`. Where callers only need messages after a turn completes (`onFinish`) or when messages change from user/stream events, either:
    - Lift `useChat` / pass a callback into `useChat` lifecycle hooks (`onFinish`, `onData`, `sendMessage` wrapper), **or**
    - Expose the live `Chat` instance / hook to callers that truly need reactive streaming message inspection (e.g. `ReflectionRefineScreen` / `ProjectionDraftEditor` live preview).
  - **For `ContextBar` (`blocked === "size"` auto-downgrade):** Instead of silently mutating parent state via `useEffect` on every render where `fits === false`, either:
    - Derive effective scope mode in the shared helper (`resolveEffectiveContext(items, fits)`), **or**
    - Move `useWholeScopeFits` / auto-downgrade into a small hook or compute the fallback in the owner that holds `context` state so `ContextBar` remains a pure controlled input!
  - **For `useResumeRefinement` + `useDraftName` (`adoptDraftName`):** Fold resumption/seed derivation into the hook's own return value (derived initial/effective state from `session` + `openRefinement` + `projection`) rather than pushing fetched data into another hook's imperative `.resume()` / `.adopt()` method via `useEffect`.

### Pattern 3B — Stable `useCallback` for `appendSpecChanges` + Explicit Event Flow in `ChatPanel`
- Wrap `appendSpecChanges` in `useCallback` (it reads only `useLatestRef` refs from Category 1 and `setMessages` from `useChat` — both stable!).
- That removes both `biome-ignore` suppressions and both `exhaustive-deps` warnings immediately.
- For `timeWindow` changes: if the parent changes `timeWindow` via a user action (time window picker), evaluate triggering the re-apply via `ChatPanelHandle` imperative method (or keep the effect cleanly depending on `appendSpecChanges` + `sendMessage` with zero suppressed deps).

### Pattern 3C — Explicit Boundary for Live-Data Redirects (Avoid False-Positive Churn)
- Inspect each of the 3 navigation effects in `ProjectionDetailScreen` and `ProjectionReviewScreen`:
  - **Fold-in (`projection-review-screen.tsx:376-413`):** Currently uses a `pendingFoldIn` state machine + `useEffect` because `approveWrite` returns `{ id }` and awaits live PocketBase snapshot status. Check whether the fold-in target status is already returned (or can be awaited in the async handler via `invalidateLiveTags` / PocketBase fetch) so navigation happens directly in the event handler rather than bouncing through scope state → `useEffect` → navigation callback!
  - **Live-subscription URL canonicalization (`projection-detail-screen.tsx:122`, `projection-review-screen.tsx:202`):** These genuinely synchronize the browser/router URL with an external real-time database event (a background worker creating or superseding a `pending_review` snapshot). Check whether a `<Navigate>`-style declarative render redirect or a dedicated `useRedirectWhen(...)` hook (or documented rule triage) is cleanest under Kalaido's navigation discipline (remember: `packages/react/features` cannot import `react-router-dom`!).

---

## 3. File-by-File Inventory & Migration Plan

| File | Line(s) | Rules Fired | Planned Change |
|---|---|---|---|
| `packages/react/components/src/chat-panel.tsx` | 276, 278, 289, 303, 305 | `no-pass-live-state-to-parent` (×3), `exhaustive-deps` (×2), `no-prop-callback-in-effect` (×1) | 1) Wrap `appendSpecChanges` in `useCallback` (depends on `setMessages` + stable refs from Category 1) to fix both `exhaustive-deps` warnings and remove both `biome-ignore` comments. 2) Audit all callers of `onMessagesChange` (`ProjectionDraftEditor`, `ProjectionReviewScreen`, `ReflectionRefineScreen`, etc.) and replace upward `useEffect` mirroring with direct `useChat` ownership or event-callback delivery. 3) Evaluate moving `timeWindow` re-apply trigger from `useEffect` into a `ChatPanelHandle` method called by the window picker handler. |
| `packages/react/components/src/context-bar/context-bar.tsx` | 79 | `no-prop-callback-in-effect` (×1) | Audit all `ContextBar` callers (`ExploreScreen`, `ExploreCompactScreen`, `ProjectionDraftEditor`, `ProjectionReviewScreen`, `ReflectionRefineScreen`). Replace the child-to-parent `useEffect` downgrade with either a derived effective mode (keeping parent items untouched and displaying/sending Summaries when `wholeScope` doesn't fit) or a shared hook owned by the state holder. |
| `packages/react/features/src/projections/hooks/use-resume-refinement.ts` | 102 | `no-pass-live-state-to-parent` (×1), `no-pass-data-to-parent` (×1) | Merge or invert `useResumeRefinement` + `useRefineSession`: let `useRefineSession` accept an optional `resumedRefinement` input and derive its active session state (or expose a single `useProjectionRefinement` hook) instead of calling `session.resume(...)` from a `useEffect`. |
| `packages/react/features/src/projections/projection-detail-screen.tsx` | 130, 207 | `no-pass-live-state-to-parent` (×1), `no-prop-callback-in-effect` (×1), `no-pass-data-to-parent` (×2) | 1) Line 207 (`adoptDraftName`): fold the initial resumed projection name into `useDraftName`'s options (`initialName` / `fallbackName`) so `useDraftName` derives it without an effect pushing data back into it. 2) Line 130 (`onReviewCandidate`): triage whether this live-data redirect stays as a legitimate external-system redirect or moves into a dedicated redirect hook/wrapper. |
| `packages/react/features/src/projections/projection-review-screen.tsx` | 204, 390, 393, 400 | `no-pass-live-state-to-parent` (×1), `no-prop-callback-in-effect` (×4), `no-pass-data-to-parent` (×3) | 1) Lines 390/393/400 (fold-in): investigate reading the updated snapshot directly after `await approveWrite.run(...)` (or via a single live-wait helper) so approval navigation happens inside `runApprove()` instead of `pendingFoldIn` → `useEffect`. 2) Line 204 (`onViewReview` on stale `snapshotId`): triage alongside `projection-detail-screen.tsx:130`. |

### Invariants to Preserve
- **No `react-router-dom` in `packages/react/*`:** All navigation in `@kalaido/features` must remain callback-based (`onReviewCandidate`, `onViewReview`, `onApproveSuccess`, `onBackToList`).
- **Pure CQRS write discipline:** Do not reintroduce entity payloads on mutation returns or bypass `@kalaido/state` live reads when refactoring `pendingFoldIn` or `useResumeRefinement`.
- **Chat streaming & live preview:** Any refactor of `onMessagesChange` in `ChatPanel` must keep real-time tool-call previews (`ProjectionDraftEditor`, `ProjectionReviewScreen`, `ReflectionRefineScreen`) updating as assistant tool parts stream in.

---

## 4. Open Decisions

1. **`ChatPanel` `onMessagesChange` refactor depth:**
   - **Option A:** Move `onMessagesChange` callers to a shared `useKalaidoChat` hook (or lift `useChat` into the 3 screens that render live draft previews alongside `ChatPanel`) so `ChatPanel` is purely presentational/interactive over passed chat state. *(Cleanest long-term architecture; touches 3–4 callers.)*
   - **Option B:** Keep `useChat` inside `ChatPanel`, invoke `onMessagesChange` inside `useChat` callbacks (`onData` / `onFinish` / `sendMessage`), and eliminate the `useEffect` mirror. *(Smaller diff, verify streaming tool-part updates still trigger preview immediately.)*
2. **`ContextBar` `blocked === "size"` auto-downgrade:**
   - **Option A (Recommended):** Derive effective mode when reading/sending (`effectiveItems`) and display the downgrade notice in `ContextBar` without mutating parent state in an effect; only call `onChange` on explicit user picks.
   - **Option B:** Keep mutating parent state, but move the downgrade check to the parent's `useContextSelection` hook.
3. **Live-data route redirects (`projection-detail-screen.tsx:130`, `projection-review-screen.tsx:204`):**
   - Confirm whether these external PocketBase-driven redirects should be refactored (e.g. fold-in moved into `runApprove()` async flow) and whether remaining genuine real-time URL redirects should be triaged as acceptable or moved to desktop route wrappers.

---

## 5. Verification

- Run `./kalaido.sh test:ts && ./kalaido.sh check:ts`.
- Manually smoke-test: Explore chat (`initialPrompt`), Reflection refine (`timeWindow` switching + live preview), Projection detail → pending review redirect, and Projection approve + wave fold-in.
- Re-run `pnpm dlx react-doctor@latest . --verbose --yes` and confirm:
  - `exhaustive-deps`: `2 → 0`
  - `no-prop-callback-in-effect`, `no-pass-live-state-to-parent`, `no-pass-data-to-parent`: reduced to `0` non-shadcn (or only explicitly triaged external redirects).
