# React Doctor — Category 1: Render-Phase Ref Writes & Lazy Ref Init

**Baseline scan:** `react-doctor` full-repo run (`42 / 100`, 138 issues total)  
**Diagnostics covered (8 reported + 1 unflagged same-pattern site):**
- `react-doctor/no-ref-current-in-render` — **7 errors** (`Bugs`)
- `react-doctor/rerender-lazy-ref-init` — **1 warning** (`Performance`)
- Adjacent same-pattern cleanup: 4 render-phase `stateRef.current.* = ...` writes in `OrganizingSplash`

---

## 1. The Anti-Pattern

Three variations of reading or mutating `ref.current` during render currently exist in the codebase:

1. **"Latest value ref" assigned inline during render:**
   ```ts
   const specRef = useRef(itemsToSpec(context ?? []));
   specRef.current = itemsToSpec(context ?? []);
   ```
   - Also triggers `rerender-lazy-ref-init` when the initial argument computes a value (`itemsToSpec(...)`) on every render even though React discards it after mount.
   - Mutating `.current` during render is unsafe under React concurrent rendering / aborted renders and violates React's purity rules.

2. **Lazy one-shot ref initialization during render:**
   ```ts
   const lastSentSpecRef = useRef<string | null>(null);
   if (lastSentSpecRef.current === null) {
     lastSentSpecRef.current = specKey(parseActiveContext(initialMessages ?? []) ?? {});
   }
   ```
   - Runs a read-and-write of `.current` directly in the render body to avoid recomputing an initial baseline.

3. **Monotonic derived value stored in a ref during render:**
   ```ts
   const highWater = useRef(0);
   highWater.current = Math.max(highWater.current, next);
   return { stage, error, progress: highWater.current };
   ```
   - Uses a ref to clamp progress monotonically upward across renders, reading and writing `.current` during render.

---

## 2. The New Codebase Pattern

### Pattern 1A — Shared `useLatestRef<T>(value)` hook
For callbacks/effects/transports that must read the latest prop or derived value without re-subscribing or recreating closures:

```ts
import { useLayoutEffect, useRef } from "react";

/**
 * Keeps a ref synchronized with the latest value after commit so event
 * handlers, effects, and imperative transports can read fresh state without
 * mutating `ref.current` during render.
 */
export function useLatestRef<T>(value: T): { readonly current: T } {
  const ref = useRef(value);
  useLayoutEffect(() => {
    ref.current = value;
  });
  return ref;
}
```

- Uses `useLayoutEffect` (runs synchronously before browser paint and before `useEffect` subscribers fire, matching the existing pattern in `packages/react/state/src/live/use-live-read.ts` and `packages/react/features/src/fragments/components/add-fragment-modal.tsx`).
- Because `useLatestRef` takes the already-computed value (e.g. `useMemo(() => itemsToSpec(context ?? []), [context])` or the raw prop), `useRef` never runs an eager factory on every render.

### Pattern 1B — Lazy one-shot mutable baseline without render-time ref mutation
When a mutable baseline must be seeded once from `initialMessages` (and mutated later only inside event handlers / effects — never read to drive JSX):

- **Option 1 (effect-seeded or lazy getter):** Seed the ref lazily on first read inside the handler/effect (`getLastSentSpec()`), OR compute the initial seed once via `useState(() => ...)` and mirror/update via a ref initialized from that state:
  ```ts
  const [initialSpecKey] = useState(() =>
    specKey(parseActiveContext(initialMessages ?? []) ?? {}),
  );
  const lastSentSpecRef = useRef(initialSpecKey);
  ```
  - `useState(() => ...)` guarantees the parser runs **strictly once** on mount, with zero render-time `ref.current` read/write!
  - Subsequent mutations (`lastSentSpecRef.current = ctxKey`) happen exclusively inside `appendSpecChanges()` (called from submit handlers and `useEffect`).

### Pattern 1C — Monotonic UI value via state, not render-mutated ref
When a monotonically increasing value (`progress`) is **returned to render JSX**:

```ts
const [highWater, setHighWater] = useState(next);
const progress = Math.max(highWater, next);
useEffect(() => {
  if (next > highWater) {
    setHighWater(next);
  }
}, [next, highWater]);
```
- Pure during render (`Math.max` never mutates a ref).
- Immediately reflects upward jumps on the very same render (no 1-frame lag!), while latching the new peak in state so subsequent lower readings never regress.

---

## 3. File-by-File Inventory & Migration Plan

| File | Line(s) | Rule(s) | Planned Change |
|---|---|---|---|
| `packages/react/components/src/chat-panel.tsx` | 192, 195, 196, 204, 215, 217, 220 | `no-ref-current-in-render` (×6), `rerender-lazy-ref-init` (×1) | Replace `manageContextRef`, `specRef`, `manageWindowRef`, `timeWindowRef` inline writes with `useLatestRef(...)` (memoizing `itemsToSpec(context ?? [])` so it is not recomputed unnecessarily). Replace `lastSentSpecRef` and `lastSentWindowRef` render-time `if (ref.current === null)` blocks with `useState(() => ...)` + `useRef(initialKey)`. |
| `apps/desktop/src/features/onboarding/hooks/use-pipeline-progress.ts` | 20 | `no-ref-current-in-render` (×1) | Replace `highWater` ref mutation with Pattern 1C (`useState(next)` + `const progress = Math.max(highWater, next)` + `useEffect` latch). |
| `apps/desktop/src/features/onboarding/components/organizing-splash.tsx` | 801–804 | *(same anti-pattern; currently unflagged because nested property write)* | Move `stateRef.current.{speed,progress,onEnded,onSnapshotReady}` assignments into a `useLayoutEffect`, and switch `stateRef` initialization (`generateChips()`, `performance.now()`) to lazy init so `generateChips()` does not run on every render. |

### Invariants to Preserve
- **`ChatPanel` conversation remounting:** Callers key `ChatPanel` on `chatId`, so `useState(() => ...)` re-initializes cleanly whenever the active conversation changes.
- **`ChatPanel` `useEffect` ordering:** Because `useLatestRef` updates in `useLayoutEffect`, `manageContextRef.current`, `specRef.current`, `manageWindowRef.current`, and `timeWindowRef.current` are guaranteed up-to-date before `ChatPanel`'s `useEffect` hooks (`initialPrompt` and `timeWindow` sync) run.
- **`usePipelineProgress` no regression:** `Math.max(highWater, next)` guarantees progress is still monotonically non-decreasing with zero frame delay.

---

## 4. Open Decisions

1. **Where should `useLatestRef` live?**
   - **Option A (Recommended):** `packages/react/hooks/src/use-latest-ref.ts` (exported via `@kalaido/hooks/use-latest-ref`), since both `@kalaido/components` and `apps/desktop` need it.
   - **Option B:** `packages/react/primitives/src/hooks/use-latest-ref.ts` (domain-free React utility alongside `use-mobile.ts`).
   - **Option C:** No shared helper — write inline `useLayoutEffect` in each of the 2–3 files.
2. **Include `organizing-splash.tsx:801-804` in this pass?**
   - It exhibits the exact same render-phase ref mutation + eager `generateChips()` ref init, even though the linter only caught top-level `ref.current = ...`.

---

## 5. Verification

- Run `./kalaido.sh test:ts && ./kalaido.sh check:ts`.
- Re-run `pnpm dlx react-doctor@latest . --verbose --yes` and confirm:
  - `no-ref-current-in-render`: `7 → 0`
  - `rerender-lazy-ref-init`: `1 → 0`
