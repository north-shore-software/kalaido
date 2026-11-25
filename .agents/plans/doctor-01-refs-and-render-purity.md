# React Doctor — Category 1: Render-Phase Ref Writes & Lazy Ref Init

**Baseline scan:** `react-doctor` full-repo run (`42 / 100`, 138 issues total)  
**Diagnostics covered (8 reported + 1 unflagged same-pattern site + 1 automatic complexity reduction):**
- `react-doctor/no-ref-current-in-render` — **7 errors** (`Bugs`)
- `react-doctor/rerender-lazy-ref-init` — **1 warning** (`Performance`)
- Adjacent same-pattern cleanup: 4 render-phase `stateRef.current.* = ...` writes + eager `generateChips()` / `performance.now()` ref init in `OrganizingSplash` (see **D1.4**)
- Side-effect bonus verified: removing the two render-phase `if (ref.current === null)` branches in `ChatPanel` drops its cyclomatic complexity below 20 (`21 → 19`), clearing `react-doctor/no-high-complexity-react-function` on `chat-panel.tsx:147` (`17 → 16` ahead of Category 6)

---

## 1. The Anti-Pattern

Three variations of reading or mutating `ref.current` during render currently exist in the codebase (confirmed by a repo-wide audit of all `.current =` and `.current.<prop> =` assignments across `packages/react/` and `apps/`):

1. **"Latest value ref" assigned inline during render:**
   ```ts
   const specRef = useRef(itemsToSpec(context ?? []));
   specRef.current = itemsToSpec(context ?? []);
   ```
   - Triggers `rerender-lazy-ref-init` when the initial argument calls a function (`itemsToSpec(...)`) on every render even though React discards it after mount (`chat-panel.tsx:195`), and runs impure `generateChips()` (`45× Math.random()`) + `performance.now()` inside an object literal on every render of `OrganizingSplash` (`organizing-splash.tsx:793-798`).
   - Mutating `.current` (or `.current.<prop>`) during render is unsafe under React concurrent rendering / aborted renders and violates React's render-purity rules.

2. **Lazy one-shot mutable ref initialization during render:**
   ```ts
   const lastSentSpecRef = useRef<string | null>(null);
   if (lastSentSpecRef.current === null) {
     lastSentSpecRef.current = specKey(parseActiveContext(initialMessages ?? []) ?? {});
   }
   ```
   - Although `react-doctor/no-ref-current-in-render` exempts pure read-only null-guarded singletons, `lastSentSpecRef` (`chat-panel.tsx:204`) and `lastSentWindowRef` (`chat-panel.tsx:220`) capture the `initialMessages` prop and are mutated again later in `appendSpecChanges()` and `handleConfirmContext()`, so `react-doctor` flags both sites as render-phase mutations.

3. **Monotonic derived value stored in a ref during render:**
   ```ts
   const highWater = useRef(0);
   highWater.current = Math.max(highWater.current, next);
   return { stage, error, progress: highWater.current };
   ```
   - Reads and writes `.current` directly in the render body to clamp `progress` monotonically upward (`use-pipeline-progress.ts:20`).

---

## 2. Candidate Codebase Patterns

### Pattern 1A — Post-commit latest-value synchronization (`useLayoutEffect` / `useLatestRef`)
Synchronize latest values after commit inside `useLayoutEffect` (runs synchronously before browser paint and before `useEffect` hooks fire, matching existing repo usage in `packages/react/state/src/live/use-live-read.ts:57-59`, `packages/react/state/src/live/use-external-write.ts:33-35`, `packages/react/features/src/fragments/components/add-fragment-modal.tsx:58-61`, and `packages/react/features/src/reflections/hooks/use-persist-schedule.ts:30-33`):

- Either via a shared `useLatestRef<T>(value: T): { readonly current: T }` helper or inline `useRef` + `useLayoutEffect` (see **D1.1** — note an important `exhaustive-deps` linter trade-off uncovered during verification).
- Memoize `itemsToSpec(context ?? [])` via `useMemo` before passing it into the ref so `useRef` never runs an eager factory call on every render.

### Pattern 1B — One-shot mutable baseline without render-time ref mutation
For mutable baselines seeded once per conversation from `initialMessages` and subsequently mutated only in effects / event handlers (never read to drive JSX; see **D1.2**):

- **Mount-once state seed (`useState(() => ...)` + `useRef(initialKey)`):** Runs the parser once on mount with zero render-phase ref reads/writes.
- **Lazy getter outside render (`getLastSentSpec` / `getLastSentWindow`):** Leaves `useRef<string | null>(null)` untouched during render and computes `ref.current ??= ...` on first read inside effects/handlers.
- **Null-guarded `useLayoutEffect` seed:** Populates `ref.current` when `null` inside `useLayoutEffect` prior to any `useEffect`.

### Pattern 1C — Monotonic UI progress without render-mutated ref
For `usePipelineProgress()` (`apps/desktop/src/features/onboarding/hooks/use-pipeline-progress.ts`; see **D1.3**):

- **Render-phase state latch:** `const [highWater, setHighWater] = useState(next); if (next > highWater) setHighWater(next);` (zero `useEffect`, zero extra post-commit render).
- **Post-commit `useEffect` state latch:** `const [highWater, setHighWater] = useState(next); const progress = Math.max(highWater, next);` + `useEffect` updating `highWater` when `next > highWater`.
- **Imperative rAF clamp in `OrganizingSplash`:** Keep `usePipelineProgress` stateless and clamp `st.highWater` inside `OrganizingSplash`'s `requestAnimationFrame` loop (its sole consumer).

---

## 3. File-by-File Inventory & Migration Plan

| File | Line(s) | Rule(s) | Planned Change |
|---|---|---|---|
| `packages/react/components/src/chat-panel.tsx` | 192, 195, 196, 204, 215, 217, 220 | `no-ref-current-in-render` (×6), `rerender-lazy-ref-init` (×1) *(+ clears `no-high-complexity-react-function` at `:147`)* | Synchronize `manageContextRef`, `specRef` (over `useMemo(() => itemsToSpec(context ?? []), [context])`), `manageWindowRef`, and `timeWindowRef` post-commit via **D1.1**. Replace render-phase `lastSentSpecRef` and `lastSentWindowRef` initialization via **D1.2**. |
| `apps/desktop/src/features/onboarding/hooks/use-pipeline-progress.ts` | 20 | `no-ref-current-in-render` (×1) | Replace render-phase `highWater.current = Math.max(...)` mutation via **D1.3**. |
| `apps/desktop/src/features/onboarding/components/organizing-splash.tsx` | 784–804 | *(unflagged same anti-pattern: nested `stateRef.current.*` writes + eager `generateChips()`/`performance.now()` in `useRef({...})`)* | Per **D1.4**, either clean up in Category 1 (moving prop sync out of render and `generateChips()`/`performance.now()` out of `useRef({...})`) or fold into Category 2 / Category 6. |

### Verified Invariants to Preserve
- **`ChatPanel` conversation remounting (verified across all callers):** Every mount site keys `<ChatPanel>` on conversation identity and loads persisted `initialMessages` before mounting:
  - `RefineChatPanel` (`packages/react/components/src/refine-chat-panel.tsx:64`): `key={session.clientId}`, mounted only after `session.started` / `resumed` is `true` (`NewProjectionScreen:173`, `ProjectionDetailScreen:306`, `ProjectionReviewScreen:744`, `ReflectionRefineScreen:348`).
  - `ExploreScreen` (`packages/react/features/src/explore/explore-screen.tsx:359`) & `ExploreCompactScreen` (`packages/react/features/src/explore/explore-compact-screen.tsx:351`): `key={activeChatKey}` (`selected?.id ?? newChatId`), where both `restoredRecentRef` and `handleSelect` `await getConversationMessages(...)` before dispatching `selectConversation`.
- **`ChatPanel` `useLayoutEffect` → `useEffect` ordering:** Post-commit `useLayoutEffect` updates `manageContextRef`, `specRef`, `manageWindowRef`, and `timeWindowRef` before `ChatPanel`'s `useEffect` hooks (`initialPrompt` auto-send at `:271` and `timeWindow` re-apply at `:298`) execute.
- **`ChatPanel` `timeWindow` baseline before `appendSpecChanges()`:** Line 300 (`if (timeWindowKey(timeWindow) === lastSentWindowRef.current) return;`) reads `lastSentWindowRef` *before* calling `appendSpecChanges()` and `sendMessage()`, so the window baseline must already be seeded (or read through a lazy getter at line 300 too) when that `useEffect` runs on mount.
- **`usePipelineProgress` monotonic progress:** Progress reported to `OrganizingSplash` must never regress across status updates and must reflect upward jumps without visual lag.

---

## 4. Decision Points

| ID | Decision | Feasible Options | Cross-Plan Coupling | Selected |
|---|---|---|---|---|
| **D1.1** | Latest-value ref mechanism & placement | Option A (`@kalaido/hooks/use-latest-ref`), Option B (`@kalaido/primitives/hooks/use-latest-ref`), Option C (Inline `useRef` + `useLayoutEffect`), Option D (`@kalaido/hooks/use-sync-ref` with native `useRef`) | `doctor-03` (`useKalaidoChat` in `@kalaido/hooks` + `appendSpecChanges` / `timeWindow` deps), `doctor-02` (`AddFragmentModal` if adopted wider) | **Option D** |
| **D1.2** | One-shot mutable baselines in `ChatPanel` (`lastSentSpecRef`, `lastSentWindowRef`) | Option A (`useState(() => ...)` seed + `useRef`), Option B (Lazy getter outside render), Option C (Null-guarded `useLayoutEffect` seed) | `doctor-03` (`ChatPanel` `appendSpecChanges` `useCallback` & `useChat` ownership), `doctor-06` (clears `ChatPanel` `no-high-complexity-react-function`) | **Option C** |
| **D1.3** | Monotonic `highWater` clamping in `usePipelineProgress` | Option A (Render-phase `useState` latch), Option B (`useState` + `Math.max` + `useEffect` latch), Option C (Stateless hook + rAF clamp in `OrganizingSplash`) | None for Options A/B; Option C couples with **D1.4**, `doctor-02`, and `doctor-06` on `organizing-splash.tsx` | **Option A** |
| **D1.4** | `OrganizingSplash` render-phase `stateRef` writes & eager `generateChips()` init | Option A (Fix in Cat 1: split prop ref + `endAtRef` + effect-local loop state), Option B (Fix in Cat 1: single `stateRef` + `useLayoutEffect` + lazy `chips: null`), Option C (Defer to Cat 2 / Cat 6) | `doctor-02` (`organizing-splash.tsx:806-850, 1075`), `doctor-06` (`organizing-splash.tsx:770` `runSplashLoop` `.ts` extraction) | **Option A** |

---

### D1.1 — Latest-Value Ref Mechanism & Placement

**Decision:** **Option D** — Subpath export `@kalaido/hooks/use-sync-ref` paired with native `useRef` at call sites

**Files & Callers Verified:**
- Category 1 consumers: `packages/react/components/src/chat-panel.tsx:191-196, 214-217` (4 refs) and `apps/desktop/src/features/onboarding/components/organizing-splash.tsx:801-804` (4 prop fields on `stateRef`, if D1.4 fixes in Category 1).
- Existing hand-rolled `useRef` + `useLayoutEffect` sites: `packages/react/state/src/live/use-live-read.ts:57-59, 123-125`, `packages/react/state/src/live/use-external-write.ts:33-35`, `packages/react/features/src/fragments/components/add-fragment-modal.tsx:58-61`, `packages/react/features/src/reflections/hooks/use-persist-schedule.ts:30-33`.
- Package exports & boundaries (`packages/react/hooks/package.json:6-13`, `packages/react/primitives/package.json:6-26`, `scripts/check-boundaries.mjs:8-62`):
  - Neither `@kalaido/hooks` (`"./*": "./src/*.ts"`) nor `@kalaido/primitives` (`"./hooks/*": "./src/hooks/*.ts"`) has a root `"."` barrel; both already expose extensionless subpath wildcards requiring **zero `package.json` changes**.
  - Boundary asymmetry: `packages/react/hooks` may import only `@kalaido/{platform,client,state}` (it **cannot** import `@kalaido/primitives`), whereas `components`, `features`, and `apps/*` already depend on both `@kalaido/hooks` and `@kalaido/primitives`.
- **Empirical linter finding:** Both `react-doctor/exhaustive-deps` and Biome `useExhaustiveDependencies` recognize `useRef` from `"react"` as stable by hook name (requiring zero dependency-array entries), whereas a custom `useLatestRef` return value **must** be listed in `useEffect` / `useCallback` dependency arrays wherever read (verified: `propsRef` is referentially stable because `useLatestRef` returns the underlying `useRef` object, so listing `[propsRef]` does not cause extra effect runs).

**Cross-Plan Coupling:**
- **`doctor-03` (`packages/react/components/src/chat-panel.tsx:278, 305`):** Under Options A and B, wrapping `appendSpecChanges` in `useCallback` (`doctor-03` Pattern 3B) requires `[manageContextRef, specRef, manageWindowRef, timeWindowRef, setMessages]` in its deps, and the `timeWindow` `useEffect` (`:298-305`) requires `manageWindowRef` in its deps. Under Option C, `useRef` identifiers require no dep entries.
- **`doctor-02` (`packages/react/features/src/fragments/components/add-fragment-modal.tsx:58-61`):** Touches `AddFragmentModal`, which already has an inline `onCloseRef` `useLayoutEffect`; keeping Category 1 scoped strictly to its own target files avoids unnecessary merge overlap.

#### Option A — Subpath export `@kalaido/hooks/use-latest-ref`
- **How it works:** Create `packages/react/hooks/src/use-latest-ref.ts` exporting `useLatestRef<T>(value: T): { readonly current: T }` (auto-exposed via `"./*": "./src/*.ts"` with no `package.json` edit). Import `@kalaido/hooks/use-latest-ref` in `chat-panel.tsx` (and `organizing-splash.tsx`), and include returned ref objects in `useEffect`/`useCallback` dependency arrays where accessed.
- **Verification:** `pnpm -r typecheck` passed; `node scripts/check-boundaries.mjs` passed (11 packages); `pnpm exec biome lint` passed (0 issues); `vitest` passed; `react-doctor` passed (`no-ref-current-in-render` `7 → 0`, `rerender-lazy-ref-init` `1 → 0`, `exhaustive-deps` unchanged at `2` once `[propsRef]` is listed in `organizing-splash.tsx`).
- **Pros:**
  - Reachable from `@kalaido/hooks`, `@kalaido/components`, `@kalaido/features`, and all `apps/*` with zero `package.json` edits.
  - `{ readonly current: T }` return type prevents accidental `.current = ...` writes at call sites.
- **Cons:**
  - Cannot be imported inside `@kalaido/primitives` or `@kalaido/state`.
  - Callers must list `useLatestRef` variables in `useEffect` / `useCallback` dependency arrays to satisfy Biome and `react-doctor/exhaustive-deps`.

#### Option B — Subpath export `@kalaido/primitives/hooks/use-latest-ref`
- **How it works:** Create `packages/react/primitives/src/hooks/use-latest-ref.ts` alongside `use-mobile.ts` (auto-exposed via `"./hooks/*": "./src/hooks/*.ts"` with no `package.json` edit). Import `@kalaido/primitives/hooks/use-latest-ref` in `chat-panel.tsx` (and `organizing-splash.tsx`), listing returned ref objects in effect/callback deps where accessed.
- **Verification:** `pnpm --filter @kalaido/primitives --filter @kalaido/components --filter @kalaido/desktop typecheck` passed; `node scripts/check-boundaries.mjs` passed; `pnpm exec biome lint` passed; `react-doctor` passed (`129` issues, `49 / 100`).
- **Pros:**
  - Aligns with `AGENTS.md`'s rule placing domain-free React utilities in `@kalaido/primitives`; usable in `primitives`, `components`, `features`, and `apps/*`.
  - Enforces `{ readonly current: T }` at call sites with zero `package.json` edits.
- **Cons:**
  - Forbidden in `@kalaido/hooks` (`scripts/check-boundaries.mjs:14-18`) and `@kalaido/state`, so hooks in `packages/react/hooks` cannot reuse it.
  - Same `exhaustive-deps` requirement as Option A.

#### Option C — Inline `useRef` + single `useLayoutEffect` per file (no new shared helper)
- **How it works:** Keep standard `useRef` declarations in `chat-panel.tsx` (and `organizing-splash.tsx`) and synchronize all latest-value refs for the component inside a single `useLayoutEffect(() => { manageContextRef.current = ...; specRef.current = activeSpec; manageWindowRef.current = ...; timeWindowRef.current = timeWindow; })`.
- **Verification:** `tsc --noEmit` passed; `node scripts/check-boundaries.mjs` passed; `pnpm exec biome lint` passed; `react-doctor` passed (`no-ref-current-in-render` `7 → 0`, `rerender-lazy-ref-init` `1 → 0`, zero new `exhaustive-deps` entries).
- **Pros:**
  - Zero new files or cross-package imports; matches the 5 existing `useLayoutEffect` ref sites across `@kalaido/state` and `@kalaido/features`.
  - Both Biome and `react-doctor/exhaustive-deps` recognize `useRef` natively, so `manageContextRef`, `specRef`, `manageWindowRef`, `timeWindowRef`, and `stateRef` never clutter `useEffect` / `useCallback` dependency arrays in Category 1 or Category 3.
  - Batches 4 ref updates in `ChatPanel` into 1 `useLayoutEffect` hook registration instead of 4.
- **Cons:**
  - Slight boilerplate in each component; does not enforce a read-only `.current` type externally.

#### Option D — Subpath export `@kalaido/hooks/use-sync-ref` paired with native `useRef` at call sites
- **How it works:** Create `packages/react/hooks/src/use-sync-ref.ts` (auto-exposed via `"./*": "./src/*.ts"` with zero `package.json` edits) exporting `useSyncRef<T>(ref: RefObject<T>, value: T): void`, which runs `useLayoutEffect(() => { ref.current = value; })`. Callers declare a native `useRef(...)` from `"react"` (or group multiple latest values into one `latestRef = useRef({ ... })`) and call `useSyncRef(ref, value)` immediately below it.
- **Pros:**
  - Reachable from `@kalaido/hooks` (including `useKalaidoChat` under `doctor-03` **D3.1 Option A**), `@kalaido/components`, `@kalaido/features`, and all `apps/*` with zero `package.json` edits (unlike Option B, which `@kalaido/hooks` is forbidden from importing).
  - Because callers declare literal `useRef(...)` from `"react"`, both Biome and `react-doctor/exhaustive-deps` recognize the ref as stable — zero dependency-array noise in `useEffect` / `useCallback`.
  - Makes post-commit ref synchronization an explicit, searchable named pattern (`useSyncRef`) instead of anonymous `useLayoutEffect` blocks, and batches cleanly when grouping values into a single ref.
- **Cons:**
  - Requires two lines (`useRef` + `useSyncRef`) at call sites and does not enforce `{ readonly current: T }` at the type level (render-phase writes remain guarded by `react-doctor/no-ref-current-in-render`).
  - Cannot be imported inside `@kalaido/primitives` or `@kalaido/state` (neither currently needs it outside `@kalaido/state`'s existing internal `useLayoutEffect` sites).

#### Ruled-Out Options
- **Using `useLatestRef` while omitting its returned ref from `useEffect([], ...)` deps:** Ruled out — empirically triggered a new `react-doctor/exhaustive-deps` warning at `organizing-splash.tsx:1078` (`Bugs: 36 → 37`) and added `manageWindowRef` to `chat-panel.tsx:299`'s missing-deps diagnostic.
- **Adding a root `"."` barrel (`src/index.ts`) to `@kalaido/hooks`:** Ruled out — `@kalaido/hooks` is intentionally subpath-only (`packages/react/hooks/package.json:6-9` has no `"."` export), and `"./*": "./src/*.ts"` already exports `@kalaido/hooks/use-latest-ref` with zero config changes.

---

### D1.2 — One-Shot Mutable Baselines in `ChatPanel` (`lastSentSpecRef`, `lastSentWindowRef`)

**Decision:** **Option C** — Null-guarded `useLayoutEffect` seeding before `useEffect` runs

**Files & Callers Verified:**
- `packages/react/components/src/chat-panel.tsx:202-207` (`lastSentSpecRef`), `:218-223` (`lastSentWindowRef`), `:300` (`lastSentWindowRef.current` read inside `timeWindow` `useEffect` **before** `appendSpecChanges()`), `:319-334` (`appendSpecChanges`), `:395` (`handleConfirmContext`).
- All 3 `<ChatPanel>` JSX mount sites (`packages/react/components/src/refine-chat-panel.tsx:64`, `packages/react/features/src/explore/explore-screen.tsx:359`, `packages/react/features/src/explore/explore-compact-screen.tsx:351`) key `<ChatPanel>` on conversation identity and resolve persisted `initialMessages` prior to mount. Note that `explore-screen.tsx:215` and `explore-compact-screen.tsx:205` evaluate `(selected?.messages ?? []) as UIMessage[]`, passing a fresh `[]` reference on every render while `selected` is `null`.

**Cross-Plan Coupling:**
- **`doctor-03` (`packages/react/components/src/chat-panel.tsx:276-278, 298-305`):** `doctor-03` wraps `appendSpecChanges` in `useCallback` (and considers lifting `useChat` into `useKalaidoChat` or moving the `timeWindow` auto-send effect into `ChatPanelHandle`). All three options below keep `appendSpecChanges` free of changing render closures.
- **`doctor-06` (`packages/react/components/src/chat-panel.tsx:146-147`):** Removing the two `if (ref.current === null)` branches in `ChatPanel` drops cyclomatic complexity from `21 → 19`, clearing `ChatPanel`'s `no-high-complexity-react-function` warning automatically.

#### Option A — Mount-once `useState(() => ...)` seed + `useRef(initialKey)`
- **How it works:** In `packages/react/components/src/chat-panel.tsx`, compute initial keys once via lazy `useState` initializers (`const [initialSpecKey] = useState(() => specKey(parseActiveContext(initialMessages ?? []) ?? {})); const lastSentSpecRef = useRef(initialSpecKey);` and `const [initialWindowKey] = useState(() => timeWindowKey(parseActiveWindow(initialMessages ?? []))); const lastSentWindowRef = useRef(initialWindowKey);`). Keep all downstream reads/writes of `lastSentSpecRef.current` and `lastSentWindowRef.current` unchanged.
- **Verification:** `pnpm -r typecheck` passed; `pnpm exec biome lint` passed; `vitest` (`context-spec.test.ts`, `state.test.ts`) passed; `react-doctor` passed (`no-ref-current-in-render` `7 → 0`, `no-high-complexity-react-function` `17 → 16`, zero `no-derived-state` or `no-initialize-state` warnings).
- **Pros:**
  - Runs `parseActiveContext` / `parseActiveWindow` once on mount (twice only in dev StrictMode purity check); `lastSentWindowRef.current` is populated before any `useEffect` runs.
  - `lastSentSpecRef` and `lastSentWindowRef` remain plain `useRef<string>` objects — zero changes to line 300, `appendSpecChanges()`, or `handleConfirmContext()`, and zero extra deps for `doctor-03`'s `useCallback`.
- **Cons:**
  - Allocates two read-once `useState` slots whose setters are never used, and parses `initialMessages` eagerly on mount even if the user only reads the transcript without sending a turn.
  - Relies on callers keying `ChatPanel` on conversation identity (verified true across all current callers, matching `sentInitial = useRef(false)` at `:269`).

#### Option B — Lazy getter helpers outside render (`getLastSentSpec` / `getLastSentWindow`)
- **How it works:** In `packages/react/components/src/chat-panel.tsx`, keep `lastSentSpecRef = useRef<string | null>(null)` and `lastSentWindowRef = useRef<string | null>(null)` + `initialMessagesRef` (synced post-commit), and read baselines through stable `useCallback` helpers (`lastSentSpecRef.current ??= specKey(...)`, `lastSentWindowRef.current ??= timeWindowKey(...)`) at **both** line 300 (`if (timeWindowKey(timeWindow) === getLastSentWindow()) return;`) and inside `appendSpecChanges()` (`:320, :329`).
- **Verification:** `pnpm -r typecheck` passed; `pnpm exec biome lint` passed; `vitest` passed; `react-doctor` passed (`129` issues, `49 / 100`, zero new warnings).
- **Pros:**
  - Zero `useState` slots for non-UI state; `parseActiveContext` does not run at all unless a turn is actually sent.
  - Safe under React StrictMode and concurrent rendering (no mutation during render).
- **Cons:**
  - Slightly more code than Option A (+2 `useCallback` helpers + `initialMessagesRef`), and `getLastSentSpec` / `getLastSentWindow` must be listed in `appendSpecChanges`'s `useCallback` deps in `doctor-03`.
  - Easy to introduce a subtle bug if a future reader checks `lastSentWindowRef.current` directly instead of calling `getLastSentWindow()`.

#### Option C — Null-guarded `useLayoutEffect` seeding before `useEffect` runs
- **How it works:** Keep `lastSentSpecRef = useRef<string | null>(null)` and `lastSentWindowRef = useRef<string | null>(null)`, and populate both when `=== null` inside `useLayoutEffect(() => { ... }, [initialMessages])` (which runs synchronously before `ChatPanel`'s `useEffect` hooks at `:271` and `:298`).
- **Verification:** `tsc --noEmit` passed; `pnpm exec biome lint` passed; `react-doctor` passed (`129` issues, `49 / 100`, zero new warnings).
- **Pros:**
  - Zero `useState` hooks and zero extra `useCallback` dependencies for `doctor-03`; `lastSentWindowRef.current` is guaranteed non-null before `useEffect` at `:298` runs.
- **Cons:**
  - Because `ExploreScreen:215` and `ExploreCompactScreen:205` pass a fresh `[]` when `selected === null`, `[initialMessages]` causes `useLayoutEffect` to re-enter on every render of a new Explore chat (hitting the `=== null` guard and returning).
  - Keeps the ref typed `string | null` even though it is always non-null after commit.

#### Ruled-Out Options
- **Lazy-seeding `lastSentWindowRef.current ??= ...` only inside `appendSpecChanges()` (leaving `:300` reading `lastSentWindowRef.current` directly):** Ruled out — when re-opening an existing reflection refinement that already contains an assistant message and active `timeWindow`, line 300 (`timeWindowKey(timeWindow) === lastSentWindowRef.current`) compares a string key against `null` (`false`), enters the effect body, seeds the matching key inside `appendSpecChanges()` without adding a system part, and then calls `sendMessage()` on line 304, firing an unintended empty request on mount.

---

### D1.3 — Monotonic `highWater` Clamping in `usePipelineProgress`

**Decision:** **Option A** — Render-phase `useState` monotonic latch (zero `useEffect`)

**Files & Callers Verified:**
- `apps/desktop/src/features/onboarding/hooks/use-pipeline-progress.ts:13-23` (hook definition).
- `apps/desktop/src/features/onboarding/pipeline-progress.ts:24-67` & `apps/desktop/src/features/onboarding/pipeline-progress.test.ts:1-193` (16 unit tests covering `organizeStage` and `pipelineProgress`).
- Sole caller in repo: `apps/desktop/src/features/onboarding/pages/OnboardingOrganizing.tsx:9, 14-19`, which passes `progress` to `<OrganizingSplash progress={progress} ... />`. `OrganizingSplash` (`organizing-splash.tsx:1034-1041`) reads `progress` exclusively inside its `requestAnimationFrame` `tick()` loop.
- **Empirical `no-adjust-state-on-prop-change` check:** Both render-phase state latching (Option A) and `useEffect` state latching (Option B) were prototyped and scanned with `react-doctor@0.9.23` — **neither** triggers `no-adjust-state-on-prop-change`, `no-derived-state`, `no-derived-state-effect`, or `no-initialize-state` (confirmed in `oxlint-plugin-react-doctor`: `usePipelineProgress` takes no props, and `next > highWater` is a self-guarded monotonic comparison rather than a `!==` prop mirror).

**Cross-Plan Coupling:**
- Options A and B: `None` (`use-pipeline-progress.ts` is untouched by Categories 2–6).
- Option C: Coupled with **D1.4**, **`doctor-02`**, and **`doctor-06`** on `apps/desktop/src/features/onboarding/components/organizing-splash.tsx`.

#### Option A — Render-phase `useState` monotonic latch (zero `useEffect`)
- **How it works:** In `apps/desktop/src/features/onboarding/hooks/use-pipeline-progress.ts`, replace `useRef` with React's render-phase state adjustment:
  ```ts
  const [highWater, setHighWater] = useState(next);
  if (next > highWater) {
    setHighWater(next);
  }
  return { stage, error, progress: highWater };
  ```
- **Verification:** `pnpm -r typecheck` passed; `pnpm exec biome lint` passed; `vitest` (`pipeline-progress.test.ts`, 16/16 tests) passed; `react-doctor` passed with **0 diagnostics** on `use-pipeline-progress.ts`.
- **Pros:**
  - Pure during render (no ref mutation), zero `useEffect`, and zero extra post-commit DOM/effect cycle when `next` advances (React immediately restarts only the hook host's render before commit).
  - Keeps `usePipelineProgress()` self-contained and monotonically non-decreasing for any caller, resetting cleanly on unmount/remount across onboarding runs.
- **Cons:**
  - Uses React's render-time `setState` pattern (less common in the repo than effects, though explicitly supported by React 19 for monotonic/previous-value state).

#### Option B — `useState(next)` + render `Math.max` + `useEffect` latch (original Pattern 1C)
- **How it works:** In `apps/desktop/src/features/onboarding/hooks/use-pipeline-progress.ts`, compute `const [highWater, setHighWater] = useState(next); const progress = Math.max(highWater, next);` and latch upward in `useEffect(() => { if (next > highWater) setHighWater(next); }, [next, highWater]);` (an equivalent `useReducer(Math.max, next)` + `useEffect` variant was also verified clean).
- **Verification:** `pnpm -r typecheck` passed; `node scripts/check-boundaries.mjs` passed; `pnpm exec biome lint` passed; `vitest` (`pipeline-progress.test.ts`, 16/16 tests) passed; `react-doctor` passed with **0 diagnostics** (specifically verified: `no-adjust-state-on-prop-change` remained `5`, `no-ref-current-in-render` dropped `7 → 0`).
- **Pros:**
  - Zero `setState` during render and zero 1-frame lag on upward jumps (`Math.max(highWater, next)` returns the new peak immediately on the first render).
  - Preserves `usePipelineProgress()`'s standalone monotonic contract.
- **Cons:**
  - Schedules a follow-up `useEffect` + second render every time `next` reaches a new high-water mark (~5–30 times during onboarding).

#### Option C — Stateless `usePipelineProgress` + imperative clamp inside `OrganizingSplash` rAF loop
- **How it works:** Return raw `{ stage, error, progress: next }` from `use-pipeline-progress.ts` (zero React state or refs in the hook) and clamp `st.highWater = Math.max(st.highWater, st.progress)` inside `OrganizingSplash`'s existing 60fps `tick()` loop (`apps/desktop/src/features/onboarding/components/organizing-splash.tsx:1034`).
- **Verification:** `tsc --noEmit` passed; `pnpm exec biome lint` passed; `node scripts/check-boundaries.mjs` passed; `react-doctor` passed (`129` issues, `49 / 100`, 0 diagnostics on `use-pipeline-progress.ts`).
- **Pros:**
  - Makes `usePipelineProgress` 100% pure/stateless with zero extra React renders as progress advances; clamping happens where `percent` is already throttled in `tick()`.
- **Cons:**
  - Shifts the monotonicity invariant out of `usePipelineProgress()` into `OrganizingSplash`, so a future consumer of `usePipelineProgress()` would receive unclamped `pipelineProgress(status)`.
  - Couples `use-pipeline-progress.ts` with `organizing-splash.tsx` edits (**D1.4** / `doctor-02` / `doctor-06`).

---

### D1.4 — `OrganizingSplash` Render-Phase `stateRef` Writes & Eager `generateChips()` Init

**Decision:** **Option A** — Fix in Category 1 by splitting latest-prop ref + `endAtRef` from mount-effect loop state

**Files & Callers Verified:**
- `apps/desktop/src/features/onboarding/components/organizing-splash.tsx:580-641` (`generateChips()` invokes `Math.random()` 45 times to build 5 `Chip` configs), `:784-799` (`useRef({ speed, ending, progress, onEnded, onSnapshotReady, ..., t0: performance.now(), last: performance.now(), ..., chips: generateChips() })` — runs on every render of `OrganizingSplash`, and `ending` at `:786` is unread dead state), `:801-804` (`stateRef.current.{speed,progress,onEnded,onSnapshotReady} = ...` — confirmed via repo-wide regex to be the **only** nested `ref.current.<prop> = ...` render-phase writes in the codebase).
- Sole caller: `apps/desktop/src/features/onboarding/pages/OnboardingOrganizing.tsx:14-19`.
- Baseline `react-doctor` status on lines 784–804: currently **unreported** (`no-ref-current-in-render` checks only top-level `.current =`, and `rerender-lazy-ref-init` checks only top-level `useRef(fn())` / `useRef(new Foo())`, missing calls nested inside an object literal).

**Cross-Plan Coupling:**
- **`doctor-02` (`apps/desktop/src/features/onboarding/components/organizing-splash.tsx:809, 810, 820`):** Touches `triggerEnd` / `useEffect([ending])` (`no-adjust-state-on-prop-change` ×2) and `swapTimer` cleanup (`effect-needs-cleanup` ×1 at `:820` / `:1075`). *(Cross-plan note verified in `tick()` at lines 894–904: after `endAt` is set, `tick()` updates `status` to `"snapshot ready"` at `te > 3.0` and fades `statusOpacity` to `0` at `te > 5.2`, so `doctor-02` must preserve post-`endAt` `tick()` state updates rather than unconditionally overriding `status`/`statusOpacity` whenever `ending` is true.)*
- **`doctor-06` (`apps/desktop/src/features/onboarding/components/organizing-splash.tsx:770`):** Tier 3 extracts the canvas loop (`runSplashLoop`) into a sibling `.ts` module to resolve `no-giant-component` (342 LOC).

#### Option A — Fix in Category 1 by splitting latest-prop ref + `endAtRef` from mount-effect loop state
- **How it works:** In `apps/desktop/src/features/onboarding/components/organizing-splash.tsx`, hold `{ speed, progress, onEnded, onSnapshotReady }` in a post-commit ref (per **D1.1**), hold `endAt` in `endAtRef = useRef<number | null>(null)`, and move `t0`, `last`, `ft`, `pi`, `lastPercent`, `snapshotReadyFired`, `endedFired`, and `chips: generateChips()` into a plain local `st` object created once inside the mount `useEffect` (since none of those 8 fields are ever accessed outside that `useEffect`). Removes dead `ending` field from `stateRef`.
- **Verification:** `pnpm -r typecheck` passed; `pnpm exec biome lint` passed; `node scripts/check-boundaries.mjs` passed; `react-doctor` passed (`129` issues, `49 / 100`, zero new warnings when `[propsRef]` is included in `useEffect` deps under D1.1 Option A/B or `[]` under D1.1 Option C).
- **Pros:**
  - Eliminates all 4 render-phase mutations and all render-time `generateChips()` / `performance.now()` calls.
  - Resets `t0`, `last`, and `chips` cleanly across React StrictMode effect unmount/remount cycles.
  - Cleanly isolates loop-internal state (`st`) inside the mount `useEffect`, directly preparing `doctor-06`'s `runSplashLoop` `.ts` extraction without throwaway refactoring and keeping `endAtRef` cleanly separated for `doctor-02`.
- **Cons:**
  - Touches ~35 lines inside `organizing-splash.tsx` in Category 1 (same region `doctor-02` and `doctor-06` also touch).

#### Option B — Fix in Category 1 with minimal in-place `stateRef` edit (`useLayoutEffect` + lazy `chips: null`)
- **How it works:** Keep the single `stateRef` object in `apps/desktop/src/features/onboarding/components/organizing-splash.tsx`, initialize `t0: 0, last: 0, chips: null as Chip[] | null` (removing dead `ending`), move the 4 `stateRef.current.{speed,progress,onEnded,onSnapshotReady}` assignments into a `useLayoutEffect`, and initialize `t0`, `last`, and `stateRef.current.chips ??= generateChips()` at the top of the mount `useEffect`.
- **Verification:** `tsc --noEmit` passed; `pnpm exec biome lint` passed; `node scripts/check-boundaries.mjs` passed; `react-doctor` passed (`129` issues, `49 / 100`, zero new warnings).
- **Pros:**
  - Smallest possible diff in Category 1 (~12 lines changed) while fixing both render-phase ref writes and eager `generateChips()` / `performance.now()` calls.
  - Leaves lines 806–850 (`triggerEnd`, `useEffect([ending])`, `statusTimer`) untouched for `doctor-02`.
- **Cons:**
  - `doctor-06` will still refactor `stateRef` again if Tier 3 extracts `runSplashLoop` into a `.ts` module.

#### Option C — Defer `organizing-splash.tsx` from Category 1 and fold into Category 2 or Category 6
- **How it works:** Limit Category 1 strictly to the 8 reported `react-doctor` diagnostics (`chat-panel.tsx` and `use-pipeline-progress.ts`), and fold the `organizing-splash.tsx:784-804` `stateRef` cleanup into Category 2 (`doctor-02`, which already edits `organizing-splash.tsx:806-850, 1075`) or Category 6 (`doctor-06` Tier 3 `runSplashLoop` extraction).
- **Verification:** Verified that `organizing-splash.tsx:784-804` contributes `0` reported `react-doctor` issues today, so Category 1 still achieves `no-ref-current-in-render: 7 → 0` and `rerender-lazy-ref-init: 1 → 0` (`138 → 129` total issues, `42 → 49` score) without touching `organizing-splash.tsx`.
- **Pros:**
  - Avoids editing `organizing-splash.tsx` across three separate categories (`doctor-01`, `doctor-02`, `doctor-06`).
  - Minimal diff strictly matching reported Category 1 diagnostics.
- **Cons:**
  - Leaves the 4 unflagged render-phase `stateRef.current.*` mutations and per-render `generateChips()` / `performance.now()` calls in place until Category 2 or Category 6 lands (and risks being forgotten if `doctor-06` Tier 3 is deferred).

#### Ruled-Out Options
- **`useState(() => createInitialSplashState())` for the mutable animation state bag:** Ruled out — mutating properties on a `useState` object during render (`splashState.speed = speed`) still violates React render purity, and mutating 60fps animation fields (`ft`, `last`, `lastPercent`) in-place on React state misuses `useState` where `useRef` or effect-local state belongs.

---

## 5. Verification

- Run `./kalaido.sh test:ts && ./kalaido.sh check:ts` (covers Biome format + lint, `check:boundaries`, `check:nav`, `check:design`, `check:routes`, `pnpm -r typecheck`, and production builds for `desktop`, `mobile`, and `web`).
- Re-run `pnpm dlx react-doctor@latest . --verbose --yes` and confirm (empirically verified in isolated prototype runs):
  - `no-ref-current-in-render`: `7 → 0` (`Bugs` errors: `11 → 4`)
  - `rerender-lazy-ref-init`: `1 → 0` (`Performance` warnings: `14 → 13`)
  - `no-high-complexity-react-function`: `17 → 16` (`ChatPanel` drops out automatically; `Maintainability` warnings: `69 → 68`)
  - Zero regressions in `exhaustive-deps` (`2`), `no-adjust-state-on-prop-change` (`5`), or any other rule (`138 → 129` total issues, score `42 → 49 / 100` from Category 1 alone).
