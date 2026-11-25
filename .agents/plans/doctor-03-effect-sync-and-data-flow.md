# React Doctor — Category 3: Effect-Driven Upward Sync & Navigation Side Effects

**Baseline scan:** `react-doctor` full-repo run (`42 / 100`, 138 issues total)  
**Diagnostics covered (21 non-shadcn issues across 5 files — overlapping rules on the same effect sites):**
- `react-doctor/no-prop-callback-in-effect` — **7 warnings** (`Bugs`; excludes 1 in `shadcn/carousel.tsx`)
- `react-doctor/no-pass-live-state-to-parent` — **6 warnings** (`Bugs`; excludes 1 in `shadcn/carousel.tsx`)
- `react-doctor/no-pass-data-to-parent` — **6 warnings** (`Bugs`; excludes 1 in `shadcn/carousel.tsx`)
- `react-doctor/exhaustive-deps` — **2 warnings** (`Bugs`)

> Because React Doctor fires 1–5 of these rules on the same `useEffect` call, there are **9 distinct `useEffect` blocks across 5 files** behind all 21 warnings.

---

## 1. The Anti-Pattern

These 9 effects represent three distinct architectural smells:

1. **Pushing child-owned or sibling-hook state back up via `useEffect` (4 sites):**
   - `ChatPanel` (`packages/react/components/src/chat-panel.tsx:288-290`) owns `useChat().messages` and mirrors every change upward with `useEffect(() => { onMessagesChange?.(messages); }, [messages, onMessagesChange])`, causing a second post-commit parent render on every streamed token. (Also note an adjacent stale-closure bug at `chat-panel.tsx:236`: `onFinish: () => onTurnComplete?.(messages)` reads pre-finish `messages` instead of `onFinish`'s `{ messages }` parameter.)
   - `ContextBar` (`packages/react/components/src/context-bar/context-bar.tsx:77-81`) computes `blocked === "size"` from `useWholeScopeFits(timeWindow)` and mutates parent-owned `items` via `useEffect(() => { if (blocked === "size" && state.mode === "full" && summariesAvailable) onChange(setScopeMode(items, "summaries")); })`. Note `summariesAvailable` is `entity === "chat"` (`:70`), so this downgrade applies exclusively to Explore chat surfaces (`ExploreScreen`, `ExploreCompactScreen`).
   - `useResumeRefinement` (`packages/react/features/src/projections/hooks/use-resume-refinement.ts:95-108`) queries PocketBase `projection_refinement` + `chat_message` records and pushes them into a caller-passed `RefineSession` (`packages/react/hooks/src/use-refine-session.ts`) via `useEffect(() => { resume(...); })`.
   - `ProjectionDetailScreen` (`packages/react/features/src/projections/projection-detail-screen.tsx:204-217`) calls `adoptDraftName(...)` (`packages/react/hooks/src/use-draft-name.ts`) inside `useEffect` once `resumed` + `projection` arrive.

2. **Imperative send effects reading live state with suppressed `exhaustive-deps` (2 sites in `ChatPanel`):**
   - `initialPrompt` one-shot send (`chat-panel.tsx:271-278`) and `timeWindow` change auto-send (`chat-panel.tsx:298-305`) call `appendSpecChanges()` (a render-scoped function calling `useChat().setMessages`) inside `useEffect` blocks that read live state (`messages`, `isLoading`, `quotaHit`). This requires `biome-ignore lint/correctness/useExhaustiveDependencies` and trips **both** `exhaustive-deps` (`:278, :305`) and `no-pass-live-state-to-parent` (`:276, :303`).
   - **Important verified nuance:** Wrapping `appendSpecChanges` in `useCallback` alone clears `exhaustive-deps`, **but does NOT clear `no-pass-live-state-to-parent`**, because `react-doctor` flags calling `useChat().setMessages` inside any `useEffect` whose body/deps read live state (`messages`, `isLoading`, `quotaHit`).

3. **Live-data-driven navigation redirects inside screen components (3 sites):**
   - `ProjectionDetailScreen` (`:122-139`): when a `pending_review` snapshot exists on a projection with no approved (`live`) snapshot, calls `onReviewCandidate(id, pendingCandidate.id, { replace: true })`.
   - `ProjectionReviewScreen` (`:202-206`): when `pendingId && pendingId !== snapshotId` (URL `:snapshotId` superseded by a newer `pending_review` candidate), calls `onViewReview(id, pendingId, { wave: inWave, replace: true })`.
   - `ProjectionReviewScreen` (`:376-413`): post-approval fold-in effect watches live `snapshots` until `pendingFoldIn.snapshotId` appears, then branches on `target.status === "pending_review"` to call `onViewReview` or `onApproveSuccess` / `advanceToNextInWave`. (Verified in `kalaidoscope/internal/handlers/projections.go:162-186` and `internal/engine/snapshot.go:140-191`: `POST /api/projections/{id}/candidates` with `foldIn: true` executes synchronously during the HTTP request and commits either a `pending_review` candidate or an in-place `approved` settlement before returning `200 OK { snapshotId }`.)

---

## 2. The New Codebase Pattern

### Pattern 3A — Invert Upward Sync: Own at the Parent, Subscribe via `useSyncExternalStore`, or Derive
- **Never mirror state upward in `useEffect`.** Instead:
  - **For `ChatPanel` (`onMessagesChange`, D3.1):**
    - Plain Explore callers (`ExploreScreen`, `ExploreCompactScreen`) cannot bookmark in-flight turns (`ChatMessages` marks turns from `inFlightFrom` onward `pending: true`, and `ChatMessageActions` sets `disabled={pending}`), so they only need settled messages delivered via `onTurnComplete` (`onFinish: ({ messages }) => onTurnComplete?.(messages)`).
    - Refinement callers (`ProjectionDraftEditor`, `ProjectionReviewScreen`, `ReflectionRefineScreen` via `RefineChatPanel` + `useRefineSession`) require mid-stream `messages` for real-time `apply_result` markdown previews, `"drafting"`/`"applying"` phase pills, and `suggest_name` extraction. Deliver live messages either by lifting chat ownership into a shared `useKalaidoChat` controller hook or by notifying `onMessagesChange` synchronously inside an `AbstractChat` `ChatState` store (`useSyncExternalStore`) when stream mutations occur — never via `useEffect`.
  - **For `ContextBar` (`blocked === "size"` auto-downgrade, D3.3):** Eliminate the child-to-parent `useEffect` mutation by deriving effective context items (`Full → Summaries` when `entity === "chat" && fit.fits === false`) across `ChatPanel` and `ContextBar`, lifting context selection into a shared chat-context hook, or clamping on send events.
  - **For `useResumeRefinement` + `useRefineSession` + `useDraftName` (D3.4):** Make `useResumeRefinement` a pure read hook returning a `ResumedRefinementSeed | null` passed *into* `useRefineSession`, and pass a declarative `DraftNameSeed | null` (comparing `projection.name` against `extractSuggestedNameFromMessages(resumedMessages)`) *into* `useDraftName`.

### Pattern 3B — Event-Driven Window Re-Apply & Prop-Seeded Initial Prompt in `ChatPanel`
- Wrap `appendSpecChanges` in `useCallback([setMessages])` (reading refs synchronized via Category 1's `useLatestRef` / `useLayoutEffect`), removing both `biome-ignore` comments and both `exhaustive-deps` warnings.
- Gate `initialPrompt` one-shot send on `hasSeededChatTurn` derived from `initialMessages` (a prop, not live `messages` state), or trigger it imperatively from the caller's chat controller.
- Move `timeWindow` re-apply (`ReflectionRefineScreen` is the sole caller passing `timeWindow`) out of `useEffect` into an imperative `applyTimeWindow(win)` method invoked from `WindowSelect.onChange` (queuing a resend in `onFinish` if a turn is currently streaming).

### Pattern 3C — Direct Async Settlement for Fold-In & Explicit Triage for External URL Canonicalization
- **Fold-in (`projection-review-screen.tsx:376-413`, D3.5):** Because `HandleGenerateCandidate` commits the final snapshot status synchronously before returning `{ snapshotId }`, settle fold-in directly inside an `async` helper after `await regenerateWrite.run(...)` using `@kalaido/client`'s existing `getPendingCandidate(id)` read query (preserving pure CQRS `{ readonly id: string }` write returns and eliminating `pendingFoldIn` scope state + `useEffect`).
- **Live-subscription URL canonicalization (`projection-detail-screen.tsx:122-139`, `projection-review-screen.tsx:202-206`, D3.6):** Choose between declarative `<AppRedirect>` in `apps/desktop/src/routes/` (passed via render prop so `packages/*` stays router-free and `check:nav` passes), targeted `react-doctor` suppression on the two genuine external-SSE redirect effects, or desktop page-wrapper canonicalization.

---

## 3. File-by-File Inventory & Migration Plan

| File | Line(s) | Rules Fired | Planned Change |
|---|---|---|---|
| `packages/react/components/src/chat-panel.tsx` | 276, 278, 289, 303, 305 | `no-pass-live-state-to-parent` (×3), `exhaustive-deps` (×2), `no-prop-callback-in-effect` (×1) | 1) Fix `onFinish` to forward `{ messages: finishedMessages }` to `onTurnComplete`. 2) Replace `onMessagesChange` `useEffect` (`:288-290`) per **D3.1** (caller-owned `useKalaidoChat` controller or synchronous `AbstractChat` `ChatState` store notification). 3) Wrap `appendSpecChanges` in `useCallback`, gate `initialPrompt` on prop-derived `hasSeededChatTurn`, and move `timeWindow` re-apply out of `useEffect` per **D3.2**. |
| `packages/react/components/src/context-bar/context-bar.tsx` | 79 | `no-prop-callback-in-effect` (×1) | Remove the `useEffect` calling `onChange(setScopeMode(items, "summaries"))` (`:77-81`) and apply the selected **D3.3** option across `ContextBar` and `ChatPanel` / Explore callers (`ExploreScreen`, `ExploreCompactScreen`). |
| `packages/react/features/src/projections/hooks/use-resume-refinement.ts` (`+ packages/react/hooks/src/use-refine-session.ts`) | 102 | `no-pass-live-state-to-parent` (×1), `no-pass-data-to-parent` (×1) | Remove `session` input and `useEffect(() => resume(...))` from `useResumeRefinement`; return declarative `ResumedRefinementSeed | null` consumed by `useRefineSession` per **D3.4** (keeping fallback resolution in a module-scope helper so `useRefineSession` stays below `no-high-complexity-react-function`). |
| `packages/react/features/src/projections/projection-detail-screen.tsx` (`+ packages/react/hooks/src/use-draft-name.ts`) | 130, 207 | `no-pass-live-state-to-parent` (×1), `no-prop-callback-in-effect` (×1), `no-pass-data-to-parent` (×2) | 1) Line 207 (`adoptDraftName`): pass declarative `seed` (`{ name, userNamed }` computed against `extractSuggestedNameFromMessages(resumedMessages)`) into `useDraftName` and remove the `useEffect` per **D3.4**. 2) Line 130 (`onReviewCandidate`): apply **D3.6** for live-candidate URL canonicalization. |
| `packages/react/features/src/projections/projection-review-screen.tsx` | 204, 390, 393, 400 | `no-pass-live-state-to-parent` (×1), `no-prop-callback-in-effect` (×4), `no-pass-data-to-parent` (×3) | 1) Lines 390/393/400 (`pendingFoldIn`): settle fold-in asynchronously inside `handleApproveAndRefresh` / `approveAndNext` per **D3.5**, removing `pendingFoldIn` state and its `useEffect`. 2) Line 204 (`onViewReview` on superseded `snapshotId`): apply **D3.6**. |

### Invariants to Preserve
- **No `react-router-dom` in `packages/react/*` or outside `apps/desktop/src/routes/`:** Enforced by `biome.json` (`noRestrictedImports`) and `scripts/check-navigation-discipline.mjs` (which bans `Navigate`, `useNavigate`, `Link`, etc. everywhere in `packages/` and in `apps/desktop/src/` outside `apps/desktop/src/routes/`).
- **Pure CQRS write discipline:** `useExternalWrite` enforces `ValidWriteReturn<TOut>` (`void | { readonly id: string } | { readonly ids: readonly string[] }`). Never add entity status payloads to mutation returns or bypass `@kalaido/state` live invalidations.
- **Chat streaming & live preview:** Real-time `dynamic-tool` (`apply_result`, `update_lens`, `suggest_name`) streaming updates must continue driving previews, phase indicators, and auto-naming in `ProjectionDraftEditor`, `ProjectionReviewScreen`, and `ReflectionRefineScreen` without stale closures or extra post-commit render passes.

---

## 4. Decision Points

| ID | Decision | Feasible Options | Cross-Plan Coupling | Selected |
|---|---|---|---|---|
| **D3.1** | `ChatPanel` `onMessagesChange` upward sync removal | Option A (Caller-owned `useKalaidoChat` controller), Option B (`AbstractChat` + `ChatState` synchronous store callback inside `ChatPanel`) | **Cat 1** (`chat-panel.tsx` ref cleanup), **Cat 6** (`chat-panel.tsx` size & complexity; clears `no-high-complexity-react-function` on `ChatPanel`) | **Option A** (`@kalaido/hooks`) |
| **D3.2** | `ChatPanel` `initialPrompt` one-shot send & `timeWindow` auto-send | Option A (`ChatPanelHandle.applyTimeWindow` + prop-seeded `initialPrompt` mount guard), Option B (Caller-owned chat controller imperative methods) | **Cat 1** (`useLatestRef` / `useState` baselines in `chat-panel.tsx`), **D3.1** (Option B requires D3.1 Option A) | **Option B** |
| **D3.3** | `ContextBar` `blocked === "size"` auto-downgrade | Option A (Derived effective context across `ChatPanel` + `ContextBar`), Option B (Shared `useChatContextSelection` hook in Explore callers), Option C (Clamp to `Summaries` on send + derived bar display) | None | **Option B** |
| **D3.4** | `useResumeRefinement` + `useRefineSession` + `useDraftName` inversion | Option A (Declarative `seed` inputs on existing `useRefineSession` & `useDraftName` hooks), Option B (Composite `useProjectionRefinement` feature hook) | **Cat 6** (`projection-detail-screen.tsx`, `projection-review-screen.tsx`; module-scope helper prevents `no-high-complexity-react-function` on `use-refine-session.ts`) | **Option B** |
| **D3.5** | `ProjectionReviewScreen` post-approval `pendingFoldIn` settlement | Option A (Async `settleFoldIn` helper querying `getPendingCandidate(id)`), Option B (Retain `pendingFoldIn` live-snapshot effect with targeted rule suppression) | **Cat 6** (`ProjectionReviewScreenInner` CC=62 decomposition; Option A removes state/events + 38-line effect) | **Option A** |
| **D3.6** | External live-data URL canonicalization redirects (`projection-detail-screen.tsx:130`, `projection-review-screen.tsx:204`) | Option A (`<AppRedirect>` in `apps/desktop/src/routes/` via screen render-redirect prop), Option B (Keep callback `useEffect` in `@kalaido/features` with inline or `doctor.config.json` suppression), Option C (Lift redirect check into desktop page wrappers using `<AppRedirect>`) | **Cat 5** (`only-export-components` on desktop pages), **Cat 6** (`doctor.config.json` `ignore.overrides` path format & screen decomposition) | **Option A** |

---

### D3.1 — `ChatPanel` `onMessagesChange` Upward Sync Removal

**Decision:** **Option A** — Caller-Owned `useKalaidoChat` Controller Hook (placed in `@kalaido/hooks`, adding `"@ai-sdk/react": "^3.0.184"` to `packages/react/hooks/package.json`)

**Files & Callers Verified:**
- `packages/react/components/src/chat-panel.tsx:106, 232-256, 288-290`: Runs `useEffect(() => { onMessagesChange?.(messages); }, [messages, onMessagesChange])` (fires `no-pass-live-state-to-parent` and `no-prop-callback-in-effect`). Line 236 also has `onFinish: () => onTurnComplete?.(messages)` (closes over pre-finish `messages` instead of `onFinish`'s `{ messages }` event payload).
- **All callers of `ChatPanel` / `onMessagesChange` across `packages/` and `apps/` (only 3 direct `<ChatPanel>` mount sites):**
  1. `packages/react/features/src/explore/explore-screen.tsx:168, 262-278, 392-401` (`ExploreScreen` on desktop): Stores `liveMessages` solely to compute `bookmarkRows`. Verified in `packages/react/components/src/chat-messages.tsx:903-907, 1074` and `packages/react/features/src/explore/chat-message-actions.tsx:12, 52` that turns in flight receive `pending: true` and `Bookmark` is `disabled={pending}` until the turn completes — so `ExploreScreen` never needs mid-stream updates once `onTurnComplete` receives `finishedMessages`.
  2. `packages/react/features/src/explore/explore-compact-screen.tsx:164, 223-232, 376-385` (`ExploreCompactScreen` on mobile & web): Identical to `ExploreScreen` — uses `liveMessages` solely for `bookmarkedCount` / `savedCount` on completed turns.
  3. `packages/react/components/src/refine-chat-panel.tsx:61-84` (`RefineChatPanel`): Passes `onMessagesChange={session.onMessagesChange}` (`packages/react/hooks/src/use-refine-session.ts:242-243, 308-312`), mounted by `ProjectionDraftEditor` (`projection-draft-editor.tsx:152`), `ProjectionReviewScreen` (`projection-review-screen.tsx:744`), and `ReflectionRefineScreen` (`reflection-refine-screen.tsx:348`). **Requires live mid-stream updates:** `useRefineSession` derives `preview`, `previewReady`, `hasDraftedLens`, `phase` (`"drafting"` / `"applying"`), and `suggestedName` from streaming `dynamic-tool` parts (`apply_result`, `update_lens`, `suggest_name`), and `ReflectionRefineScreen:248` reads `parseActiveWindow(session.messages)`.
- **AI SDK internals verified (`@ai-sdk/react@3.0.184` & `ai@6.0.182`):**
  - `@ai-sdk/react` exports `Chat` and `useChat({ chat })` (`useSyncExternalStore` over `ReactChatState`). Note: when `{ chat }` is passed to `useChat({ chat })`, `useChat` ignores `transport`/`onFinish`/`onError`/`onData` options on `useChat` (`@ai-sdk/react/dist/index.mjs:218-227`); those must be configured on `new Chat(...)`.
  - `ai` publicly exports `AbstractChat` and `ChatState` (`ai/dist/index.d.ts:3845, 6641`), and `"ai": "^6.0.182"` is already a dependency of `@kalaido/hooks`, `@kalaido/components`, and `@kalaido/features`.

**Cross-Plan Coupling:**
- **Category 1 (`doctor-01`):** Shares `packages/react/components/src/chat-panel.tsx` (`manageContextRef`, `specRef`, `lastSentSpecRef`, `manageWindowRef`, `timeWindowRef`).
- **Category 6 (`doctor-06`):** `ChatPanel` is listed in Category 6 Tier 1 (`no-giant-component` + `no-high-complexity-react-function`). Empirically verified that refactoring `ChatPanel` in Category 1 + 3 clears `no-high-complexity-react-function` on `ChatPanel` before Category 6 runs.

#### Option A — Caller-Owned `useKalaidoChat` Controller Hook
- **How it works:** Extract `useKalaidoChat` (wrapping `@ai-sdk/react`'s `useChat`, `createKalaidoChatTransport`, quota detection, and inference-rate telemetry) and accept `chat?: KalaidoChatController` on `ChatPanel` (removing `onMessagesChange`). Either place `useKalaidoChat` in `@kalaido/components` (called by refine surfaces in `@kalaido/features`, zero `package.json` changes) or add `"@ai-sdk/react": "^3.0.184"` to `packages/react/hooks/package.json` (permitted by `scripts/check-boundaries.mjs` and `biome.json`) so `useRefineSession` owns `useKalaidoChat` directly and eliminates its `messages` mirror state. `ExploreScreen` and `ExploreCompactScreen` either call `useKalaidoChat` or update `liveMessages` in `onTurnComplete={(msgs) => setLiveMessages(msgs)}`.
- **Verification:** Prototyped `useKalaidoChat` in `packages/react/components/src/use-kalaido-chat.ts` and `onTurnComplete` updates in `ExploreScreen`/`ExploreCompactScreen`; `pnpm -r typecheck`, `pnpm check:boundaries`, `pnpm test run`, and `pnpm dlx react-doctor@latest --verbose` passed with `0` warnings on `use-kalaido-chat.ts` and `chat-panel.tsx`.
- **Pros:**
  - Idiomatic unidirectional React data flow: parent and `ChatPanel` read the exact same `useSyncExternalStore` snapshot in a single render pass.
  - Shrinks `ChatPanel` substantially (directly advancing Category 6 Tier 1 decomposition).
  - Eliminates `onMessagesChange` prop and mirrored `useState<UIMessage[]>` state in `useRefineSession` (and optionally in Explore screens).
- **Cons:**
  - Calling `useKalaidoChat` inside `useRefineSession` requires adding `@ai-sdk/react` to `packages/react/hooks/package.json` (already in the workspace lockfile via `@kalaido/components`), whereas keeping `useKalaidoChat` in `@kalaido/components` requires passing `chat.messages` from the 3 refine screens into `useRefineSession` / helpers.

#### Option B — Encapsulated `AbstractChat` + `ChatState` Store Inside `ChatPanel`
- **How it works:** Keep chat state encapsulated inside `ChatPanel` (zero `package.json` or `RefineSession` signature changes) by replacing `useChat` + the `useEffect` mirror with a ~45-line `ObservableChatState implements ChatState<UIMessage>` + `AbstractChat<UIMessage>` (from `"ai"`) read via `useSyncExternalStore`. `ObservableChatState` invokes `onMessagesChange?.(messages)` synchronously inside `pushMessage` / `popMessage` / `replaceMessage` / `set messages` when stream chunks or notice appends mutate the store (never in `useEffect` and never during render). Fix `onFinish: ({ messages: finished }) => onTurnComplete?.(finished)` so `ExploreScreen` and `ExploreCompactScreen` drop `onMessagesChange` and update `liveMessages` in `onTurnComplete`.
- **Verification:** Prototyped in `packages/react/components/src/chat-panel.tsx`, `explore-screen.tsx`, and `explore-compact-screen.tsx`. `pnpm -r typecheck`, `pnpm check:boundaries`, `pnpm check:nav`, `pnpm exec biome lint --error-on-warnings`, `pnpm test run` (21/21 files, 223/223 tests), and `pnpm dlx react-doctor@latest --verbose` all passed with `0` Category 3 warnings in `chat-panel.tsx`.
- **Pros:**
  - Zero `package.json` dependency changes and zero changes to `RefineChatPanel` or `RefineSession` callers.
  - Batches `ChatPanel` and `useRefineSession` updates in the same stream-chunk microtask (1 render per chunk instead of 2).
- **Cons:**
  - Maintains a small custom `ChatState<UIMessage>` adapter (~45 LOC) in `chat-panel.tsx` (increasing file length slightly before Category 6 splits `ChatPanel`) instead of delegating to `@ai-sdk/react`'s `useChat`.

**Ruled-Out Options:**
- **Keep stock `useChat` in `ChatPanel` and call `onMessagesChange` only from `useChat`'s `onData` / `onToolCall` / `onFinish` callbacks:** Verified in `packages/react/components/node_modules/ai/dist/index.mjs` (`AbstractChat.makeRequestImpl` / `processUIMessageStream`) that `onData` fires exclusively for `data-*` chunks and `onToolCall` fires only once a tool call reaches terminal `input-available` — neither fires on `tool-input-delta` chunks. Using those callbacks would break live token-by-token `apply_result` markdown streaming and `"applying"` status pills across `ProjectionDraftEditor`, `ProjectionReviewScreen`, and `ReflectionRefineScreen`.

---

### D3.2 — `ChatPanel` `initialPrompt` One-Shot Send & `timeWindow` Change Auto-Send

**Decision:** **Option B** — Caller-Driven Imperative Sends via `useKalaidoChat` Controller

**Files & Callers Verified:**
- `packages/react/components/src/chat-panel.tsx:270-278` (`initialPrompt` effect) & `:297-305` (`timeWindow` effect): Both have `biome-ignore lint/correctness/useExhaustiveDependencies` and fire `exhaustive-deps` (`:278, :305`) plus `no-pass-live-state-to-parent` (`:276, :303`).
- **`initialPrompt` callers:** `ExploreScreen` (`explore-screen.tsx:362-366`, fresh chat launched from Home) and `RefineChatPanel` (`refine-chat-panel.tsx:70`, `session.firstPrompt` when opening a fresh refinement in `NewProjectionScreen`, `ProjectionReviewScreen`, or `ReflectionRefineScreen`). Always keyed by `chatId` / `activeChatKey` on mount.
- **`timeWindow` callers:** `ReflectionRefineScreen` (`reflection-refine-screen.tsx:359, 419-430`) via `RefineChatPanel` (`refine-chat-panel.tsx:75`) is the **only** caller in the codebase that passes `timeWindow`. Note `WindowSelect` (`packages/react/features/src/reflections/components/window-select.tsx:43-54`) remains enabled while a turn is streaming, so the user can change the preview window mid-stream.

**Cross-Plan Coupling:**
- **Category 1 (`doctor-01`):** `appendSpecChanges` reads `manageContextRef`, `specRef`, `lastSentSpecRef`, `manageWindowRef`, and `timeWindowRef`, which Category 1 converts from render-phase assignments to `useLatestRef` / `useLayoutEffect` + `useState` initializers.
- **D3.1:** Option B below is only available if **D3.1 Option A** (caller-owned `useKalaidoChat`) is chosen.

#### Option A — Imperative `ChatPanelHandle.applyTimeWindow` + Prop-Seeded `initialPrompt` Mount Guard
- **How it works:**
  1. Wrap `appendSpecChanges` in `useCallback([setMessages])` and remove both `biome-ignore` comments.
  2. For `timeWindow`: remove the `useEffect` (`:298-305`) and expose `applyTimeWindow(nextWindow: TimeWindow)` on `ChatPanelHandle` (`chat-panel.tsx`, forwarded through `RefineChatPanel`). `ReflectionRefineScreen`'s `<WindowSelect onChange>` dispatches `setWindowOverride` and calls `chatPanelRef.current?.applyTimeWindow(win)`. If `isLoadingRef.current` is true when `applyTimeWindow` runs, set `pendingWindowResendRef.current = true` and flush `appendSpecChanges() + sendMessage()` inside `onFinish` so mid-stream window switches behave identically to today.
  3. For `initialPrompt`: compute `hasSeededChatTurn = useMemo(() => (initialMessages ?? []).some((m) => m.role !== "system"), [initialMessages])` from the `initialMessages` prop rather than reading live `messages` inside the mount `useEffect`.
- **Verification:** Prototyped in `chat-panel.tsx` and `reflection-refine-screen.tsx`. `pnpm -r typecheck`, `pnpm exec biome lint --error-on-warnings`, `pnpm test run`, and `pnpm dlx react-doctor@latest --verbose` all passed with `exhaustive-deps: 0` and `no-pass-live-state-to-parent: 0` on `chat-panel.tsx`. (Note: initialize `hasAssistantTurnRef = useRef(false)` and sync in `useLayoutEffect` so `rerender-lazy-ref-init` is not tripped.)
- **Pros:**
  - Works with either **D3.1 Option A** or **D3.1 Option B**.
  - Replaces reactive `timeWindow` diffing on every streamed message render with an explicit event call from `WindowSelect.onChange`, while preserving mid-stream window-change queueing.
- **Cons:**
  - Adds a `chatPanelRef` in `ReflectionRefineScreen` and `applyTimeWindow` on `ChatPanelHandle`.

#### Option B — Caller-Driven Imperative Sends via `useKalaidoChat` Controller
- **How it works:** Paired with **D3.1 Option A**: `useKalaidoChat` exposes `sendInitialPrompt` / `applyTimeWindow` (or `ExploreScreen` and `useRefineSession.start` invoke `chat.sendUserMessage` directly when initializing a conversation, and `ReflectionRefineScreen` calls `chat.applyTimeWindow(win)` in `WindowSelect.onChange`). `ChatPanel` has zero send effects (`initialPrompt` prop and `timeWindow` auto-send effect are both removed from `ChatPanel`).
- **Verification:** Verified against `@ai-sdk/react` `Chat` lifecycle (`new Chat({ id, messages, transport })` can `sendMessage` immediately upon creation or mount without waiting for child component effects) and `tsc --noEmit`.
- **Pros:**
  - Eliminates **both** send `useEffect` blocks from `ChatPanel` completely — every message send originates in an explicit user/session action.
- **Cons:**
  - Requires **D3.1 Option A**; touches `ExploreScreen` and `useRefineSession` initialization paths.

**Ruled-Out Options:**
- **Wrap `appendSpecChanges` in `useCallback` alone while keeping `messages` / `isLoading` / `quotaHit` in the two `useEffect` dependency arrays (original draft Pattern 3B):** Empirically prototyped and scanned in Prototype 1 — cleared `exhaustive-deps` (`2 → 0`), **but `react-doctor/no-pass-live-state-to-parent` still fired on both `chat-panel.tsx:288` and `chat-panel.tsx:305`** because `oxlint-plugin-react-doctor` treats `useChat().setMessages` (called inside `appendSpecChanges`) as a hook/parent callback receiving control flow gated on live state (`messages`, `isLoading`, `quotaHit`).

---

### D3.3 — `ContextBar` `blocked === "size"` Auto-Downgrade

**Decision:** **Option B** — Lift `useWholeScopeFits` + Resolution into a Shared `useChatContextSelection` Hook

**Files & Callers Verified:**
- `packages/react/components/src/context-bar/context-bar.tsx:65-81`: Calls `useWholeScopeFits(timeWindow)`, computes `blocked = fullBlockedBy(state, fit.fits)` and `summariesAvailable = entity === "chat"`, and runs `useEffect(() => { if (blocked === "size" && state.mode === "full" && summariesAvailable) onChange(setScopeMode(items, "summaries")); })` (fires `no-prop-callback-in-effect` at `:79`).
- **All 5 `<ContextBar>` mount sites verified:**
  1. `packages/react/components/src/chat-panel.tsx:467` — mounted with `entity="chat"` by `ExploreScreen` (`explore-screen.tsx:371`) and `ExploreCompactScreen` (`explore-compact-screen.tsx:361`), `entity="projection"` by `ProjectionDraftEditor` (`:161`) and `ProjectionReviewScreen` (`:755`), and `entity="reflection"` by `ReflectionRefineScreen` (`:358`).
  2. `packages/react/features/src/projections/new-projection-screen.tsx:248` (`entity="projection"`).
  3. `packages/react/features/src/projections/projection-review-screen.tsx:785` (`entity="projection"`).
  4. `packages/react/features/src/reflections/reflection-refine-screen.tsx:398` (`entity="reflection"`, `timeWindow={activeWindow}`).
  - Because `summariesAvailable` is `entity === "chat"`, the auto-downgrade **only ever runs in `ExploreScreen` and `ExploreCompactScreen`** (on projection/reflection surfaces, `summariesAvailable` is `false` and `ModeButton` instead renders `warn={true}` when `blocked === "size"`).
- **Downstream consumers of `context` in Explore & `ChatPanel`:**
  - `chat-panel.tsx:195, 263`: Serializes `itemsToSpec(context ?? [])` into outgoing `context_spec` messages and passes `items: context ?? []` to `usePromptEstimate`.
  - `explore-screen.tsx:130, 304-312` & `explore-compact-screen.tsx:126`: `withContextItem(s.context, e.item)` (`addPin`) refuses Fragment/Colour mentions while `scopeModeOf(context) === "full"` (`packages/react/components/src/context-bar/state.test.ts:66-70`). `startProjectionFromBookmarks` strips `WholeScope` and `Summaries` markers alike (`explore-screen.tsx:305-307`), so bookmarks graduation is unaffected.

**Cross-Plan Coupling:** None.

#### Option A — Derive Effective Context Across `ChatPanel` and `ContextBar` Without Mutating Parent State
- **How it works:** Add a pure helper `resolveEffectiveContext(items, entity, fits)` in `packages/react/components/src/context-bar/state.ts` returning `setScopeMode(items, "summaries")` when `entity === "chat" && fits === false && scopeModeOf(items) === "full"`. Lift `const fit = useWholeScopeFits(timeWindow)` into `ChatPanel` (passing `fit?: WholeScopeFit` to `ContextBar` so non-`ChatPanel` callers still work without duplicate hooks), and use `effectiveContext` in `ChatPanel` (`specRef`, `usePromptEstimate`, `onMention` wrapper) and in `ContextBar` (`deriveBarState`, `addPin`, `removePin`, `setScopeMode`). Remove the `useEffect` in `ContextBar`.
- **Verification:** Prototyped in `context-bar.tsx`; `pnpm -r typecheck`, `vitest` (`state.test.ts` 8/8), and `pnpm dlx react-doctor@latest --verbose` passed with `0` warnings on `context-bar.tsx`.
- **Pros:**
  - `ContextBar` becomes a 100% stateless controlled component with zero effects beyond click-outside close; `ExploreScreen` and `ExploreCompactScreen` require zero changes if `ChatPanel` resolves `onMention` against `effectiveContext`.
  - Automatically restores `Full` if `fit.fits` returns to `true` (e.g. user switches the workspace to a larger-context model before pinning anything).
- **Cons:**
  - Subtle user-visible behavior change vs today: if `fit.fits` temporarily flips `false → true` (e.g. model change or fragment deletion) and the user never clicked the bar, mode returns to `Full` rather than staying latched on `Summaries`.

#### Option B — Lift `useWholeScopeFits` + Resolution into a Shared `useChatContextSelection` Hook
- **How it works:** Create `useChatContextSelection` (in `@kalaido/components` or `@kalaido/features/src/explore/hooks/`) used by `ExploreScreen` and `ExploreCompactScreen`. The hook reads `fit = useWholeScopeFits()` and derives `effectiveContext = resolveEffectiveContext(rawContext, "chat", fit.fits)` so `setContext` and `mentionContext` operate on `effectiveContext`. `ContextBar` drops the `useEffect` and receives `fit` (or reuses the deduplicated `useWholeScopeFits` SWR key).
- **Verification:** Verified `useWholeScopeFits` uses `@kalaido/state/live` `kalaidoscopeEndpointSource` (`use-whole-scope-fits.ts:39-60`), which deduplicates identical `(cache, key)` bindings in `registry.ts`, and verified `ExploreScreen`/`ExploreCompactScreen` are the only `entity === "chat"` callers.
- **Pros:**
  - Parent `ExploreScreen` / `ExploreCompactScreen` and `ChatPanel` both see the exact same `ContextItem[]` array without `ChatPanel` needing special `onMention` wrapping.
- **Cons:**
  - Touches both `ExploreScreen` and `ExploreCompactScreen` scope wiring in addition to `ContextBar`.

#### Option C — Clamp to `Summaries` on Outgoing Send Events + Derived Display in `ContextBar`
- **How it works:** `ContextBar` displays `Summaries` as active (and enables `+ Pin` using `effectiveItems`) when `blocked === "size" && summariesAvailable` without calling `onChange` in an effect. In `ChatPanel`, before `appendSpecChanges()` runs in `submit()` (or `initialPrompt`), if `entity === "chat" && fit.fits === false && scopeModeOf(context) === "full"`, clamp to `setScopeMode(context, "summaries")` and invoke `onContextChange?.(clamped)` inside the event handler.
- **Verification:** Verified against `no-prop-callback-in-effect` and `no-pass-live-state-to-parent` rules (calling `onContextChange` inside user submit handlers is completely unflagged; for `initialPrompt`, `fit.fits` is `undefined` until the async token estimate resolves, or `effectiveSpec` is used on mount).
- **Pros:**
  - Preserves sticky parent-state persistence once a turn is sent or a pin is picked, with zero `useEffect` upward sync.
- **Cons:**
  - `@`-mentions typed in `ChatComposer` *before* the first send still pass through parent `onMention` (`withContextItem(s.context, item)`), requiring parent `mentionContext` or `ChatPanel`'s `onMention` wrapper to use `effectiveItems` so content mentions on auto-downgraded `Full` are not ignored.

**Ruled-Out Options:**
- **Derive `effectiveItems` inside `ContextBar` alone without updating `ChatPanel`'s outgoing `specRef` / `onMention`:** Ruled out because parent `context` stays `[WHOLE_SCOPE_ITEM]`; `ChatPanel` would still serialize `{ wholeScope: "full" }` in `appendSpecChanges()` (causing `/api/explore` to return HTTP `422` when whole scope exceeds the model budget), and `@`-mentioning a fragment/colour in `ChatComposer` would call `withContextItem([WHOLE_SCOPE_ITEM], item)` which is a no-op on `Full`.

---

### D3.4 — `useResumeRefinement` + `useRefineSession` + `useDraftName` (`adoptDraftName`) Inversion

**Decision:** **Option B** — Composite `useProjectionRefinement` Hook in `@kalaido/features/projections`

**Files & Callers Verified:**
- `packages/react/features/src/projections/hooks/use-resume-refinement.ts:32-111`: Called in only **2 places** — `ProjectionDetailScreen` (`projection-detail-screen.tsx:187-196`, `snapshotId: ""`, `enabled: noSnapshots`) and `ProjectionReviewScreen` (`projection-review-screen.tsx:264-273`, `snapshotId: pendingId ?? ""`, `enabled: !!pendingId`). Line 102 calls `session.resume(...)` inside `useEffect` (fires `no-pass-live-state-to-parent` and `no-pass-data-to-parent`).
- `packages/react/hooks/src/use-refine-session.ts:176-418`: Called in **4 places** — `NewProjectionScreen` (`:63`), `ProjectionDetailScreen` (`:186`), `ProjectionReviewScreen` (`:226`), and `ReflectionRefineScreen` (`:175`). `session.resume` has **zero other callers** outside `useResumeRefinement`.
- `packages/react/hooks/src/use-draft-name.ts:43-124`: Called in **3 places** — `NewProjectionScreen` (`:85`, calls `adopt` in `startProjection` / `startFromSeed` handlers), `ReflectionRefineScreen` (`:177`, calls `adopt` in `startReflection` handler), and `ProjectionDetailScreen` (`:198-217`, calls `adoptDraftName` in `useEffect`, firing `no-pass-data-to-parent` at `:207`).

**Cross-Plan Coupling:**
- **Category 6 (`doctor-06`):** `ProjectionDetailScreen` and `ProjectionReviewScreen` are both Category 6 Tier 1 decomposition targets. **Critical verified coupling:** Inlining `resumed` ternary fallbacks directly inside `useRefineSession`'s body pushed `use-refine-session.ts` over React Doctor's complexity threshold (`no-high-complexity-react-function` at `use-refine-session.ts:183` in Prototype 2); keeping fallback resolution in a small pure helper function outside `useRefineSession` avoids introducing that warning.

#### Option A — Declarative `seed` Inputs on Existing `useRefineSession` and `useDraftName` Hooks
- **How it works:**
  1. Remove `session` from `useResumeRefinement` (`packages/react/features/src/projections/hooks/use-resume-refinement.ts`) and delete its `useEffect`; return `seed: ResumedRefinementSeed | null` (`{ parentId, clientId, refinementId, messages }`) once `ready` is true.
  2. Accept `resumed?: ResumedRefinementSeed | null` in `useRefineSession` (`packages/react/hooks/src/use-refine-session.ts`) and resolve active session fields via a pure module-level helper (`resolveRefineIdentity(controlState, resumed, liveMessages)`): while `controlState.refinementId === null` (no fresh `start()` called in this mount), `useRefineSession` derives `parentId`, `clientId`, `refinementId`, `initialMessages`, `messages`, and `started = true` directly from `resumed`; once `start()` sets `controlState.refinementId`, `controlState` takes precedence automatically (preserving the exact regression guard documented at `use-resume-refinement.ts:98-100` without any effect).
  3. Accept `seed?: { readonly name: string; readonly userNamed: boolean } | null` in `useDraftName` (`packages/react/hooks/src/use-draft-name.ts`), deriving `effectiveName = name ?? seed?.name ?? null` and `effectiveUserNamed = name !== null ? userNamed : (seed?.userNamed ?? false)`. In `ProjectionDetailScreen`, delete the `adoptDraftName` `useEffect` (`:204-217`) and pass `seed` with `userNamed` computed against `extractSuggestedNameFromMessages(resumedMessages)` (the persisted resume history, not live streaming `authoringSession.suggestedName`).
- **Verification:** Prototyped across `use-resume-refinement.ts`, `use-refine-session.ts`, `use-draft-name.ts`, `projection-detail-screen.tsx`, and `projection-review-screen.tsx`. `pnpm -r typecheck`, `pnpm check:boundaries`, `pnpm exec biome lint --error-on-warnings`, `pnpm test run`, and `pnpm dlx react-doctor@latest --verbose` passed with `0` Category 3 warnings across all 5 files.
- **Pros:**
  - Zero `useEffect` sync, zero extra render frame on resume, and structurally impossible for late SSE updates on `openRefinement` to clobber an active `start()` session.
  - Preserves existing hook package boundaries (`@kalaido/hooks` vs `@kalaido/features/projections`) and keeps `NewProjectionScreen` and `ReflectionRefineScreen` untouched.
- **Cons:**
  - `ProjectionDetailScreen` and `ProjectionReviewScreen` still call `useResumeRefinement` followed by `useRefineSession({ target: "projection", resumed: resumeSeed })` (two hook calls instead of one).

#### Option B — Composite `useProjectionRefinement` Hook in `@kalaido/features/projections`
- **How it works:** Build on Option A's declarative `resumed` / `seed` primitives by combining `useResumeRefinement` + `useRefineSession({ target: "projection", resumed })` (and optional `useDraftName` seeding) into a single feature-local `useProjectionRefinement` hook in `packages/react/features/src/projections/hooks/`, called by both `ProjectionDetailScreen` and `ProjectionReviewScreen`.
- **Verification:** Verified against `AGENTS.md` hook-placement rules (single-feature projection hook stays in `packages/react/features/src/projections/hooks/`, while cross-feature `useRefineSession` and `useDraftName` remain in `packages/react/hooks/src/`) and `pnpm check:boundaries`.
- **Pros:**
  - Eliminates two-hook wiring boilerplate in `ProjectionDetailScreen` and `ProjectionReviewScreen` (further shrinking both Category 6 Tier 1 components).
- **Cons:**
  - Slightly larger diff than Option A (introduces/renames the projection-specific wrapper hook).

**Ruled-Out Options:**
- **Compute `useDraftName`'s `seed.userNamed` from live `authoringSession.suggestedName` (`projection.name !== authoringSession.suggestedName`) on every render:** Ruled out because if a resumed projection was machine-named (`projection.name === initialSuggestedName`, so `userNamed === false`) and a subsequent chat turn streams a *new* suggestion (`authoringSession.suggestedName` changes to `"New Name"` while `projection.name` is still `"Old Name"`), recomputing against live `authoringSession.suggestedName` immediately flips `seed.userNamed` to `true` before `useDraftName`'s auto-rename effect fires, blocking the new suggestion from ever applying. Comparing against `extractSuggestedNameFromMessages(resumedMessages)` (or latching on initial adoption) avoids this bug.

---

### D3.5 — `ProjectionReviewScreen` Post-Approval `pendingFoldIn` Settlement

**Decision:** **Option A** — Settle Fold-In Directly in an Async Helper via `getPendingCandidate(id)`

**Files & Callers Verified:**
- `packages/react/features/src/projections/projection-review-screen.tsx:57-77, 133-142, 376-413, 476-501, 540-564`: `handleApproveAndRefresh` (`mode: "single"`) and `approveAndNext` when `isCandidateOutdated` (`mode: "wave"`) run `await runApprove()`, then `await regenerateWrite.run({ projectionId: id, opts: { foldIn: true } })`, then dispatch `setPendingFoldIn({ snapshotId: outcome.id, mode })`. Lines 376-413 watch `snapshots` in a `useEffect` and call `onViewReview` or `onApproveSuccess` / `advanceToNextInWave` (firing **5 warnings**: `no-prop-callback-in-effect` ×3 at `:390, :393, :400` and `no-pass-data-to-parent` ×2 at `:390, :393`).
- **Go backend & client mutation verified:**
  - `packages/lib/client/src/kalaidoscope/projections.ts:69-96`: `regenerateProjection` sends `POST /api/projections/${projectionId}/candidates` with `{ preview: true, foldIn: true }` and returns `Result<{ readonly id: string }, Error>`.
  - `kalaidoscope/internal/handlers/projections.go:117-187` (`HandleGenerateCandidate`), `kalaidoscope/internal/workers/manager.go:96-102` (`GenerateProjectionSnapshot`), and `kalaidoscope/internal/engine/snapshot.go:140-191` (`GenerateSnapshot`): **Runs synchronously on the HTTP request goroutine.** Before `HandleGenerateCandidate` writes `200 OK {"snapshotId": snapID}`, SQLite already holds the settled snapshot: either `settleApprovedInPlace` updated the existing `approved` snapshot in place (when `unchanged && SettleUnchangedFromContext(ctx)` — status is `"approved"`), or `completeClaimedSnapshot` committed a new candidate with `status = "pending_review"` (and `CarryOpenRefinementToCandidate` re-pointed any lensless open refinement to it). No background worker transitions `snapID`'s status after the HTTP response.
  - `packages/react/state/src/live/use-external-write.ts:92-94`: `regenerateWrite.run(...)` awaits `invalidateLiveTags(["projection_snapshot", "reconcile"])` before resolving.

**Cross-Plan Coupling:**
- **Category 6 (`doctor-06`):** `ProjectionReviewScreenInner` is the #1 highest-complexity component in the repository (`CC=62, Cog=61`, Tier 1). Removing `PendingFoldIn`, `pendingFoldIn` scope state/events, and the 38-line `useEffect` directly reduces its branching and state surface ahead of Category 6.

#### Option A — Settle Fold-In Directly in an Async Helper via `getPendingCandidate(id)`
- **How it works:** Remove `PendingFoldIn`, `pendingFoldIn` from `ReviewWorkflowState`, `setPendingFoldIn` from `ReviewWorkflowEvent`, and the `useEffect` at `:376-413`. Add an `async function settleFoldIn(targetId: string, mode: "single" | "wave")` helper called directly after `await regenerateWrite.run({ projectionId: id, opts: { foldIn: true } })` in `handleApproveAndRefresh` and `approveAndNext`. `settleFoldIn` calls `@kalaido/client`'s existing `await getPendingCandidate(id)` (`packages/lib/client/src/kalaidoscope/projections.ts:120-137`, already used by `findNextTarget` in `ProjectionReviewScreen`): if `pendingRes.isOk() && pendingRes.value?.id === targetId`, the fold-in produced a `pending_review` candidate and navigates via `onViewReview`; otherwise it settled in place as `approved` and runs `onApproveSuccess(id)` (`"single"`) or `await advanceToNextInWave()` (`"wave"`).
- **Verification:** Prototyped in `projection-review-screen.tsx`; `pnpm -r typecheck`, `pnpm check:boundaries`, `pnpm exec biome lint --error-on-warnings`, `pnpm test run`, and `pnpm dlx react-doctor@latest --verbose` passed, eliminating all 5 fold-in warnings (`:390, :393, :400`).
- **Pros:**
  - Linear, readable async control flow inside the user click handlers (`handleApproveAndRefresh` and `approveAndNext`) — eliminates a two-step scope-state + `useEffect` state machine and 5 warnings at once.
  - 100% compliant with `@kalaido/state/live` CQRS write discipline (`regenerateWrite` still returns `{ readonly id: string }` and invalidates live tags; `getPendingCandidate` is an existing read query with `fields: "id"`).
  - Meaningfully reduces `ProjectionReviewScreenInner` cyclomatic complexity for Category 6.
- **Cons:**
  - Issues one lightweight `fields=id` `projection_snapshot` GET (`getPendingCandidate(id)`) after `regenerateWrite`'s `invalidateLiveTags` revalidation.

#### Option B — Retain `pendingFoldIn` Live-Snapshot Effect with Targeted Rule Suppression
- **How it works:** Keep `pendingFoldIn` and the `useEffect` reading `snapshots.find((s) => s.id === pendingFoldIn.snapshotId)` from `useProjectionSnapshot(id)` (zero extra GET request), and add targeted `react-doctor-disable-next-line` comments (or `doctor.config.json` `ignore.overrides`) for `no-prop-callback-in-effect` and `no-pass-data-to-parent` on the navigation calls inside that effect.
- **Verification:** Verified both inline `// react-doctor-disable-next-line` and `doctor.config.json` `ignore.overrides` suppress the 5 warnings in `pnpm dlx react-doctor@latest --verbose` without Biome lint errors.
- **Pros:**
  - Zero extra HTTP read beyond `regenerateWrite`'s existing `invalidateLiveTags` revalidation.
- **Cons:**
  - Retains the indirect `pendingFoldIn` state machine and `CC` contribution inside `ProjectionReviewScreenInner`, and suppresses lint rules over an imperative post-mutation workflow rather than a genuine external push event.

**Ruled-Out Options:**
- **Return `{ id, status }` from `regenerateProjection` / `regenerateWrite`:** Ruled out by `@kalaido/state/live`'s compile-time `ValidWriteReturn<TOut>` type constraint (`packages/react/state/src/live/types.ts` — writes may only return `void | { readonly id: string } | { readonly ids: readonly string[] }`) and `AGENTS.md` / `doctor-03` CQRS write discipline.
- **Read `snapshotsRef.current` (via `useLatestRef(snapshots)`) synchronously on the line after `await regenerateWrite.run(...)`:** Ruled out due to a React 19 commit-timing race — `invalidateLiveTags` resolves as soon as SWR updates its cache and notifies `useSyncExternalStore` listeners to schedule a render, *before* React commits that render and runs `useLayoutEffect` to update `snapshotsRef.current`.

---

### D3.6 — External Live-Data URL Canonicalization Redirects

**Decision:** **Option A** — Declarative `<AppRedirect>` in `apps/desktop/src/routes/` via Screen Render-Redirect Props

**Files & Callers Verified:**
- `packages/react/features/src/projections/projection-detail-screen.tsx:122-139`: When `state.status !== "loading" && !readOnly && !liveSnapshot && pendingCandidate && id`, calls `onReviewCandidate(id, pendingCandidate.id, { replace: true })` (fires `no-prop-callback-in-effect`, `no-pass-live-state-to-parent`, `no-pass-data-to-parent` at `:130`). Note: `:116-120` (`if (state.status === "missing") onBackToList({ replace: true })`) is not flagged by `react-doctor` because `{ replace: true }` passes no reactive data/state.
- `packages/react/features/src/projections/projection-review-screen.tsx:202-206`: When `pendingId && pendingId !== snapshotId`, calls `onViewReview(id, pendingId, { wave: inWave, replace: true })` (fires `no-prop-callback-in-effect`, `no-pass-live-state-to-parent`, `no-pass-data-to-parent` at `:204`), canonicalizing the URL `:snapshotId` parameter and remounting `ProjectionReviewScreenInner` (`key={`${props.id}:${props.snapshotId}`}`).
- **App route wrappers across `apps/{desktop,mobile,web}` verified:**
  - `apps/desktop/src/features/projections/pages/ProjectionDetail.tsx` (`/projections/:id`, alias `/projections/:id/snapshot/:snapshotId`) and `ProjectionReview.tsx` (`/projections/:id/review/:snapshotId`) are the **only** mounts today.
  - `apps/mobile/src/app.tsx` and `apps/web/src/app.tsx` are cloud-only Explore shells and do not mount `ProjectionDetailScreen` or `ProjectionReviewScreen`.
  - `scripts/check-navigation-discipline.mjs:17-26` bans importing `Navigate` (as well as `useNavigate`, `Link`, `useParams`, etc.) from `react-router-dom` anywhere in `packages/` and anywhere in `apps/desktop/src/` **outside** `apps/desktop/src/routes/`.

**Cross-Plan Coupling:**
- **Category 5 (`doctor-05`) & Category 6 (`doctor-06`):** Touching `apps/desktop/src/features/projections/pages/ProjectionDetail.tsx` or `ProjectionReview.tsx` interacts with Category 6 Part A (`only-export-components` on desktop `pages/*.tsx`). Using `doctor.config.json` `ignore.overrides` interacts with Category 6 Part A (`doctor.config.json` creation — note verified workspace-relative glob behavior below).

#### Option A — Declarative `<AppRedirect>` in `apps/desktop/src/routes/` via Screen Render-Redirect Props
- **How it works:**
  1. Add `AppRedirect` in `apps/desktop/src/routes/app-redirect.tsx` (mirroring `apps/desktop/src/routes/route-link.tsx` and `use-app-navigate.ts`: checks `missingScope`, builds path from `TransitionDef<Id>`, and renders `<Navigate replace />` inside `apps/desktop/src/routes/`, where `react-router-dom` is permitted).
  2. Add optional `renderReviewRedirect?: (id: string, snapshotId: string) => ReactNode` on `ProjectionDetailScreenProps` and `renderCandidateRedirect?: (id: string, snapshotId: string, opts: { wave: boolean }) => ReactNode` on `ProjectionReviewScreenProps` (falling back to no-op or callback if omitted). Both screens evaluate the redirect condition purely during render and return the rendered redirect node, deleting both `useEffect` blocks.
  3. Pass `<AppRedirect transition={...} ... replace />` from `apps/desktop/src/features/projections/pages/ProjectionDetail.tsx` and `ProjectionReview.tsx`.
- **Verification:** Prototyped in `apps/desktop/src/routes/app-redirect.tsx`, `ProjectionDetail.tsx`, `ProjectionReview.tsx`, `projection-detail-screen.tsx`, and `projection-review-screen.tsx`. `pnpm -r typecheck`, `pnpm check:boundaries`, `pnpm check:nav`, `pnpm check:design`, `pnpm check:routes`, `pnpm exec biome lint --error-on-warnings`, `pnpm test run`, and `pnpm dlx react-doctor@latest --verbose` all passed with `0` warnings and `0` suppression comments.
- **Pros:**
  - Eliminates both `useEffect` blocks and all 6 warnings cleanly with zero inline disables or config overrides, and avoids rendering a 1-frame flash of the detail/stale-review screen before redirecting.
  - Keeps all domain redirect rules (`!readOnly && !liveSnapshot && pendingCandidate` and `pendingId !== snapshotId`) inside `@kalaido/features` while keeping `react-router-dom` strictly inside `apps/desktop/src/routes/`.
- **Cons:**
  - Adds a small `app-redirect.tsx` helper (~42 LOC) in `apps/desktop/src/routes/` and one render-callback prop on each of the two screen components.

#### Option B — Keep Callback `useEffect` Redirects in `@kalaido/features` with Targeted Suppression
- **How it works:** Keep the two genuine external-SSE URL-canonicalization `useEffect` blocks in `projection-detail-screen.tsx:122-139` and `projection-review-screen.tsx:202-206` (since synchronizing an external router URL with a background PocketBase SSE event is a legitimate external-system effect when declarative `<Navigate>` is unavailable in router-agnostic packages). Suppress the false-positive parent-state rules either:
  - **Line-level (narrowest):** `// react-doctor-disable-next-line react-doctor/no-prop-callback-in-effect, react-doctor/no-pass-live-state-to-parent, react-doctor/no-pass-data-to-parent` directly above `projection-detail-screen.tsx:130` and `projection-review-screen.tsx:204` (`respectInlineDisables` defaults to `true` in `react-doctor`), **or**
  - **Config-level (`doctor.config.json`):** `ignore.overrides` entry matching `["**/projection-detail-screen.tsx", "**/projection-review-screen.tsx"]` (note: only safe *after* **D3.4** and **D3.5** are fixed so real issues in those two files aren't masked).
- **Verification:** Empirically tested both mechanisms in Prototype 1 and Prototype 3 with `pnpm dlx react-doctor@latest --verbose` and `pnpm exec biome lint --error-on-warnings` — both suppress the 6 warnings cleanly with zero Biome complaints.
- **Pros:**
  - Zero new files or props; keeps navigation API uniform across `@kalaido/features` (`onReviewCandidate`, `onViewReview`).
  - Line-level `// react-doctor-disable-next-line` scopes suppression to the exact 2 lines without masking other effects in the same files.
- **Cons:**
  - Leaves two inline suppression comments (or file-level overrides) in source, and still commits 1 render frame before `useEffect` triggers `navigate(..., { replace: true })`.

#### Option C — Lift URL Canonicalization into Desktop Route Page Wrappers
- **How it works:** Export `useProjectionSnapshot` from `@kalaido/features/projections` (its feature barrel, permitted by `AGENTS.md`), add `<AppRedirect>` in `apps/desktop/src/routes/app-redirect.tsx`, and evaluate the redirect conditions at the top of `apps/desktop/src/features/projections/pages/ProjectionDetail.tsx` and `ProjectionReview.tsx` before mounting `<ProjectionDetailScreen>` / `<ProjectionReviewScreen>`, deleting both `useEffect`s from `@kalaido/features`.
- **Verification:** Verified `useLiveCollection` deduplicates `(cache, key)` via `@kalaido/state/live` `registry.ts` (so calling `useProjectionSnapshot(id)` in both wrapper and screen incurs zero extra network fetches or SSE subscriptions), and `pnpm check:boundaries` + `pnpm check:nav` allow barrel imports + `apps/desktop/src/routes/app-redirect.tsx`.
- **Pros:**
  - Keeps `ProjectionDetailScreenProps` and `ProjectionReviewScreenProps` free of redirect-element props while eliminating `useEffect` and suppression comments.
- **Cons:**
  - Moves projection domain routing rules (`!snapshotId && !liveSnapshot && pendingCandidate` and `pendingId !== snapshotId`) out of `@kalaido/features` into `apps/desktop`, so any future web/mobile projection route wrapper would have to duplicate those rules (tension with `AGENTS.md` *"Shared by default"* and thin desktop page wrappers).

**Ruled-Out Options:**
- **Import `<Navigate>` from `react-router-dom` directly in `packages/react/features/*` or in `apps/desktop/src/features/projections/pages/*.tsx`:** Fails `biome.json` (`noRestrictedImports` in `packages/react/**`) and fails `pnpm check:nav` (`scripts/check-navigation-discipline.mjs` bans `Navigate` outside `apps/desktop/src/routes/`).
- **Render candidate review inline without updating the URL:** On `ProjectionReviewScreen` (`/projections/:id/review/:snapshotId`), leaving `:snapshotId` stale when superseded breaks URL/history accuracy; on `ProjectionDetailScreen` (`/projections/:id`), rendering `ProjectionReviewScreen` inline breaks `"Come back later"` (`onBackToDetail(id)`) and wave route state contracts.
- **Use repo-root-relative paths (`"packages/react/features/src/..."`) in `doctor.config.json` `ignore.overrides[].files`:** Empirically verified in Prototype 3 **not to match** — `react-doctor` scans workspace packages from each package's directory and matches `overrides[].files` against package-relative paths (`src/projections/...` or `**/projection-*.tsx`).

---

## 5. Verification

- Run `./kalaido.sh test:ts && ./kalaido.sh check:ts` (runs Biome format/lint, `pnpm check:boundaries`, `pnpm check:nav`, `pnpm check:design`, `pnpm check:routes`, `pnpm -r typecheck`, and production builds for `desktop`, `mobile`, and `web`).
- Manually smoke-test:
  - Explore chat (`initialPrompt` launch from Home, turn completion + bookmarking, and `ContextBar` whole-scope token-budget downgrade to `Summaries` + `@`-mention pinning).
  - Reflection refine (`WindowSelect` `timeWindow` switching both idle and mid-stream + live `apply_result` preview).
  - Projection authoring & candidate review resume (re-entering mid-refinement preserves drafted preview, context, and `useDraftName` auto-naming behavior).
  - Projection detail → pending candidate redirect, superseded candidate redirect, and `"Approve & fold in"` (both unchanged in-place settlement and changed new-candidate settlement, in single and wave modes).
- Run `./kalaido.sh doctor:react --verbose --yes` (or `pnpm dlx react-doctor@latest --verbose --yes`) and confirm:
  - `exhaustive-deps`: `2 → 0`
  - `no-prop-callback-in-effect`: `7 → 0` non-shadcn (`8 → 1` before Category 6 `shadcn/**` exclusion)
  - `no-pass-live-state-to-parent`: `6 → 0` non-shadcn (`7 → 1` before Category 6 `shadcn/**` exclusion)
  - `no-pass-data-to-parent`: `6 → 0` non-shadcn (`7 → 1` before Category 6 `shadcn/**` exclusion)
