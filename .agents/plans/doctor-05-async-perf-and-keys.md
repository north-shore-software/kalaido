# React Doctor — Category 5: Mechanical Correctness, Performance & Module Hygiene

**Baseline scan:** `react-doctor` full-repo run (`42 / 100`, 138 issues total)  
**Diagnostics covered (19 low-risk, high-signal non-shadcn warnings → `138 → 119` issues):**
- `react-doctor/no-loading-flag-reset-outside-finally` — **2 warnings** (`Bugs`)
- `react-doctor/js-index-maps` — **3 warnings** (`Performance`)
- `react-doctor/js-set-map-lookups` — **2 warnings** (`Performance`)
- `react-doctor/js-hoist-intl` — **1 warning** (`Performance`)
- `react-doctor/async-await-in-loop` — **1 warning** (`Performance`)
- `react-doctor/rerender-memo-with-default-value` — **1 warning** (`Performance`)
- `react-doctor/no-array-index-as-key` — **2 warnings** (`Bugs`; excludes 3 in `shadcn/`)
- `react-doctor/only-export-components` — **7 non-route-page warnings across 6 files** (`Maintainability`; excludes 6 in `shadcn/` and 26 warnings across 25 desktop `pages/*.tsx` route modules handled in Category 6)

---

## 1. The Anti-Patterns

A collection of small, mechanical, self-contained patterns across 14 files:

1. **Async loading flags reset after `await` without `try / finally` (×2 warnings + 1 adjacent handler in the same file):** If the awaited call rejects unexpectedly (e.g. disposed scope dispatch in `syncCloudWorkspacesForScope` or synchronous Tauri `invoke` failure), `loading`, `openingId`, or `busy` stays stuck forever.
2. **Repeated linear scans (`.find()` / `.includes()`) inside loops (×5):** O(n × m) lookups where building a `Map` or `Set` (or precomputing indices once) makes the pass linear.
3. **Per-call `Intl.DateTimeFormat` construction & inline empty array default props (×2):** Recreating formatters on every `formatShortDateTime` call and creating a fresh `[]` reference on every render of `ProjectionCanvas` (invalidating `approvedEditsByBlock` and `editsById` `useMemo` hooks whenever `edits` is omitted).
4. **Sequential `await` over independent batch chunks (×1):** `listConversations` (`packages/lib/client/src/kalaidoscope/chat.ts:449`) fetches 30-ID `chat_message` preview chunks serially instead of concurrently.
5. **Array index embedded in React `key` (×2):** Composite keys in `MapScreen` and `StatusPage` append `-${i}` / `-${idx}` with `biome-ignore lint/suspicious/noArrayIndexKey` where domain tuples (plus per-tuple occurrence disambiguation when duplicates are possible) provide stable keys.
6. **Non-component helper/constant exports co-located in `.tsx` component files (×7 warnings across 6 files):** Breaks Vite Fast Refresh state preservation when editing those components; 5 of the 7 exported symbols have zero external callers in the repository.

---

## 2. The New Codebase Patterns

### Pattern 5A — `try / finally` Around Local Async Busy State
Never place `setLoading(false)`, `setOpeningId(null)`, or `setBusy(false)` sequentially after an `await`:
```ts
setBusy(true);
setError(null);
let validated: Result<ValidateResult, Error>;
try {
  validated = await validateWorkspaceLlmConfig(config);
} finally {
  setBusy(false);
}
```
*(See **D5.1** for whether unexpected rejections should also be caught into the component's error banner or left to propagate after `finally` resets the busy state.)*

### Pattern 5B — Index Before Looping, Hoist Static Allocations & Preserve `requestKey: null`
- Build `new Map(items.map((x) => [x.id, x]))` or `new Set(ids)` before iterating (guarded on non-empty ID lists).
- Hoist module-level `Intl.DateTimeFormat` instances (`react-doctor/js-hoist-intl` requires top-level hoisting, not function-scoped lazy getters — see **D5.3**) and default empty array constants (`const EMPTY_EDITS: SnapshotEdit[] = [];`).
- Parallelize independent PocketBase read chunks in `listConversations` while **strictly preserving `requestKey: null`** on `.collection("chat_message").getList(...)` — PocketBase's JS SDK has `autoCancellation` enabled (`true`) on all Kalaido clients and aborts concurrent requests to the same collection path unless `requestKey: null` is passed (see **D5.2**).

### Pattern 5C — Stable Composite Keys Without Raw Array Index
When rendering lists whose backend structs have no `id` field (`mapdoc.Relationship` and `queue.TaskInfo`):
- Derive keys from all distinguishing domain fields (`from`, `kind`, `to` for map relationships; `role`, `priority`, `model`, `started` for running LLM tasks), disambiguating duplicate tuples via a per-tuple occurrence counter (`Map<string, number>`) rather than raw array index `i` / `idx`, and remove `biome-ignore lint/suspicious/noArrayIndexKey` (see **D5.5**).

### Pattern 5D — Component-Only Exports in `.tsx` Modules
Keep non-page `.tsx` files exporting React components (and TypeScript types) only:
- Move symbols with real cross-file callers (`phaseLabel`, `queueHeldLabels`) into pure `.ts` sibling modules (`sidecar-status.ts`, `queue-labels.ts`).
- Either unexport file-local helpers that have zero external callers (`contentColour`, `truncatePath`, `phaseDotClass`, `sanitizeExportName`, `routeElements`) or extract pure `.ts` helpers where keeping public/testable exports is desired (see **D5.6**).

---

## 3. File-by-File Inventory & Migration Plan

### 3.1 Async Loading Flag Safety (×2 warnings across 2 files)
| File | Line(s) | Rule | Verified Context & Planned Change |
|---|---|---|---|
| `packages/react/features/src/auth/cloud-workspace-picker-screen.tsx` | 35–41 (`load`), 47–57 (`handleOpen`) | `no-loading-flag-reset-outside-finally` (×1 at line 40) | Mounted in `apps/mobile/src/app.tsx:165` and `apps/web/src/app.tsx:165`. Wrap `onSyncWorkspaces()` in `try / finally { setLoading(false); }` and `onOpenWorkspace(id)` in `try / finally { setOpeningId(null); }` (see **D5.1**). *(Note: `apps/desktop/src/features/onboarding/pages/CloudWorkspaces.tsx:62-68` has an unflagged `setOpeningId(null)` after `await switchLocalKalaidoscope(...)` outside Category 5's target list.)* |
| `apps/desktop/src/features/onboarding/components/restore-provider-dialog.tsx` | 59–64 (`handleConfirm`) | `no-loading-flag-reset-outside-finally` (×1 at line 63) | Mounted in `apps/desktop/src/features/onboarding/pages/OnboardingLanding.tsx:188`. Wrap `validateWorkspaceLlmConfig(config)` in `try / finally { setBusy(false); }` (see **D5.1**). |

### 3.2 Performance & Allocation Hygiene (×8 warnings across 6 files)
| File | Line(s) | Rule | Verified Context & Planned Change |
|---|---|---|---|
| `packages/react/features/src/projections/sources.ts` | 15, 19, 27 | `js-index-maps` (×3) | Called in `dashboard-screen.tsx:156` and `projections-screen.tsx:149`; covered by `sources.test.ts` (3 tests). Build `colourById`, `projectionById`, and `reflectionById` `Map`s once per non-empty spec ID list before iterating. |
| `packages/react/components/src/chat-messages.tsx` | 997–1012 | `js-set-map-lookups` (×1 at line 1002) | Rendered by `chat-panel.tsx:448` (re-exported in `@kalaido/components`). Currently runs `settledBy` twice on **every** non-system message even when no confirmation card is present. Fix via `Set` + card guard or `useMemo` precomputation (see **D5.4**). |
| `packages/react/features/src/rotation/next-target.ts` | 47–52 | `js-set-map-lookups` (×1 at line 50) | Called in `projection-review-screen.tsx:344, 509`; covered by `next-target.test.ts` (9 tests). Build `const skipSet = new Set(skip);` before `.find(...)` and check `!skipSet.has(s.id)`. |
| `packages/lib/client/src/lib/datetime.ts` | 33–40 (and 72–77) | `js-hoist-intl` (×1 at line 34) | `formatShortDateTime` has 8 call sites across `@kalaido/components` and `@kalaido/features`; `formatWindowRange` has 3 call sites. Hoist `Intl.DateTimeFormat` to module scope (see **D5.3**). |
| `packages/react/features/src/projections/components/projection-canvas.tsx` | 44 | `rerender-memo-with-default-value` (×1) | Rendered by `projection-canvas-pane.tsx:36` (`ProjectionDraftEditor` omits `edits`, hitting the default `[]` on every render and invalidating `approvedEditsByBlock` and `editsById` `useMemo`s). Hoist `const EMPTY_EDITS: SnapshotEdit[] = [];` at module scope and use `edits = EMPTY_EDITS`. |
| `packages/lib/client/src/kalaidoscope/chat.ts` | 439–465 (`listConversations`) | `async-await-in-loop` (×1 at line 449) | Function is `listConversations` (line 424; single caller `use-conversations.ts:24`). Slice `records` into `CHUNK = 30` batches, fetch concurrently **keeping `requestKey: null`**, and merge per-chunk results in deterministic chunk order (see **D5.2**). |

### 3.3 Stable List Keys (×2 warnings across 2 files)
| File | Line | Rule | Verified Backend & Frontend Context |
|---|---|---|---|
| `packages/react/features/src/map/map-screen.tsx` | 178 | `no-array-index-as-key` (×1) | Go `mapdoc.Relationship` (`kalaidoscope/internal/mapdoc/doc.go:25-29`) has `{ from, to, kind }` and no `id`; `finishDocument` (`consolidate.go:208-213`) deduplicates by `from.ID + "\|" + to.ID + "\|" + r.Kind`. Including `rel.kind` (with or without occurrence suffix) eliminates raw index `i` and removes `biome-ignore` (see **D5.5**). |
| `apps/desktop/src/features/status/pages/Status.tsx` | 338 | `no-array-index-as-key` (×1) | Go `queue.TaskInfo` (`kalaidoscope/llm/queue/queue.go:132-143`) has `{ role, priority, model, started, tokens?, tokens_per_second? }` and no `id`. In `dispatchLocked()` (`queue.go:333, 378`), `now := time.Now()` is captured once before the admission loop, so two tasks of the same `(role, priority, model)` admitted in one pass share the **exact same `started` timestamp** — requiring per-tuple occurrence disambiguation (see **D5.5**). |

### 3.4 Non-Route-Page `only-export-components` Cleanup (×7 warnings across 6 files)
| File | Line(s) | Export(s) | Verified External Callers (Repo-Wide, Incl. Tests) |
|---|---|---|---|
| `packages/react/primitives/src/kalaido/colour.tsx` | 16 | `contentColour` | **0 external callers** (re-exported in `packages/react/primitives/src/kalaido/index.ts:4`, imported nowhere else; all 6 external importers of `@kalaido/primitives/kalaido/colour` import `ColourSwatch` only). |
| `packages/react/primitives/src/layout/location-label.tsx` | 3 | `truncatePath` | **0 external callers** (not re-exported in any barrel; `kalaidoscope-row.tsx:5` imports `LocationLabel` only). |
| `apps/desktop/src/components/layout/sidecar-status-dot.tsx` | 4, 22 | `phaseLabel`, `phaseDotClass` | `phaseLabel`: **1 external caller** (`apps/desktop/src/components/layout/utility-bar.tsx:22`, used at line 295; unused inside `sidecar-status-dot.tsx`). `phaseDotClass`: **0 external callers** (used only at `sidecar-status-dot.tsx:46`). |
| `apps/desktop/src/components/layout/utility-bar.tsx` | 59 | `queueHeldLabels` | **1 external caller** (`apps/desktop/src/features/status/pages/Status.tsx:37`, used at line 92; also used internally at `utility-bar.tsx:272`). |
| `apps/desktop/src/features/settings/components/workspace-backups-panel.tsx` | 200 | `sanitizeExportName` | **0 external callers** and **0 test callers** (used only at `workspace-backups-panel.tsx:288`). |
| `apps/desktop/src/routes/app-router.tsx` | 32 | `routeElements` | **0 external callers** and **0 test callers** (used only at `app-router.tsx:53`). |

---

## 4. Decision Points

| ID | Decision | Feasible Options | Cross-Plan Coupling | Selected |
|---|---|---|---|---|
| **D5.1** | Async busy-flag & unexpected rejection handling (`cloud-workspace-picker-screen.tsx` & `restore-provider-dialog.tsx`) | Option A (`try / catch / finally` into UI error state), Option B (`try / finally` only) | None | _Pending_ |
| **D5.2** | Concurrent preview chunk fetching in `listConversations` (`chat.ts:449`) | Option A (Unbounded `Promise.all` with `requestKey: null`), Option B (Bounded worker pool `CONCURRENCY = 4` with `requestKey: null`) | None | _Pending_ |
| **D5.3** | Module-scope `Intl.DateTimeFormat` hoisting scope (`datetime.ts`) | Option A (Hoist `shortDateTimeFormatter` only), Option B (Hoist both `shortDateTimeFormatter` and `formatWindowRange`'s 2 static formatters) | None | _Pending_ |
| **D5.4** | `ChatMessages` settlement lookup strategy (`chat-messages.tsx:1002`) | Option A (`Set` inside `settledBy` + card-presence guard), Option B (`useMemo` single reverse pass `lastSettledIndices`) | `doctor-06` Tier 2 (`chat-messages.tsx:510` `EditNoticeCard`) | _Pending_ |
| **D5.5** | Non-index keys in `MapScreen` & `StatusPage` (`map-screen.tsx:178` & `Status.tsx:338`) | Option A (Occurrence-disambiguated composite keys in both files), Option B (Natural `from\|kind\|to` key in `MapScreen` + occurrence-disambiguated key in `StatusPage`) | `doctor-06` Part A & Tier 1 (`Status.tsx`), Tier 2 (`map-screen.tsx`), plus **D5.6** (`Status.tsx` import) | _Pending_ |
| **D5.6** | Resolving the 6 non-page `only-export-components` modules (7 warnings) | Option A (Extract `.ts` modules for the 2 externally used symbols; unexport the 5 zero-caller symbols), Option B (Extract `.ts` sibling/lib modules for all pure helpers; unexport or extract `routeElements`) | `doctor-06` Part A (`only-export-components` rule config for `pages/*.tsx`) & Tier 1 (`Status.tsx`) | _Pending_ |

---

### D5.1 — Async Busy-Flag & Unexpected Rejection Handling (`cloud-workspace-picker-screen.tsx` & `restore-provider-dialog.tsx`)

**Decision:** _Pending_

**Files & Callers Verified:**
- `packages/react/features/src/auth/cloud-workspace-picker-screen.tsx:35-57`:
  - `load()` (lines 35–41) sets `loading = true`, awaits `onSyncWorkspaces()`, and resets `setLoading(false)` at line 40 (flagged). Invoked via `void load()` in `useEffect` (line 44) and Retry `onClick` (line 97).
  - `handleOpen(id)` (lines 47–57) sets `openingId = id`, awaits `onOpenWorkspace(id)`, and resets `setOpeningId(null)` at line 56 (same stuck-UI failure mode because line 122 sets `disabled={openingId !== null}` on all workspace buttons).
  - Callers: `apps/mobile/src/app.tsx:165` and `apps/web/src/app.tsx:165` pass `syncCloudWorkspaces` and `openCloudWorkspace(id, { surfaceError: false })` (`packages/react/hooks/src/cloud-root-scope.ts:199-274`). In `syncCloudWorkspacesForScope`, `scope.dispatch(...)` (line 209) and `invalidateLiveTags(...)` (line 213) run outside `try/catch`, so a disposed scope or storage error can reject the promise rather than returning `err(...)`.
- `apps/desktop/src/features/onboarding/components/restore-provider-dialog.tsx:46-75`:
  - `handleConfirm()` sets `busy = true`, awaits `validateWorkspaceLlmConfig(config)` (`apps/desktop/src/api/app/llm-validate.ts:76-97`), and resets `setBusy(false)` at line 63 (flagged). Invoked via `void handleConfirm()` (line 115).
  - Caller: `apps/desktop/src/features/onboarding/pages/OnboardingLanding.tsx:188`. In `llm-validate.ts:43-49`, `invoke(...)` is evaluated synchronously as the argument to `tauriResult(invoke(...))`, so a synchronous Tauri bridge error rejects `Promise.all` directly.

**Cross-Plan Coupling:** None.

#### Option A — `try / catch / finally` Surfacing Unexpected Rejections in Existing Error State
- **How it works:** Wrap `onSyncWorkspaces()` (`load`), `onOpenWorkspace(id)` (`handleOpen`), and `validateWorkspaceLlmConfig(config)` (`handleConfirm`) in `try / catch / finally`. Reset `setLoading(false)`, `setOpeningId(null)`, and `setBusy(false)` in `finally`; in `catch (e)`, convert unexpected exceptions with `toError(e).message` (`@kalaido/client/lib/errors`) into `setListError`, `setOpenError`, and `setError` respectively (keeping `onConfirm(config)` outside the `try` block in `RestoreProviderDialog` so `validateWorkspaceLlmConfig` errors and `onConfirm` callbacks stay decoupled).
- **Verification:** Prototyped in isolated workspace; `pnpm -r typecheck`, `biome lint --error-on-warnings`, `vitest run` (21/21 files, 223/223 tests), and `react-doctor` all passed (`no-loading-flag-reset-outside-finally: 2 → 0`).
- **Pros:**
  - Resets busy flags on every exit path and prevents silent failures (all three call sites invoke `void load()`, `void handleOpen(id)`, `void handleConfirm()`, so an uncaught rejection otherwise shows no banner in the UI).
  - Uses existing `@kalaido/client/lib/errors` `toError` already used across `@kalaido/features` and `apps/desktop`.
- **Cons:**
  - Slightly larger diff (+12 lines across 2 files) than bare `try / finally`, and swallows unexpected programming exceptions into user-visible error banners instead of `window.onunhandledrejection`.

#### Option B — Minimal `try / finally` Without `catch`
- **How it works:** Wrap the awaited calls in `try { ... } finally { setLoading(false); }`, `try { ... } finally { setOpeningId(null); }`, and `try { ... } finally { setBusy(false); }` with no `catch` clause, relying on `neverthrow` `Result` for expected errors.
- **Verification:** Prototyped in isolated workspace; `pnpm -r typecheck`, `biome lint --error-on-warnings`, `vitest run` (223/223), and `react-doctor` all passed (`no-loading-flag-reset-outside-finally: 2 → 0`).
- **Pros:**
  - Smallest possible diff; preserves existing `Result`-only banner semantics and lets truly unexpected runtime bugs reach global `unhandledrejection` logging.
- **Cons:**
  - Because callers use `void load()`, `void handleOpen(id)`, and `void handleConfirm()`, an unexpected rejection leaves the UI unblocked with no inline error message.

**Ruled-Out Options:**
- **Replacing local state with `useExternalWrite` (`@kalaido/state/live`):**
  1. `useExternalWrite` initializes `status = "idle"` (`isPending = false`) on mount, whereas `CloudWorkspacePickerScreen` initializes `loading = true` so initial render shows `<Skeleton />` rows before `useEffect` fires — switching `load` to `useExternalWrite` would flash `"No cloud workspaces yet"` on frame 1 when `workspaces` is empty.
  2. `handleOpen(id)` needs `openingId: string | null` to render `"Opening…"` on the specific clicked workspace button (`line 125`), which boolean `isPending` cannot express on its own.
  3. `validateWorkspaceLlmConfig` is a read-only pre-flight credential check returning `Result<ValidateResult, Error>`, violating `useExternalWrite`'s `ValidWriteReturn<TOut>` (`void | { id } | { ids }`) contract unless `{ ok: false }` business verdicts are artificially coerced into `Error`s.

---

### D5.2 — Concurrent Preview Chunk Fetching in `listConversations` (`chat.ts:449`)

**Decision:** _Pending_

**Files & Callers Verified:**
- `packages/lib/client/src/kalaidoscope/chat.ts:424-476`:
  - Actual exported function name is `listConversations(client: TypedPocketBase): Promise<Conversation[]>` (not `listConversationsWithPreviews`).
  - Single caller in repo: `packages/react/features/src/explore/hooks/use-conversations.ts:24` (`kalaidoscopeEndpointSource`, watching `chat_conversation`). Zero existing unit tests for `listConversations`.
- **PocketBase SDK auto-cancellation (`requestKey: null`) verified:**
  - All three client factories (`createCloudClient` and `createLocalNetClient` in `packages/lib/client/src/kalaidoscope/client.ts:13, 33`, and `createSidecarClient` in `apps/desktop/src/api/app/sidecar-client.ts:71`) keep PocketBase's default `autoCancellation = true`.
  - PocketBase's default `requestKey` is `HTTP_METHOD + path` (`"GET /api/collections/chat_message/records"`, ignoring `filter` query params). Empirically verified against `packages/lib/client/node_modules/pocketbase/dist/pocketbase.es.mjs`: 3 concurrent `.collection("chat_message").getList(...)` calls **without** `requestKey: null` settle as `['rejected', 'rejected', 'fulfilled']` (aborting earlier chunks with `isAbort: true`), whereas **with** `requestKey: null` (already present at `chat.ts:454`) all 3 settle as `['fulfilled', 'fulfilled', 'fulfilled']`.
- **Preview ordering & SQLite read concurrency:**
  - Each chunk queries 30 distinct `chat_conversation.id` primary keys (`records` from `chat_conversation.getFullList`), so `chat_conversation_id` sets across chunks are disjoint; within each chunk `sort: "created"` orders messages oldest-first so the first non-empty `previewText(m.content)` wins. Merging per-chunk results in deterministic chunk index order preserves 100% identical preview selection even under mocked duplicate IDs.
  - PocketBase runs SQLite in WAL mode with a concurrent reader pool (`ConcurrentDB`), so parallel `SELECT`s on the local sidecar do not contend with write locks.

**Cross-Plan Coupling:** None.

#### Option A — Unbounded `Promise.all` Across 30-ID Chunks (Preserving `requestKey: null`)
- **How it works:** Slice `records` into `CHUNK = 30` subarrays, run `await Promise.all(chunks.map(async (chunk) => ...))` with `requestKey: null` (catching per-chunk errors with `console.warn` and returning `[]`), then iterate `chunkResults` in order to populate `previews`.
- **Verification:** Prototyped in isolated workspace; `pnpm -r typecheck`, `biome lint --error-on-warnings`, `vitest run` (223/223), PocketBase concurrency test, and `react-doctor` all passed (`async-await-in-loop: 1 → 0`).
- **Pros:**
  - Minimal, idiomatic ~15-line change with zero worker-pool ceremony.
  - Typical workspaces have 1–5 chunks (30–150 conversations); browser HTTP/1.1 connection pooling naturally caps per-origin sockets at 6 for local sidecar.
- **Cons:**
  - If a cloud workspace accumulates thousands of conversations (e.g. 3,000 conversations = 100 chunks), queues 100 simultaneous HTTP/2 requests against the cloud gateway at once.

#### Option B — Bounded Concurrency Worker Pool (`CONCURRENCY = 4`, Preserving `requestKey: null`)
- **How it works:** Slice `records` into `CHUNK = 30` subarrays and run `Math.min(CONCURRENCY, chunks.length)` async workers via `Promise.all(Array.from({ length: ... }, () => runWorker()))`, storing each chunk's `[convId, text][]` pairs at `chunkPreviews[chunkIdx]` (with `requestKey: null`) and merging into `previews` in chunk order afterwards.
- **Verification:** Prototyped in isolated workspace (using `async function runWorker() { while (cursor < chunks.length) { ... await client.collection("chat_message").getList(..., { requestKey: null }); } }`); verified empirically that `react-doctor/async-await-in-loop` **clears (`1 → 0`)** and `tsc`, `biome lint`, and `vitest` all pass.
- **Pros:**
  - Caps simultaneous requests at 4 regardless of conversation history size while still giving up to 4× speedup over serial fetching.
  - Deterministic merge by `chunkIdx` preserves exact ordering independent of chunk completion order.
- **Cons:**
  - ~17 lines more code than plain `Promise.all` for a scale (hundreds+ of conversations) most workspaces rarely hit.

**Ruled-Out Options:**
- **Any concurrent `getList` call without `requestKey: null`:** Empirically proven to self-abort `N - 1` of `N` concurrent chunks via PocketBase's endpoint-level auto-cancellation, silently falling back to `"New conversation"` for almost every conversation because `catch (e)` logs a warning and continues.

---

### D5.3 — Module-Scope `Intl.DateTimeFormat` Hoisting Scope (`datetime.ts`)

**Decision:** _Pending_

**Files & Callers Verified:**
- `packages/lib/client/src/lib/datetime.ts`:
  - `formatShortDateTime` (lines 33–40, flagged by `js-hoist-intl` at line 34): 8 call sites (`fragment-drawer.tsx:150`, `conversation-list.tsx:75`, `stream-screen.tsx:52`, `projection-row.tsx:120`, `projection-side-rail.tsx:138`, `projection-detail-screen.tsx:294`, `projection-review-screen.tsx:570`, `projections-screen.tsx:202`).
  - `formatWindowRange` (lines 58–79, unflagged at line 73 only because `...(d.getFullYear() !== thisYear ? { year: "numeric" } : {})` spreads conditionally): 3 call sites (`chat-messages.tsx:421, 733`, `reflection-series-panel.tsx:30`, `window-select.tsx:57, 62`), constructing **2** `Intl.DateTimeFormat` instances per call across only two possible option shapes (same-year vs other-year).
  - Zero runtime locale settings exist in `@kalaido/platform` (`PersistentAppSetting` has no locale key), and zero tests mock `Intl.DateTimeFormat` or change runtime locale.

**Cross-Plan Coupling:** None.

#### Option A — Hoist Only `shortDateTimeFormatter` at Module Scope (Minimal Diff)
- **How it works:** Hoist `const shortDateTimeFormatter = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });` at module top level in `packages/lib/client/src/lib/datetime.ts` and call `shortDateTimeFormatter.format(new Date(date))` inside `formatShortDateTime`, leaving `formatWindowRange` untouched.
- **Verification:** Prototyped in isolated workspace; `pnpm -r typecheck`, `biome lint --error-on-warnings`, `vitest run` (223/223), and `react-doctor` all passed (`js-hoist-intl: 1 → 0`).
- **Pros:**
  - Strictly minimal 2-line change addressing the exact flagged diagnostic (`datetime.ts:34`).
  - Zero per-call `Intl.DateTimeFormat` instantiation across all list/card/stream date renders.
- **Cons:**
  - Leaves `formatWindowRange` (`datetime.ts:73`) allocating two `Intl.DateTimeFormat` instances per call in chat transcripts and reflection window selectors.

#### Option B — Hoist Module-Scope Formatters for Both `formatShortDateTime` and `formatWindowRange`
- **How it works:** Hoist `shortDateTimeFormatter` plus `windowMonthDayFormatter` (`{ month: "short", day: "numeric" }`) and `windowMonthDayYearFormatter` (`{ month: "short", day: "numeric", year: "numeric" }`) at module scope in `packages/lib/client/src/lib/datetime.ts`, selecting between the two in `formatWindowRange` via `(d.getFullYear() !== thisYear ? windowMonthDayYearFormatter : windowMonthDayFormatter).format(d)`.
- **Verification:** `tsc`, `biome lint`, and `react-doctor` (`js-hoist-intl: 1 → 0`) all pass with identical formatted output for same-year and cross-year windows.
- **Pros:**
  - Eliminates all per-call `new Intl.DateTimeFormat` allocations in `datetime.ts` cleanly in one pass (+8 lines).
- **Cons:**
  - Touches `formatWindowRange` beyond the single line flagged by `react-doctor`.

**Ruled-Out Options:**
- **Lazy / locale-aware cached getter function (`getShortDateTimeFormatter()`):** Empirically tested in Pass 2 and **failed `react-doctor/js-hoist-intl`** (`packages/lib/client/src/lib/datetime.ts:39: Intl formatter rebuilt each call`). `react-doctor`'s AST rule flags `new Intl.DateTimeFormat(locale, { ...staticOptions })` inside *any* function body, even a memoized module-private getter.

---

### D5.4 — `ChatMessages` Settlement Lookup Strategy (`chat-messages.tsx:1002`)

**Decision:** _Pending_

**Files & Callers Verified:**
- `packages/react/components/src/chat-messages.tsx:984-1035`:
  - `ChatMessages` is exported from `@kalaido/components` and rendered in `packages/react/components/src/chat-panel.tsx:448` (1 caller; 0 unit test files).
  - Currently, inside `messages.map((msg, index) => ...)`, `settledBy` slices `messages.slice(index + 1)` and scans all remaining messages' parts **twice on every non-system message**, even when neither `confirmationPart` (`data-regenerate_confirmation`) nor `contextConfirmation` (`data-context_confirmation`) is present on `msg`.
  - Mathematical equivalence: `messages.slice(index + 1).some(m => m.parts?.some(p => typeSet.has(p.type)))` is `true` **iff** the largest message index carrying a matching settlement part is strictly greater than `index` (`lastIndex > index`, with `-1` when absent) — even when multiple confirmation cards appear in the same conversation.

**Cross-Plan Coupling:**
- `doctor-06` Tier 2 targets `EditNoticeCard` (`packages/react/components/src/chat-messages.tsx:510`, CC=43, Cog=51) in the same file. `ChatMessages` itself (line 882) is currently below `no-giant-component` and `no-high-complexity-react-function` thresholds; extracting any helper at module scope keeps `ChatMessages`'s complexity from rising.

#### Option A — Local `new Set(types)` Inside `settledBy` + Lazy Card Guard
- **How it works:** In `chat-messages.tsx:997-1012`, construct `const typeSet = new Set(types)` inside `settledBy` (`typeSet.has(...)`), and short-circuit `const isSettled = Boolean(confirmationPart) && settledBy(...)` and `const contextSettled = Boolean(contextConfirmation?.spec) && settledBy(...)` so `settledBy` only runs on messages that actually render a confirmation card.
- **Verification:** Prototyped in isolated workspace; `pnpm -r typecheck`, `biome lint --error-on-warnings`, `vitest run` (223/223), and `react-doctor` all passed (`js-set-map-lookups: 2 → 0`, no new complexity warnings).
- **Pros:**
  - Smallest localized diff (~5 lines right at lines 997–1012); skips scanning entirely on ordinary text/tool messages where no confirmation card exists.
- **Cons:**
  - Still slices and scans `messages.slice(index + 1)` per rendered confirmation card on every streaming render.

#### Option B — `useMemo` Single Reverse Pass (`lastSettledIndices(messages)`)
- **How it works:** Define a small module-scope pure helper `lastSettledIndices(messages: UIMessage[]): { regenerate: number; context: number }` that walks `messages` backwards once (stopping early as soon as both `regenerate >= 0` and `context >= 0` are found), memoize `const settledAfter = useMemo(() => lastSettledIndices(messages), [messages])` in `ChatMessages`, and replace `settledBy(...)` with `const isSettled = settledAfter.regenerate > index` and `const contextSettled = settledAfter.context > index`.
- **Verification:** Prototyped in isolated workspace; `pnpm -r typecheck`, `biome lint --error-on-warnings`, `vitest run` (223/223), and `react-doctor` all passed (`js-set-map-lookups: 2 → 0`; `ChatMessages` did **not** trigger `no-high-complexity-react-function` or `no-giant-component`).
- **Pros:**
  - Reduces settlement checks from O(M² × P) per render to O(M × P) once per `messages` reference change (and O(1) early exit once settled), with O(1) integer comparison inside `messages.map`.
  - Removes `settledBy` closure allocation from `messages.map`, actually lowering `ChatMessages` render-body complexity ahead of Category 6.
- **Cons:**
  - Adds a ~22-line helper function above `ChatMessages`.

---

### D5.5 — Non-Index Keys in `MapScreen` & `StatusPage` (`map-screen.tsx:178` & `Status.tsx:338`)

**Decision:** _Pending_

**Files & Callers Verified:**
- `packages/react/features/src/map/map-screen.tsx:175-190`:
  - Renders `relationships` from `kalaidoscope_map.body`.
  - Go backend (`kalaidoscope/internal/mapdoc/doc.go:25-29` & `kalaidoscope/internal/mapping/consolidate.go:201-215`): `Relationship` has `{ from: string, to: string, kind: string }` (no `id` field), and `finishDocument` explicitly deduplicates `next.Relationships` by `from.ID + "|" + to.ID + "|" + r.Kind` (`t_<8 base32 chars>` endpoints). Previously `map-screen.tsx:178` omitted `rel.kind` (`key={`${rel.from}-${rel.to}-${i}`}`), which is why `-${i}` and `biome-ignore` were added.
- `apps/desktop/src/features/status/pages/Status.tsx:335-349`:
  - Renders `runningTasks` from PocketBase singleton `llm_queue_status.running`.
  - Go backend (`kalaidoscope/llm/queue/queue.go:132-143, 333, 378, 524-538`): `TaskInfo` has `{ role, priority, model, started, tokens?, tokens_per_second? }` (no `id` or `seq` field; `waiter.seq` is not copied to `task` or `TaskInfo`). Crucially, `dispatchLocked()` captures `now := time.Now()` **once** at line 333 before looping over `s.waiting` — so multiple tasks with the same `(role, priority, model)` admitted in the same `dispatchLocked()` call have **identical `started` timestamps to the nanosecond**!

**Cross-Plan Coupling:**
- `map-screen.tsx:41` (`MapScreen`) is in **`doctor-06` Tier 2** (`no-high-complexity-react-function`, CC=15, Cog=17). Any key-derivation logic should live in a module-scope helper (not inline branches in `MapScreen`) so `MapScreen`'s complexity does not increase.
- `Status.tsx` is touched in **three** places across the plan series: **D5.5** (line 338 key), **D5.6** (line 37 `queueHeldLabels` import), and **`doctor-06` Part A** (line 424 `statusRoute` `only-export-components`) + **Tier 1** (line 52 `StatusPage` decomposition into `<QueueSection>` etc.).

#### Option A — Module-Scope Occurrence-Disambiguated Composite Keys in Both Files
- **How it works:**
  - In `map-screen.tsx`, add module-scope `keyRelationships(relationships)` building `${rel.from}\0${rel.kind}\0${rel.to}#${occurrence}` via a `Map<string, number>`, remove `biome-ignore`, and render `key={key}`.
  - In `Status.tsx`, add module-scope `keyRunningTasks(runningTasks)` building `${t.role}\0${t.priority}\0${t.model}\0${t.started}#${occurrence}` via a `Map<string, number>`, remove `biome-ignore`, and render `key={key}`.
- **Verification:** Prototyped in isolated workspace; `pnpm -r typecheck`, `biome lint --error-on-warnings` (with both `biome-ignore` comments removed), `vitest run` (223/223), and `react-doctor` all passed (`no-array-index-as-key: 5 → 3`, only `shadcn/` remaining; zero added complexity warnings).
- **Pros:**
  - 100% immune to duplicate React key collisions in both files — even if unmigrated/legacy `kalaidoscope_map` rows or test fixtures ever contain duplicate `(from, kind, to)` tuples, and when `queue.go` admits concurrent identical-role tasks at the same `now`.
  - Unlike raw array index `idx`, occurrence suffixes (`#0`, `#1`) stay stable when an unrelated earlier item is inserted or finishes.
- **Cons:**
  - Adds a ~10-line module-scope helper in `map-screen.tsx` even though `consolidate.go:208` already deduplicates `(from, to, kind)` server-side.

#### Option B — Natural `from|kind|to` Key in `MapScreen` + Occurrence-Disambiguated Key in `StatusPage`
- **How it works:**
  - In `map-screen.tsx:178`, rely on `consolidate.go:208-213`'s uniqueness invariant (`from.ID + "|" + to.ID + "|" + r.Kind`) and write `key={`${rel.from}|${rel.kind}|${rel.to}`}` directly (removing `i` and `biome-ignore` with zero helper).
  - In `Status.tsx:338`, use `keyRunningTasks(runningTasks)` (`${t.role}\0${t.priority}\0${t.model}\0${t.started}#${occurrence}`) because `queue.go` `dispatchLocked` can emit duplicate tuples.
- **Verification:** Prototyped in isolated workspace; `pnpm -r typecheck`, `biome lint --error-on-warnings`, `vitest run` (223/223), and `react-doctor` all passed (`no-array-index-as-key: 5 → 3`).
- **Pros:**
  - Zero boilerplate in `map-screen.tsx` (1-line edit matching the exact `|` composite key used by `consolidate.go:208`), while keeping full collision safety in `Status.tsx`.
- **Cons:**
  - If a malformed or hand-seeded test `kalaidoscope_map` JSON ever contained duplicate `(from, kind, to)` entries without running through `finishDocument`, React would log a duplicate-key warning in `MapScreen`.

**Ruled-Out Options:**
- **Bare `${t.role}-${t.model}-${t.started}` in `Status.tsx` without occurrence counter:** Ruled out by `kalaidoscope/llm/queue/queue.go:333, 378` — `dispatchLocked` assigns the same `now` timestamp to all waiters admitted in one pass, so two concurrent `annotate` or `colour` tasks on the same model produce identical keys.
- **Adding `ID uint64` (`seq`) to Go `queue.TaskInfo`:** Crosses into Go backend changes (`kalaidoscope/llm/queue/queue.go`) for a frontend lint rule and would require marking `kalaidoscope/docs/llm-queue-quota.md` and `kalaidoscope/docs/coordination.md` `> **STALE**` per `kalaidoscope/AGENTS.md` plus rebuilding the sidecar.

---

### D5.6 — Resolving the 6 Non-Page `only-export-components` Modules (7 Warnings)

**Decision:** _Pending_

**Files & Callers Verified:**
1. `packages/react/primitives/src/kalaido/colour.tsx:16` (`contentColour`): **0 external callers** across `apps/`, `packages/`, and tests; re-exported in `packages/react/primitives/src/kalaido/index.ts:4`. Note `packages/react/primitives/package.json` maps `"./kalaido/*": "./src/kalaido/*.tsx"` (`.tsx` only!) whereas `"./lib/*": "./src/lib/*.ts"` and `"#lib/*": "./src/lib/*.ts"` map `.ts` files automatically without touching `package.json`.
2. `packages/react/primitives/src/layout/location-label.tsx:3` (`truncatePath`): **0 external callers** across `apps/`, `packages/`, barrels, and tests. (`"./layout/*": "./src/layout/*.tsx"` also maps `.tsx` only; `"./lib/*"` / `"#lib/*"` maps `.ts`.)
3. `apps/desktop/src/components/layout/sidecar-status-dot.tsx:4, 22` (`phaseLabel`, `phaseDotClass`): `phaseLabel` has **1 external caller** (`apps/desktop/src/components/layout/utility-bar.tsx:22`) and 0 internal calls; `phaseDotClass` has **0 external callers** and 1 internal call (line 46).
4. `apps/desktop/src/components/layout/utility-bar.tsx:59` (`queueHeldLabels`): **1 external caller** (`apps/desktop/src/features/status/pages/Status.tsx:37`) and 1 internal call (line 272).
5. `apps/desktop/src/features/settings/components/workspace-backups-panel.tsx:200` (`sanitizeExportName`): **0 external callers** and **0 test callers** (1 internal call at line 288).
6. `apps/desktop/src/routes/app-router.tsx:32` (`routeElements`): **0 external callers** and **0 test callers** (1 internal call at line 53). `scripts/check-navigation-discipline.mjs` ignores `apps/desktop/src/routes` (`line 12`), and `scripts/validate-routes.ts` imports only `registry.ts` and `route-ids.ts` (never `app-router.tsx`).

**Cross-Plan Coupling:**
- **`doctor-06` Part A (`doctor.config.json`):** Excludes `packages/react/primitives/src/shadcn/**` (6 warnings) and configures desktop route pages `apps/desktop/src/features/*/pages/*.tsx` (26 warnings across 25 files). Together with Category 5's 7 warnings here, all `39` `only-export-components` warnings in the workspace are accounted for (`7 + 6 + 26 = 39`).
- **`doctor-06` Tier 1 (`Status.tsx`):** Updating `Status.tsx:37` to import `queueHeldLabels` from `@/components/layout/queue-labels` touches the same file as **D5.5** and Category 6's `StatusPage` split.

#### Option A — Extract `.ts` Siblings Only for Externally Imported Symbols; Unexport Zero-Caller Symbols
- **How it works:**
  - Create **2** small `.ts` modules for the 2 symbols with external callers:
    1. `apps/desktop/src/components/layout/sidecar-status.ts` exporting `phaseLabel` (update `utility-bar.tsx:22`; remove `phaseLabel` from `sidecar-status-dot.tsx`).
    2. `apps/desktop/src/components/layout/queue-labels.ts` exporting `queueHeldLabels` (update `utility-bar.tsx` and `Status.tsx:37`).
  - Drop the `export` keyword on the **5** symbols with zero external callers (and remove `contentColour` from `packages/react/primitives/src/kalaido/index.ts:4`):
    3. `colour.tsx:16`: `function contentColour(c: number)` (and `export { ColourSwatch } from "./colour";` in `kalaido/index.ts`).
    4. `location-label.tsx:3`: `function truncatePath(...)`.
    5. `sidecar-status-dot.tsx:22`: `function phaseDotClass(...)`.
    6. `workspace-backups-panel.tsx:200`: `function sanitizeExportName(...)`.
    7. `app-router.tsx:32`: `function routeElements(defs: RouteDef[])`.
- **Verification:** Prototyped in isolated workspace (Pass 2); `pnpm -r typecheck`, `biome lint --error-on-warnings`, `check:boundaries`, `check:nav`, `check:design`, `check:routes`, `vitest run` (223/223), and `react-doctor` all passed (`only-export-components: 39 → 32`, 0 non-shadcn non-route-page warnings remaining).
- **Pros:**
  - Smallest file footprint (only 2 new `.ts` files instead of 5–6; zero `package.json` edits; 1-token edits in 4 files).
  - Eliminates dead public exports that had zero consumers anywhere in the monorepo.
- **Cons:**
  - Removes `contentColour` from `@kalaido/primitives/kalaido` barrel and makes `truncatePath`, `sanitizeExportName`, and `routeElements` private so future unit tests would need to re-extract them into `.ts` files if direct testing is wanted.

#### Option B — Extract Pure `.ts` Modules Preserving Public/Testable Helpers (+ Unexport or `.ts`-Extract `routeElements`)
- **How it works:**
  - `packages/react/primitives/src/lib/colour-palette.ts`: export `contentColour` (imported via `#lib/colour-palette` in `colour.tsx` and re-exported in `src/kalaido/index.ts` — matches existing `"./lib/*": "./src/lib/*.ts"` and `"#lib/*": "./src/lib/*.ts"` in `primitives/package.json` with **zero `package.json` changes**).
  - `packages/react/primitives/src/lib/path-utils.ts`: export `truncatePath` (imported via `#lib/path-utils` in `location-label.tsx`, reachable externally as `@kalaido/primitives/lib/path-utils` with zero `package.json` changes).
  - `apps/desktop/src/components/layout/sidecar-status.ts`: export `phaseLabel` and `phaseDotClass` (imported by `sidecar-status-dot.tsx` and `utility-bar.tsx`).
  - `apps/desktop/src/components/layout/queue-labels.ts`: export `queueHeldLabels` (imported by `utility-bar.tsx` and `Status.tsx`).
  - `apps/desktop/src/features/settings/lib/backup-utils.ts`: export `sanitizeExportName` (imported by `workspace-backups-panel.tsx`).
  - `apps/desktop/src/routes/app-router.tsx`: either unexport `function routeElements(defs: RouteDef[])` (since it has 0 external/test callers) **or** extract `apps/desktop/src/routes/route-elements.ts` using `createElement(Route, ...)` parameterized by `Gatekeeper: ComponentType<{ def: RouteDef }>` so `app-router.tsx` and `route-elements.ts` have no circular import.
- **Verification:** Prototyped in isolated workspace (Pass 1, including `route-elements.ts`); `pnpm -r typecheck`, `biome lint --error-on-warnings`, `check:boundaries`, `check:nav`, `check:design`, `check:routes`, `vitest run` (223/223), and `react-doctor` all passed (`only-export-components: 39 → 32`).
- **Pros:**
  - Preserves `@kalaido/primitives/kalaido`'s `contentColour` export and keeps `truncatePath`, `phaseDotClass`, and `sanitizeExportName` directly importable for unit tests without touching component files.
  - Zero `package.json` `exports`/`imports` changes required when primitive helpers live under `packages/react/primitives/src/lib/*.ts`.
- **Cons:**
  - Creates 5–6 new `.ts` files (including 4 files whose exports currently have zero external callers in `apps/` or `packages/`).

**Ruled-Out Options:**
- **Converting `routeElements` into a `<RouteElements defs={appRoutes} />` component inside `<Routes>`:** Throws at runtime in `react-router-dom` v7 (`react-router@7.18.6`, `createRoutesFromChildren` line 7353: `Error: [RouteElements] is not a <Route> component. All component children of <Routes> must be a <Route> or <React.Fragment>`).
- **Moving `contentColour` to `packages/react/primitives/src/kalaido/colour-palette.ts` without updating `package.json` (if `#kalaido/colour-palette` or `@kalaido/primitives/kalaido/colour-palette` is imported):** `packages/react/primitives/package.json` maps `"./kalaido/*"` and `"#kalaido/*"` exclusively to `./src/kalaido/*.tsx` (only `./kalaido` and `./kalaido/icons` are explicit `.ts` entries), whereas `./src/lib/*.ts` is already covered by `"./lib/*"` and `"#lib/*"`.
- **Moving `routeElements` to a `.tsx` sibling (`route-elements.tsx`) as a lowercase function:** `react-doctor/only-export-components` flags lowercase non-component exports in any `.tsx` file, simply moving the warning from `app-router.tsx` to `route-elements.tsx`.

---

## 5. Verification

- Run `./kalaido.sh test:ts && ./kalaido.sh check:ts` (covering Biome format & lint, `check:boundaries`, `check:nav`, `check:design`, `check:routes`, `pnpm -r typecheck`, and `desktop`/`mobile`/`web` production builds).
- Re-run `pnpm dlx react-doctor@latest . --verbose --yes` and confirm all **19** Category 5 warnings are eliminated (`138 → 119` total issues prior to Categories 1–4 & 6):
  - `no-loading-flag-reset-outside-finally`: `2 → 0`
  - `js-index-maps`: `3 → 0`
  - `js-set-map-lookups`: `2 → 0`
  - `js-hoist-intl`: `1 → 0`
  - `async-await-in-loop`: `1 → 0`
  - `rerender-memo-with-default-value`: `1 → 0`
  - `no-array-index-as-key`: `5 → 3` (only `shadcn/` remaining)
  - `only-export-components`: `39 → 32` (`7 → 0` non-shadcn, non-route-page; only 6 `shadcn/` + 26 desktop `pages/*.tsx` remaining for Category 6)
