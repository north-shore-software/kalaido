# React Doctor — Category 5: Mechanical Correctness, Performance & Module Hygiene

**Baseline scan:** `react-doctor` full-repo run (`42 / 100`, 138 issues total)  
**Diagnostics covered (18 low-risk, high-signal non-shadcn warnings):**
- `react-doctor/no-loading-flag-reset-outside-finally` — **2 warnings** (`Bugs`)
- `react-doctor/js-index-maps` — **3 warnings** (`Performance`)
- `react-doctor/js-set-map-lookups` — **2 warnings** (`Performance`)
- `react-doctor/js-hoist-intl` — **1 warning** (`Performance`)
- `react-doctor/async-await-in-loop` — **1 warning** (`Performance`)
- `react-doctor/rerender-memo-with-default-value` — **1 warning** (`Performance`)
- `react-doctor/no-array-index-as-key` — **2 warnings** (`Bugs`; excludes 3 in `shadcn/`)
- `react-doctor/only-export-components` — **6 non-route-page warnings** (`Maintainability`; excludes 6 in `shadcn/` and 27 desktop `pages/*.tsx` route modules handled in Category 6)

---

## 1. The Anti-Patterns

A collection of small, mechanical, self-contained patterns that each have a single canonical fix:

1. **Async loading flags reset after `await` without `try / finally` (×2):** If the awaited call throws unexpectedly, `loading` / `busy` stays stuck `true` forever.
2. **Repeated linear scans (`.find()` / `.includes()`) inside loops (×5):** O(n × m) lookups where building a `Map` or `Set` once makes the loop O(n + m).
3. **Per-call `Intl.DateTimeFormat` construction & inline empty array default props (×2):** Recreating formatters on every format call and creating a fresh `[]` reference on every render of `ProjectionCanvas` (breaking downstream `useMemo`/memoization).
4. **Sequential `await` over independent batch chunks (×1):** `listConversationsWithPreviews` fetches 30-ID preview chunks serially instead of concurrently.
5. **Array index embedded in React `key` (×2):** Composite keys include `-${i}` / `-${idx}` even when a deterministic key (or occurrence count per composite key) can be derived from the data.
6. **Non-component helper/constant exports co-located in `.tsx` component files (×6):** Breaks Vite Fast Refresh state preservation when editing those components.

---

## 2. The New Codebase Patterns

### Pattern 5A — `try / finally` (or `useExternalWrite`) for Async Busy Flags
Never place `setLoading(false)` / `setBusy(false)` sequentially after an `await`:
```ts
setBusy(true);
setError(null);
try {
  const validated = await validateWorkspaceLlmConfig(config);
  ...
} finally {
  setBusy(false);
}
```
(Or, when the call is a real mutation/write, use `useExternalWrite` from `@kalaido/state/live` which manages `isPending` automatically.)

### Pattern 5B — Index Before Looping & Hoist Static Allocations
- Build `new Map(items.map((x) => [x.id, x]))` or `new Set(ids)` before iterating.
- Hoist module-level `Intl.DateTimeFormat` instances and default empty collection constants (`const EMPTY_EDITS: SnapshotEdit[] = [];`).
- Parallelize independent read chunks with `Promise.all` (bounded if chunk count can grow large).

### Pattern 5C — Stable Composite Keys Without Raw Array Index
When rendering lists whose backend items lack a unique `id` (e.g. map relationships or running queue tasks):
- Derive keys from stable domain fields (`${rel.from}:${rel.kind}:${rel.to}` or `${t.role}:${t.model}:${t.started}`), appending an occurrence counter only when duplicate tuples exist (computed via a `Map<string, number>` pass before JSX) rather than raw array index `i`.

### Pattern 5D — Pure `.ts` Sibling Modules for Non-Component Helpers
Keep `.tsx` component files exporting React components only (preserving Vite Fast Refresh). Move pure helper functions and constant maps (`contentColour`, `truncatePath`, `phaseLabel`/`phaseDotClass`, `queueHeldLabels`, `sanitizeExportName`, `routeElements`) into sibling `.ts` modules or existing utils barrels, re-exporting from package index barrels where needed.

---

## 3. File-by-File Inventory & Migration Plan

### 3.1 Async Loading Flag Safety (×2)
| File | Line | Planned Change |
|---|---|---|
| `packages/react/features/src/auth/cloud-workspace-picker-screen.tsx` | 40 | Wrap `onSyncWorkspaces()` in `try { ... } finally { setLoading(false); }` (and apply the same `try / finally` to `handleOpen`'s `setOpeningId(null)` on lines 52–56 for consistency). |
| `apps/desktop/src/features/onboarding/components/restore-provider-dialog.tsx` | 63 | Wrap `validateWorkspaceLlmConfig(config)` in `try { ... } finally { setBusy(false); }`. |

### 3.2 Performance & Allocation Hygiene (×8)
| File | Line(s) | Rule | Planned Change |
|---|---|---|---|
| `packages/react/features/src/projections/sources.ts` | 15, 19, 27 | `js-index-maps` (×3) | Build `colourById`, `projectionById`, and `reflectionById` `Map`s once at the top of `resolveSources` (only for non-empty ID lists). |
| `packages/react/components/src/chat-messages.tsx` | 1002 | `js-set-map-lookups` (×1) | Convert `types` in `settledBy` to a `Set` (or precompute the latest settled index per part type in a single reverse pass over `messages` — turning O(M² × P) into O(M × P)!). |
| `packages/react/features/src/rotation/next-target.ts` | 50 | `js-set-map-lookups` (×1) | Build `const skipSet = new Set(skip);` before `.find(...)` and check `!skipSet.has(s.id)`. |
| `packages/lib/client/src/lib/datetime.ts` | 34 | `js-hoist-intl` (×1) | Hoist `const shortDateTimeFormatter = new Intl.DateTimeFormat(undefined, { ... })` to module scope (note: check if tests ever mock locale dynamically; none currently do). |
| `packages/react/features/src/projections/components/projection-canvas.tsx` | 44 | `rerender-memo-with-default-value` (×1) | Hoist `const EMPTY_EDITS: SnapshotEdit[] = [];` at module scope and use `edits = EMPTY_EDITS`. |
| `packages/lib/client/src/kalaidoscope/chat.ts` | 449 | `async-await-in-loop` (×1) | Slice `records` into `CHUNK = 30` batches and fetch them concurrently via `Promise.all(chunks.map(...))`, then merge results into `previews` in chunk order so preview selection semantics remain identical. |

### 3.3 Stable List Keys (×2)
| File | Line | Planned Change |
|---|---|---|
| `packages/react/features/src/map/map-screen.tsx` | 178 | Key each relationship row by `${rel.from}\0${rel.kind}\0${rel.to}` (with a per-tuple occurrence suffix if duplicates exist) instead of raw index `i`; remove `biome-ignore`. |
| `apps/desktop/src/features/status/pages/Status.tsx` | 338 | Key each running task by `${t.role}\0${t.model}\0${t.started}` (with occurrence suffix if duplicates exist) instead of raw index `idx`; remove `biome-ignore`. |

### 3.4 Non-Route-Page `only-export-components` Cleanup (×6 files, 7 exports)
| File | Line(s) | Export(s) | Planned Change |
|---|---|---|---|
| `packages/react/primitives/src/kalaido/colour.tsx` | 16 | `contentColour` | Move `contentColour` + `CONTENT` to `packages/react/primitives/src/kalaido/colour-palette.ts` (re-export from `kalaido/index.ts` and import into `colour.tsx`; verify external import paths!). |
| `packages/react/primitives/src/layout/location-label.tsx` | 3 | `truncatePath` | Move `truncatePath` to `packages/react/primitives/src/lib/path-utils.ts` (or check all callers — if only used in `location-label.tsx`, unexport it!). |
| `apps/desktop/src/components/layout/sidecar-status-dot.tsx` | 4, 22 | `phaseLabel`, `phaseDotClass` | Move to `apps/desktop/src/components/layout/sidecar-status.ts` and update callers. |
| `apps/desktop/src/components/layout/utility-bar.tsx` | 59 | `queueHeldLabels` | Move to `apps/desktop/src/components/layout/queue-labels.ts` (or unexport if unused externally — check callers first). |
| `apps/desktop/src/features/settings/components/workspace-backups-panel.tsx` | 200 | `sanitizeExportName` | Move to `apps/desktop/src/features/settings/lib/backup-utils.ts` (and update its unit test import if any). |
| `apps/desktop/src/routes/app-router.tsx` | 32 | `routeElements` | Move `routeElements` helper (or make `RouteElements` a proper component / move to `route-kit.tsx` / unexport if only used in tests — check callers first). |

---

## 4. Open Decisions

1. **Module-level `Intl.DateTimeFormat` in `datetime.ts`:**
   - **Option A (Recommended):** Hoist to module scope (standard pattern, zero runtime cost per call).
   - **Option B:** Lazy-cache if runtime locale changes without reload are ever expected.
2. **External import paths for `contentColour` / `truncatePath`:**
   - Before moving `contentColour` or `truncatePath` out of `@kalaido/primitives/kalaido/colour` or `@kalaido/primitives/layout/location-label`, check all workspace callers; update all callers in lockstep (internal workspace package, no external consumers).
3. **`chat.ts:449` concurrency bound:**
   - **Option A (Recommended):** Plain `Promise.all` across chunks (a workspace typically has 1–5 chunks of 30 conversations).
   - **Option B:** Cap concurrency at e.g. 4 in-flight requests if workspaces can accumulate thousands of conversations.

---

## 5. Verification

- Run `./kalaido.sh test:ts && ./kalaido.sh check:ts`.
- Re-run `pnpm dlx react-doctor@latest . --verbose --yes` and confirm:
  - `no-loading-flag-reset-outside-finally`: `2 → 0`
  - `js-index-maps`: `3 → 0`
  - `js-set-map-lookups`: `2 → 0`
  - `js-hoist-intl`: `1 → 0`
  - `async-await-in-loop`: `1 → 0`
  - `rerender-memo-with-default-value`: `1 → 0`
  - `no-array-index-as-key`: `5 → 3` (only `shadcn/` remaining)
  - Non-shadcn, non-route-page `only-export-components`: `7 → 0`
