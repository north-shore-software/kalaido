# `@kalaido/state` Adoption Audit

**Companion to:** [`.agents/plans/react-state-architecture.md`](./react-state-architecture.md) and [`packages/react/state/README.md`](../../packages/react/state/README.md).
**Scope:** Full workspace — `packages/lib/{platform,client}`, `packages/react/{state,primitives,hooks,components,features}`, `apps/{desktop,mobile,web}`, `biome.json`, `scripts/check-boundaries.mjs`, and `AGENTS.md`.
**Status:** Audit complete; all adoption decisions locked (ready for phased execution plan).

---

## Executive Summary

`@kalaido/state` (scope, persistence, live reads, paired external writes, PocketBase SSE hub) and its Kalaido bridge wrappers in `packages/react/hooks/src/{kalaidoscope-live,scope-persistence}.ts` are implemented and verified, with **zero production callers yet**.

### Footprint Summary

| Surface | Sites to Adopt / Fix | Notes |
|---|---:|---|
| Core `@kalaido/hooks` read hooks | 8 hooks | Rewrite `useLiveCollection`/`Watching`, remove `useCollection`, migrate `useCloudSession`, `useOrganizeStatus`, `useRotationStatus`, `useColourSwatches`, `useContextSources`, `useFragmentLabels` |
| Non-live `useCollection` call sites | 13 calls | Across `hooks` (4), `components` (2), `features` (6), `desktop` (1) |
| Raw `useSWR` call sites (outside `use-collection.ts`) | 4 sites (5 calls) | `use-conversations.ts`, `workspace-ai-panel.tsx`, `workspace-backups-panel.tsx`, `workspace-quota-panel.tsx` (×2) |
| Ad-hoc `useState`+`useEffect` external reads | 8 hooks/components | `useOrganizeStatus`, `useRotationStatus`, `useReflectionSeries`, `WindowSelect`, `useFileIngest`, `useWholeScopeFits`, `usePromptEstimate`, `syncCloudWorkspaces` (×3 apps) |
| Manual `.mutate()` / `.refetch()` calls to eliminate | 19 calls across 10 files | Including 1 structural blocker: `projection-review-screen.tsx` awaits the return array of `snapshotsQuery.mutate()` |
| External persistent mutation helpers in `packages/lib/client` | 42 total (**18 conflict** with `WriteReturn`) | 24 compatible (`Result<void>` / `Result<{ id }>`); 18 conflict (8 renamed/bare IDs, 9 entity/struct payloads, 1 unwrapped `Promise<void>`) |
| Valtio `proxy` stores | 3 stores | `apps/desktop/src/state/app-state.ts`, plus byte-for-byte identical `apps/mobile/src/state.ts` and `apps/web/src/state.ts` |
| Direct `HostAdapter.settings` / `api/app/settings.ts` call sites | 18 calls | 13 in `desktop`, 5 each in identical `mobile`/`web` `state.ts`, plus `RecoveryView` |
| Direct `localStorage` sites outside `@kalaido/platform/web` | 4 sites | `primitives/src/lib/theme.ts`, `client/src/cloud/auth.ts`, `primitives/src/shadcn/sidebar.tsx` *(newly uncovered)*, `desktop/src/features/onboarding/restore.ts` *(dev stub)* |
| Feature workflow `useScope` targets | ~10 workflows | Including module singleton `lastExploreSession` + unifying `ExploreScreen`/`ExploreCompactScreen` |
| Workspace / auth lifecycle teardown gaps | 10 transitions | Desktop (8) + Mobile/Web (2): `disposeClientSubscriptions`, `clearWorkspaceLiveCache`, `clearCloudLiveCache`, `scope.flush()` before `reload()` |
| Dead `PersistentAppSetting` keys | 2 keys | `lightDarkMode` (also on desktop `appState`), `pinnedProjections` (zero runtime refs) |

### `@kalaido/state` Readiness Check

- **Implemented & wired:** `createScope`, `useScope`, `useScopeState`, `persist` (`hydrate`, `flush`, `getHydrationStatus`), `useLiveRead` (including `getInitialData`, `subscribeKey`, `offlineCache`, `disconnect`), `useExternalWrite`, `httpLiveSource`, `atomLiveSource`, `pbCollectionSource`, `pbEndpointSource`, `pbSubscriptionHub`, `disposeClientSubscriptions`, `clearPocketBaseLiveCache`, `invalidateLiveTags`, `clearLiveCache`, plus Kalaido wrappers in `packages/react/hooks/src/{kalaidoscope-live,scope-persistence}.ts`.
- **Missing vs `react-state-architecture.md` Part 4:**
  - `createScopeContext<S, E>()` (planned for `@kalaido/hooks`, §4.4) — not implemented yet.
  - Shared cloud/base root scope (planned to unify `apps/mobile/src/state.ts` and `apps/web/src/state.ts`, §4.4) — not implemented yet.
  - *(Decided: no `resetPersisted()` helper needed on `@kalaido/state` — reset runs at the app boundary via `dispose()` + `flush()` + `host.settings.clear()` + `host.reload()`.)*

---

## Locked Adoption Decisions

1. **`@kalaido/client` vs React `useExternalWrite` normalization:**
   - Normalize all 18 conflicting mutation helpers in `@kalaido/client` (standardize ID keys to `{ id }` / `{ ids }`, wrap `signOutCloudAuth` in `Result<void, Error>`), **while keeping server-returned entity payloads on the `@kalaido/client` functions** so non-React / direct library callers still have them.
   - Inside each React `useExternalWrite` wrapper, **drop/project payloads** to `void` / `{ id }` / `{ ids }` so React strictly follows CQRS.
2. **Pure CQRS for payload-dependent React flows (zero payload returns / zero `.mutate()`):**
   - **`useRefineSession` (`createRefinement`):** `useExternalWrite` returns `{ id }` only; `useRefineSession` reads seeded `chat_message` rows via `useLiveRead` (filtered by `projection_refinement_id` / `reflection_refinement_id`) before mounting `ChatPanel`.
   - **`ProjectionReviewScreen` fold-in (`handleApproveAndRefresh` / `approveAndNext`):** `useExternalWrite` returns `{ id: snapshotId }`, stores `pendingFoldInId` in scope state, and a reactive effect over the live `snapshots` read navigates once that snapshot appears with `status !== "generating"` (removes `await mutate()` and imperative `getOne`).
   - **`useCandidateTriage` (`editProjectionCandidate`):** `useExternalWrite` returns `{ id: editId }`; a reactive effect over live `pending.edits` appends the `HAND_EDIT_PART_TYPE` system notice once the edit arrives.
   - **`useBookmarkActions` (`saveBookmarks`):** `useExternalWrite` returns `{ ids }`; newly-created count for the toast is derived from pre-write live `bookmarks.marks`.
   - **`BackfillCard` (`backfillReflection`) & `useFileIngest` (`ingestFile`):** `useExternalWrite` returns `{ ids }` and `{ id }` respectively; `useFileIngest` switches to `useLiveRead` on `ingest`.
3. **Split `availableKalaidoscopes` cleanly (clean break — no legacy migration):**
   - Replace `PersistentAppSetting.availableKalaidoscopes` with two distinct keys:
     - `localKalaidoscopes: KalaidoscopeMeta[]` — desktop-only (`local_file`, `local_net`), persisted by the desktop root scope.
     - `cachedCloudKalaidoscopes: KalaidoscopeMeta[]` — owned by `useCloudWorkspaces` `httpLiveSource.offlineCache`, persisted in `HostAdapter.settings` so cloud workspaces remain visible in the picker when offline (even though unreachable/inaccessible), and cleared on sign-out.
4. **Remove `localStorage` from `shadcn/sidebar.tsx`:**
   - Add `sidebarOpen?: boolean` to `PersistentAppSetting`, control `SidebarProvider` from the desktop root scope in `PageLayout`, and remove `localStorage["sidebar_state"]` from `packages/react/primitives/src/shadcn/sidebar.tsx` so `packages/react/*` has zero `localStorage` usage.
5. **Clean break for `theme` and `cloudSessionToken`:**
   - No one-time legacy `localStorage` fallback on boot (consistent with #3).
6. **Settings reset at app boundary (no `resetPersisted()` in `@kalaido/state`):**
   - `DangerZoneSection` and `RecoveryView` perform `rootScope.dispose()` + `await rootScope.flush()` (when a scope is active), then `await host.settings.clear()` + `host.reload()`.
7. **`useFragmentSearch` & `usePromptEstimate`:**
   - `useFragmentSearch`: debounced query (~200ms) + `httpLiveSource` tagged with `kalaidoscopeCollectionTag(client.baseURL, "fragment")` (avoids per-keystroke PocketBase SSE channel churn).
   - `usePromptEstimate`: freeze the debounced `(conversationId, specKey, settledTurnKey)` SWR key while `streaming === true` so `useLiveRead` retains the last settled estimate for the `+ streamingChars / 4` overlay without clearing to `undefined`.
8. **Feature `useScope` granularity — all 10 workflows:**
   - Adopt `useScope` across all 7 shared/multi-component workflows (`Explore` session replacing `lastExploreSession` across desktop/mobile/web, `useRefineSession`, `useDraftName`, `useCandidateTriage`, `useImportPicker`, `Stream` filters/selection, `Rotation` skipped) **and** all 3 single-screen authoring workflows (`ProjectionReview`, `ReflectionRefine`, `Colours`).
9. **Desktop Ollama daemon probes (`checkOllamaStatus`, `getLocalAiStatus`):**
   - Move both onto `useLiveRead(httpLiveSource)` with `revalidateOnFocus: true`; trigger `invalidateLiveTags` after `pullModel` completes and on the Recheck/Refresh button.
10. **Post-migration lock-in guardrails:**
    - In the final wave, ban direct `valtio`, `valtio/react`, `swr`, and `better-auth/react` outside `packages/react/state/**`, ban direct `localStorage` outside `packages/lib/platform/src/web.ts` (allowlisting only the dev restore stub `apps/desktop/src/features/onboarding/restore.ts`), fix the `biome.json` `packages/react/state/src/pocketbase/**` override gap, and update `AGENTS.md`.

---

## 1. Foundation: `@kalaido/platform`, `@kalaido/client`, and `@kalaido/state`

### 1.1 `@kalaido/platform` (`packages/lib/platform/src/`)

| File & Lines | Current | Target |
|---|---|---|
| `index.ts:14-23` | `PersistentAppSetting` contains dead keys `lightDarkMode` and `pinnedProjections` and mixed `availableKalaidoscopes`; lacks `theme`, `cloudSessionToken`, `sidebarOpen` | Remove `lightDarkMode` (only other refs: `apps/desktop/src/state/app-state.ts:51,63`), `pinnedProjections` (zero runtime refs), and mixed `availableKalaidoscopes`. Add `ThemePreference = "light" \| "dark" \| "system"`, `theme: ThemePreference`, `cloudSessionToken: string`, `localKalaidoscopes: KalaidoscopeMeta[]`, `cachedCloudKalaidoscopes: KalaidoscopeMeta[]`, `sidebarOpen: boolean` (clean break, no legacy migration). |
| `tauri.ts:36-37` | `getStore = () => (storePromise ??= load(STORE_FILE))` permanently caches a rejected `load()` promise for process lifetime | Clear `storePromise = null` on rejection so `hydrate()` retries / `RecoveryView` can recover without requiring a reload. |
| `web.ts:8,22-61` | `localStorage["kalaido-settings"]` JSON blob | Keep — sole permitted `localStorage` persistence adapter in the repo. |

### 1.2 `@kalaido/client` (`packages/lib/client/src/`)

#### Storage, Auth & Utility Bridges
- **`cloud/auth.ts:7,13-19,35-41,86-102`:**
  - Replace all 3 direct `window.localStorage` calls (`SESSION_TOKEN_KEY = "kalaido.cloud.session-token"`) with `configureCloudSessionTokenBridge({ get, onChange })` per Plan §4.3.
  - **Synchronous invariant:** `onChange(token)` in `onSuccess` (`:38`) and `dropCloudSession` (`:88`) must synchronously update the in-memory value returned by `get()` before returning, because `signInWithEmail` (`:172`) and `signUpWithEmail` (`:198`) immediately read `readSessionToken()` to verify the token arrived.
  - **Boot ordering invariant:** `getAuthClient()` (`:67-73`) triggers Better Auth's initial `/get-session` request on construction. Root scope `hydrate()` and `configureCloudSessionTokenBridge` must finish behind `SplashScreen` before any component calls `useCloudSession()` / `getAuthClient()`.
  - Keep module-internal derived caches `cachedJwt`, `inflightJwt`, `cachedClient`, and `getCloudSessionAtom()`.
- **`cloud/user.ts:50-153` & `lib/reconcile-cloud-workspaces.ts:3-23`:**
  - Backing API for shared `useCloudWorkspaces` (`httpLiveSource` + `offlineCache`) and paired writes `createCloudKalaidoscope` / `setCloudArchived` (both already return `Result<void, Error>`).
- **`kalaidoscope/context.ts:32-60` (`resolveContextTokens`):**
  - Currently returns raw `Promise<TokenResolutionResponse>` and throws on HTTP error. Wrap in `Result<TokenResolutionResponse, Error>` (or adapt in `useWholeScopeFits` / `usePromptEstimate`) for `LiveSource.fetch`.
- **Other module singletons (keep / bridge):**
  - `config.ts:34-35` (`activeConfig`, `configListeners`): boot-time DI — keep.
  - `lib/active-kalaidoscope-client.ts:6` (`activeClient`): active PB client singleton — keep synchronized with workspace switch/close teardowns.
  - `lib/inference-rate.ts:3` (`listeners`): SSE throughput pub/sub — keep bridged into desktop root scope dispatch (or replace with callback prop on `ChatPanel`).

#### Mutation Helpers Conflicting with `useExternalWrite` `WriteReturn` (18 of 42)

*(The other 24 helpers — `createCloudKalaidoscope`, `setCloudArchived`, `restoreBackup`, `deleteBackup`, `deleteColour`, `rematchColour`, `startDiscover`, `archiveFragment`, `unarchiveFragment`, `archiveFragments`, `unarchiveFragments`, `renameFragment`, `ingestNote`, `writeWorkspaceLlmConfig`, `startMap`, `approveProjectionCandidate`, `deleteProjection`, `restoreProjection`, `startReconcile`, `deleteReflection`, `restoreReflection`, plus `updateProjection`/`updateReflection` which return `{ id }` though `void` is cleaner — already pass `ValidWriteReturn`.)*

| File & Line | Helper | Current Return | Conflict Kind | UI Consumes Payload? |
|---|---|---|---|---|
| `cloud/auth.ts:163` | `signInWithEmail` | `Result<CloudUser, Error>` | Entity payload | No (`CloudAuthPanel` ignores value) |
| `cloud/auth.ts:186` | `signUpWithEmail` | `Result<CloudUser, Error>` | Entity payload | No (`CloudAuthPanel` ignores value) |
| `cloud/auth.ts:212` | `signOutCloudAuth` | `Promise<void>` | Missing `Result` | No |
| `kalaidoscope/backups.ts:102` | `createBackup` | `Result<BackupSummary, Error>` | Entity payload | No (`WorkspaceBackupsPanel` ignores value) |
| `kalaidoscope/chat.ts:505` | `setBookmark` | `Result<MessageMark, Error>` | Entity payload | No (`useBookmarks` ignores value) |
| `kalaidoscope/chat.ts:531` | `saveBookmarks` | `Result<{ saved: SavedBookmark[] }, Error>` | Entity payload | **Yes** (`useBookmarkActions` reads `created` count + `fragmentId`s) |
| `kalaidoscope/colours.ts:137` | `createColour` | `Result<{ colourId: string }, Error>` | Renamed ID key | Uses ID (`colours-screen.tsx`, `submit-import.ts`) → `{ id }` |
| `kalaidoscope/colours.ts:149` | `updateColour` | `Result<{ colourId, name, prompt }, Error>` | Entity payload | No (all 3 callers ignore value) |
| `kalaidoscope/fragments.ts:10` | `addFragment` | `Result<string, Error>` | Bare string ID | *(No active React callers found; check tests)* → `{ id }` |
| `kalaidoscope/ingest.ts:75` | `ingestFile` | `Result<IngestStatus, Error>` | Entity payload | **Yes** in `useFileIngest` (goes away once `useFileIngest` uses `useLiveRead`); `useImportSubmit` only reads `.id` → `{ id }` |
| `kalaidoscope/projections.ts:44` | `createProjection` | `Result<{ projectionId: string }, Error>` | Renamed ID key | Uses ID → `{ id }` |
| `kalaidoscope/projections.ts:67` | `regenerateProjection` | `Result<{ snapshotId: string }, Error>` | Renamed ID key | Uses ID → `{ id }` |
| `kalaidoscope/projections.ts:153` | `editProjectionCandidate` | `Result<{ fragmentId, edit: SnapshotEdit }, Error>` | Entity payload | **Yes** (`useCandidateTriage` builds hand-edit chat notice from `edit`) |
| `kalaidoscope/projections.ts:166` | `updateSnapshotEditStatus` | `Result<{ edit: SnapshotEdit }, Error>` | Entity payload | No (`useCandidateTriage` reads live `pending.edits`) |
| `kalaidoscope/refinements.ts:45` | `createRefinement` | `Result<{ refinementId, messages?: UIMessage[] }, Error>` | Renamed ID + entity payload | **Yes** (`useRefineSession` seeds `ChatPanel` with `messages`) |
| `kalaidoscope/refinements.ts:88` | `commitRefinement` | `Result<{ snapshotId: string }, Error>` | Renamed ID key | Uses ID → `{ id }` |
| `kalaidoscope/reflections.ts:24` | `createReflection` | `Result<{ reflectionId: string }, Error>` | Renamed ID key | Uses ID → `{ id }` |
| `kalaidoscope/reflections.ts:64` | `backfillReflection` | `Result<{ windows: TimeWindow[] }, Error>` | Struct payload | **Yes** (`BackfillCard` reads `windows.length` for toast) → `{ ids }` or `void` |
| `kalaidoscope/reflections.ts:123` | `regenerateReflection` | `Result<{ snapshotIds: string[] }, Error>` | Renamed IDs key | Uses `.length` → `{ ids }` |

*(Non-write helpers — do NOT wrap in `useExternalWrite`: `kalaidoscope/chat.ts:559` `generateBrief` is a stateless compute-only POST; `kalaidoscope/colours.ts:55` `previewColourStream` and `kalaidoscope/local/models.ts:43` `pullModel` are Category 5 streaming.)*

---

## 2. External Reads (`useLiveRead` + 4 Adapters)

### 2.1 Core Shared Hooks (`packages/react/hooks/src/`)

| File & Symbol | Current Mechanism | Target | Notes |
|---|---|---|---|
| `use-collection.ts` (`useCollection`) | Direct `useSWR`, non-live, returns `SWRResponse & { records }` | **Remove** | Zero callers pass 3rd `SWRConfiguration` arg. Replace all 13 callers with live reads. |
| `use-live-collection.ts` (`useLiveCollection`, `useLiveCollectionWatching`) | Wraps `useCollection` + per-mount PB `.subscribe("*")` (50ms debounce) | **Rewrite on `useLiveRead` + `kalaidoscopeCollectionSource`** | Return `LiveReadResult<R[]> & { readonly records: readonly R[] }` (no `mutate`, no `SWRConfiguration`). Preserves `.data` for callers that read it (`use-fragment-labels.ts:61`, `map-screen.tsx:42`, `use-event-log.ts:21-35`). |
| `use-colour-swatches.ts` (`useColourSwatches`) | `useCollection("colour", { fields: "id,swatch" })` | `useLiveCollection` / `kalaidoscopeCollectionSource` | Fixes stale swatches during `discover` runs. |
| `use-context-sources.ts` (`useContextSources`) | 2× `useCollection` (`fragment`, `colour`) + 2× `useLiveCollection` (`projection`, `reflection`) | All 4 on `useLiveCollection` | Shares ref-counted hub channels. |
| `use-fragment-labels.ts` (`useFragmentLabels`, `useFragmentLabelsQuery`) | `useCollection("fragment", ...)` + `ready: !filter \|\| (!isLoading && data !== undefined)` | `useLiveCollection` | `ready` maps cleanly to `!filter \|\| status === "ready"` (or `data !== undefined`). |
| `use-cloud-session.ts` (`useCloudSession`) | `useStore(getCloudSessionAtom())` from `better-auth/react` | `useLiveRead(atomLiveSource(...))` (`key: ["cloud", "session"]`, `tags: ["cloud:session"]`) | Drops `better-auth` dep from `@kalaido/hooks`. Preserve `{ session, user, isPending, signedIn }` return shape. |
| `use-organize-status.ts` (`useOrganizeStatus`) | Local `useState` + `GET /api/status` + **9 per-mount PB subscriptions** (300ms debounce); exposes `refetch` | `useLiveRead(kalaidoscopeEndpointSource({ client, endpoint: "status", watch: WATCHED, coalesceMs: 300, fetch: getOrganizeStatus }))` | **Zero callers use `refetch`** (`UtilityBar`, `DashboardScreen`, `MapScreen`, `Status`, `usePipelineProgress`). Eliminates 9×N duplicate SSE subscriptions! |
| `use-rotation-status.ts` (`useRotationStatus`) | Local `useState` + `GET /api/reconcile`, **no realtime**; exposes `refetch` | `useLiveRead(kalaidoscopeEndpointSource({ client, endpoint: "reconcile", watch: ["fragment", "colour", "colour_fragment", "projection", "projection_snapshot", "projection_refinement", "reflection", "reflection_snapshot"], fetch: getRotation }))` | Eliminates all 3 `.refetch()` callers (`projections-screen.tsx:90`, `projection-detail-screen.tsx:200`, `rotation-screen.tsx:24`). |

### 2.2 Remaining Non-Live `useCollection` Sites Outside Core Hooks (9 calls)

| File & Line | Collection | Notes |
|---|---|---|
| `packages/react/components/src/context-picker/data.ts:31` (`useFragmentSearch`) | `fragment` (keystroke filter) | Debounced (~200ms) `httpLiveSource` tagged with `kalaidoscopeCollectionTag(client.baseURL, "fragment")` (no per-keystroke SSE churn). |
| `packages/react/components/src/fragment-drawer.tsx:262` (`FragmentColours`) | `colour` | Upgrade to `useLiveCollection`. |
| `packages/react/features/src/colours/colours-screen.tsx:32,37,49` | `colour`, `colour_fragment` (×2) | Upgrade to `useLiveCollection`; eliminates 5 manual `.mutate()` calls. |
| `packages/react/features/src/dashboard/components/import-notes-dialog.tsx:40` | `colour` | Upgrade to `useLiveCollection`. |
| `packages/react/features/src/explore/bookmark-actions.tsx:62` | `colour` | Upgrade to `useLiveCollection`. |
| `packages/react/features/src/fragments/stream-screen.tsx:69,73` | `colour`, `ingest` | Upgrade to `useLiveCollection`. |
| `packages/react/features/src/fragments/components/add-fragment-modal.tsx:72` | `colour` | Upgrade to `useLiveCollection`. |
| `apps/desktop/src/features/import/pages/Import.tsx:32` | `colour` | Upgrade to `useLiveCollection`. |

### 2.3 Raw `useSWR` Sites (4 files, 5 calls)

| File & Line | Current Key & Fetcher | Target Adapter & Tags |
|---|---|---|
| `packages/react/features/src/explore/hooks/use-conversations.ts:7-10` | `["chat_conversations", client.baseURL]` -> `listConversations(client)` (`chat_conversation` + `chat_message`); exposes `refresh: mutate` | `kalaidoscopeEndpointSource({ client, endpoint: "chat-conversations", fetch: () => listConversations(client), watch: ["chat_conversation", "chat_message"] })` (or watch `["chat_conversation"]` + invalidate tag on turn complete if `chat_message` SSE is too noisy). Drops `swr` dep from `@kalaido/features`. |
| `apps/desktop/src/features/settings/components/workspace-ai-panel.tsx:59-66` | `["workspace-llm-config", kalaidoscopeId]` -> `readWorkspaceLlmConfig()`; manual `mutate()` at `:93` | `kalaidoscopeEndpointSource({ client, endpoint: "llm-config", fetch: readWorkspaceLlmConfig, watch: ["kalaidoscope_config"] })` (keyed by `client.baseURL` for workspace-switch eviction). |
| `apps/desktop/src/features/settings/components/workspace-backups-panel.tsx:211-220` | `["workspace-backups", kalaidoscope.id]` -> `listBackups()`; manual `mutate()` at `:241,:307` | `httpLiveSource({ key: ["pb", client.baseURL, "backups"], tags: [kalaidoscopeEndpointTag(client.baseURL, "backups")], fetch: listBackups })`. |
| `apps/desktop/src/features/settings/components/workspace-quota-panel.tsx:19-31` | `["workspace-usage", kalaidoscope.id]` -> `fetchUsage()` & `["workspace-quota", kalaidoscope.id]` -> `fetchQuota()` | 2× `httpLiveSource` keyed under `["pb", client.baseURL, "usage" \| "quota"]` so `clearWorkspaceLiveCache(baseURL)` evicts them cleanly. |

### 2.4 Ad-Hoc `useState` + `useEffect` External Reads

| File & Line | Current Read | Target |
|---|---|---|
| `packages/react/features/src/reflections/hooks/use-reflection-series.ts:66-86` & `components/window-select.tsx:37-47` | **Duplicated** `useEffect` calling `listReflectionWindows(reflectionId)` (`GET /api/reflections/:id/windows`); `WindowSelect` relies on manual `refreshKey` prop (`reflection-refine-screen.tsx:308`) | Single shared `useReflectionWindows(reflectionId)` hook using `kalaidoscopeEndpointSource({ client, endpoint: "reflection-windows", params: [reflectionId], fetch: ..., watch: ["reflection", "reflection_snapshot", "reflection_window"], enabled })`. Eliminates duplicate fetch & `refreshKey`. |
| `packages/react/features/src/import/hooks/use-file-ingest.ts:71,82` | Manual `subscribeIngest(id)` + `getIngest(id)` into local `useState` | Store `activeIngestId` locally/in scope + read via `useLiveCollection("ingest", { filter: 'id="..."', enabled: !!activeIngestId })`. |
| `packages/react/components/src/context-bar/use-whole-scope-fits.ts:22-49` | `useEffect` calling `resolveContextTokens({ wholeScope: "full" }, timeWindow)` into `useState` (never updates on new fragments/model changes) | `useLiveRead(kalaidoscopeEndpointSource({ client, endpoint: "whole-scope-fits", params: [windowKey], fetch: ..., watch: ["fragment", "kalaidoscope_config"], coalesceMs: 300 }))`. |
| `packages/react/components/src/context-meter/use-prompt-estimate.ts:58-104` | Debounced `useEffect` calling `resolveContextTokens(...)` + local streaming char overlay | `httpLiveSource` with frozen pre-stream SWR key while `streaming === true` + local `+ streamingChars / 4` overlay. |
| `apps/desktop/src/lib/cloud-workspaces.ts:30`, `apps/mobile/src/state.ts:65`, `apps/web/src/state.ts:65` (`syncCloudWorkspaces`) | Manual imperative `listCloudKalaidoscopes()` + reconcile + dual-write to Valtio & `HostAdapter.settings`, triggered on mount in `CloudWorkspaces.tsx`, `CloudWorkspacePickerScreen`, `ExploreCompactScreen`, and `CloudAuthPanel` | Single shared `useCloudWorkspaces()` hook in `@kalaido/hooks` built on `useLiveRead(httpLiveSource({ key: signedIn ? ["cloud", "workspaces"] : null, tags: ["cloud:workspaces"], fetch: listCloudKalaidoscopes, offlineCache: ... }))` backed by `HostAdapter.settings` key `cachedCloudKalaidoscopes`. |
| `apps/desktop/src/features/create-kalaidoscope/components/ollama-setup-status.tsx:23-38` | `useEffect` calling Rust IPC `checkOllamaStatus()` + Recheck button | `useLiveRead(httpLiveSource)` with `revalidateOnFocus: true` + `invalidateLiveTags` on Recheck button. |
| `apps/desktop/src/features/settings/components/local-ai-section.tsx:27-47` | `useEffect` calling `getLocalAiStatus()` + Refresh button + post-pull refresh (`:78`) | `useLiveRead(httpLiveSource({ key: ["local-ai", "status"], tags: ["local-ai:status"], revalidateOnFocus: true, ... }))`; trigger `invalidateLiveTags(["local-ai:status"])` after `pullModel` completes and on Refresh button. |
| `apps/desktop/src/features/create-kalaidoscope/pages/KalaidoscopeSetup.tsx:168-190,249` | Debounced `checkCloudIdAvailability(candidateId)` form validator | Keep as debounced async form validation (ephemeral pre-submit check, not persistent cached entity state) or wrap in `httpLiveSource` with `enabled: valid`. |

### 2.5 Exhaustive `.mutate()` / `.refetch()` Removal Checklist (19 sites across 10 files)

| File & Line(s) | Current Call | Replacement |
|---|---|---|
| `packages/react/components/src/fragment-drawer.tsx:80,121` | `view_stream` `mutate()` after archive/unarchive/rename | Remove; `view_stream` SSE + `useExternalWrite` invalidating `kalaidoscopeCollectionTag(baseURL, "fragment")`. |
| `packages/react/components/src/fragment-drawer.tsx:294` | `colour_fragment` `links.mutate()` after `updateColour` | Remove; `colour_fragment` SSE + tag invalidation. |
| `packages/react/features/src/colours/colours-screen.tsx:101,160,163,166` | `colours.mutate()`, `allLinks.mutate()`, `memberQuery.mutate()` | Remove; all 3 become live `pbCollectionSource` reads. |
| `packages/react/features/src/dashboard/dashboard-screen.tsx:274` | `projections.mutate()` / `reflections.mutate()` inside `startTransition` | Remove; `useExternalWrite` awaits `invalidates: [kalaidoscopeCollectionTag(baseURL, kind)]` inside `startTransition` so `useOptimistic` holds until settled. |
| `packages/react/features/src/explore/hooks/use-bookmarks.ts:78,89` | `chat_message` `mutate()` & exported `refresh: mutate` | Remove; `setBookmark` & `saveBookmarks` `useExternalWrite` invalidate `kalaidoscopeCollectionTag(baseURL, "chat_message")`. |
| `packages/react/features/src/explore/explore-screen.tsx:301` & `explore-compact-screen.tsx:249` | `conversations.refresh()` (`useSWR` `mutate`) on `onTurnComplete` | Remove; `useConversations` watches `chat_conversation` (and/or `invalidateLiveTags` on turn complete). |
| `packages/react/features/src/fragments/stream-screen.tsx:166,175` | `view_stream` `mutate()` after `archiveFragments` / `unarchiveFragments` | Remove; `view_stream` SSE + `useExternalWrite` invalidating `fragment` tag. |
| `packages/react/features/src/projections/hooks/use-projection-snapshot.ts:156` + callers `use-candidate-triage.ts:207,248` & `projection-review-screen.tsx:298,312,332,404` | `snapshotsQuery.mutate()` (and **`await mutate()` return value at `:332,404`**!) | Remove `mutate` export; triage writes invalidate `projection_snapshot` tag; fold-in stores `pendingFoldInId` and navigates via reactive effect over live `snapshots`. |
| `packages/react/features/src/projections/projections-screen.tsx:90` & `projection-detail-screen.tsx:200` | `useRotationStatus().refetch()` triggered by `useEffect` on snapshot changes | Remove; `useRotationStatus` becomes `kalaidoscopeEndpointSource` watching snapshot/entity collections. |
| `packages/react/features/src/rotation/rotation-screen.tsx:110,126` | `useRotationStatus().refetch()` after approve / regenerate | Remove; `useExternalWrite` invalidates `kalaidoscopeEndpointTag(baseURL, "reconcile")` + SSE push. |
| `apps/desktop/src/features/settings/components/workspace-ai-panel.tsx:93` | `useSWR` `mutate()` after `writeWorkspaceLlmConfig` | Remove; `useExternalWrite` invalidating `llm-config` tag + `kalaidoscope_config` SSE. |
| `apps/desktop/src/features/settings/components/workspace-backups-panel.tsx:241,307` | `useSWR` `mutate()` after `createBackup` / `deleteBackup` | Remove; `useExternalWrite` invalidating `backups` tag. |

---

## 3. External Writes (`useExternalWrite`)

### 3.1 `@kalaido/hooks` & `@kalaido/components`

| File & Line | Write | Concurrency | Invalidates (Tags) | Notes |
|---|---|---|---|---|
| `packages/react/hooks/src/use-draft-name.ts:39-45` | `updateProjection` / `updateReflection` | `"allow"` (auto-rename vs user rename) | *(push-live)* | Narrow return to `void`. |
| `packages/react/hooks/src/use-refine-session.ts:161,229` | `createRefinement`, `commitRefinement` | `"ignore"` | *(push-live)* | Replaces `creating`/`committing` flags; `createRefinement` wrapper returns `{ id }` and `useRefineSession` reads seeded `chat_message` rows via `useLiveRead` before mounting `ChatPanel`. |
| `packages/react/components/src/fragment-drawer.tsx:66,193,287` | `archiveFragment`/`unarchiveFragment`, `renameFragment`, `updateColour` | `"ignore"` (archive, rename); `"allow"` (multi-select colour toggles) | `fragment` / `colour_fragment` tags | Narrow `updateColour` to `void`. |
| `packages/react/components/src/auth/cloud-auth-panel.tsx:52-80` | `signInWithEmail` / `signUpWithEmail` | `"ignore"` | `["cloud:session", "cloud:workspaces"]` | Narrow `CloudUser` return to `void`; call `reset()` when switching signin/signup tab. |

### 3.2 `@kalaido/features`

| Feature | File & Line | Write(s) | Concurrency | Invalidates |
|---|---|---|---|---|
| **Colours** | `colours/colours-screen.tsx:84` | `createColour` (`{ id }`) | `"ignore"` | `colour` tag (optional; push-live) |
| **Colours** | `colours/components/colour-detail-pane.tsx:89,118,132` | `updateColour` (prompt/rename/example), `rematchColour`, `deleteColour` | `"ignore"` (prompt, rename, rematch, delete); `"allow"` (`example` card clicks) | `colour`, `colour_fragment` (push-live) |
| **Dashboard** | `dashboard/dashboard-screen.tsx:245,263` | `deleteProjection`/`deleteReflection`, `updateProjection`/`updateReflection` | `"allow"` | `projection` / `reflection` tag *(awaited inside `startTransition` for `useOptimistic`)* |
| **Explore** | `explore/hooks/use-bookmarks.ts:71` | `setBookmark` (`void`) | `"allow"` | `chat_message` tag *(awaited before clearing local `inFlight` overlay)* |
| **Explore** | `explore/hooks/use-bookmark-actions.ts:48,72` | `saveBookmarks` (`{ ids }`), `updateColour` (`void`) | `"ignore"` | `chat_message` tag (and push-live `fragment`, `colour_fragment`). *(Keep `generateBrief` `:93` as plain stateless async RPC.)* |
| **Fragments** | `fragments/stream-screen.tsx:148,170` | `archiveFragments`, `unarchiveFragments` | `"ignore"` (archive), `"allow"` (undo) | `fragment` tag |
| **Fragments** | `fragments/hooks/use-note-ingest.ts:25` | `ingestNote` | `"ignore"` | *(push-live `fragment`)* — note existing `AbortController` cancel support |
| **Import** | `import/hooks/use-import-submit.ts:21` & `use-file-ingest.ts:55` | `submitImport` (`createColour` + `ingestFile` → `{ id }`) | `"ignore"` | *(push-live `ingest`, `colour`)* |
| **Map** | `map/map-screen.tsx:51` | `startMap` | `"ignore"` | *(push-live `map_run` / `kalaidoscope_map`)* |
| **Projections** | `projections/projections-screen.tsx:26,32` | `restoreProjection`, `updateProjection` (pin) | `"allow"` | *(push-live `projection`)* |
| **Projections** | `projections/new-projection-screen.tsx:85,115,171` | `createProjection` (`{ id }`), `deleteProjection` | `"ignore"` | *(push-live `projection`)* |
| **Projections** | `projections/projection-detail-screen.tsx:108,127,186,311` | `deleteProjection`, `restoreProjection`, `regenerateProjection` (`{ id }`), `updateProjection` | `"ignore"` | `projection_snapshot` / `reconcile` tags |
| **Projections** | `projections/projection-review-screen.tsx:266,292,305,322,394` | `approveProjectionCandidate`, `regenerateProjection` (`{ id }`) | `"ignore"` | `projection_snapshot`, `reconcile` tags |
| **Projections** | `projections/hooks/use-candidate-triage.ts:195,238` | `updateSnapshotEditStatus` (`void`), `editProjectionCandidate` (`{ id }` + reactive effect over live `pending.edits`) | `"allow"` (status toggle), `"ignore"` (hand edit) | `projection_snapshot` tag |
| **Reflections** | `reflections/reflections-screen.tsx:14` | `updateReflection` (pin) | `"allow"` | *(push-live `reflection`)* |
| **Reflections** | `reflections/components/reflection-header.tsx:25`, `reflection-refine-screen.tsx:157,188`, `hooks/use-persist-schedule.ts:43` | `createReflection` (`{ id }`), `updateReflection` (rename & debounced schedule) | `"ignore"` (create, rename), `"allow"` (debounced schedule) | *(push-live `reflection` + `reflection-windows` watches `reflection`)* |
| **Reflections** | `reflections/components/reflection-series-panel.tsx:68,82` | `regenerateReflection` (`{ ids }`) | `"ignore"` | *(push-live `reflection_snapshot`)* |
| **Reflections** | `reflections/components/backfill-card.tsx:26` | `backfillReflection` (`{ ids }` or `void`) | `"ignore"` | `reflection-windows` tag |
| **Rotation** | `rotation/rotation-screen.tsx:83,104,119` | `regenerateProjection` (auto-gen effect), `regenerateReflection`, `approveProjectionCandidate` | `"ignore"` | `reconcile`, `projection_snapshot` tags. *(Note `rotation/next-target.ts:32` imperatively orchestrates `getRotation` + `getPendingCandidate` + `regenerateProjection` for review-wave advancement.)* |

### 3.3 `apps/desktop`, `apps/mobile`, `apps/web`

| App & File | Write(s) | Concurrency | Invalidates / Notes |
|---|---|---|---|
| `desktop/src/features/create-kalaidoscope/actions.ts:126` | `createKalaidoscope` (`createCloudKalaidoscope` / `createLocalKalaidoscope` + `startLocalKalaidoscope` + `writeWorkspaceLlmConfig`) | `"ignore"` | Narrow return to `{ id }`; invalidate `["cloud:workspaces"]` on cloud create; root scope write-through replaces manual `setSetting`. |
| `desktop/src/features/settings/components/workspace-ai-panel.tsx:195` | `writeWorkspaceLlmConfig` | `"ignore"` | `llm-config` tag + `kalaidoscope_config` SSE. |
| `desktop/src/features/settings/components/workspace-backups-panel.tsx:231,298` | `createBackup` (`{ id }` / `void`), `deleteBackup` | `"ignore"` | `backups` tag. |
| `desktop/src/features/settings/components/workspace-backups-panel.tsx:248` -> `lib/restore-kalaidoscope.ts:62` | `restoreBackup` + restart wait + re-switch | `"ignore"` | Full DB replacement: dispose old client + `clearWorkspaceLiveCache` + invalidate `backups`. |
| `desktop/src/lib/cloud-workspaces.ts:69` (`setKalaidoscopeArchived`) | `setCloudArchived` | `"ignore"` | `["cloud:workspaces"]` tag; remove manual optimistic array patch & `setSetting`. |
| `desktop/src/features/status/pages/Status.tsx:73-105` | `startMap`, `startDiscover`, `startReconcile` | `"ignore"` | Replaces `startingMap`/`startingDiscover`/`startingReconcile` `useState`. |
| `desktop/src/lib/cloud-sign-out.ts:21`, `mobile/src/state.ts:136`, `web/src/state.ts:136` | `signOutCloudAuth` (wrap in `Result<void, Error>`) | `"ignore"` | `clearCloudLiveCache()`, dispose active cloud client + `clearWorkspaceLiveCache`, scope dispatch + `flush()`. |

*(Non-external / host-only commands kept outside `useExternalWrite`: `sendFeedback` sync PostHog capture in `FeedbackDialog`, `validateWorkspaceLlmConfig` preflight check, `installPendingUpdate` Rust updater, `removeKalaidoscope` local-only removal + `stopLocalKalaidoscope`.)*

---

## 4. App & Persisted Client State (`createScope` + `hostSettingsPersistence`)

### 4.1 `@kalaido/primitives` & `@kalaido/components`

| File & Lines | Current | Target |
|---|---|---|
| `packages/react/primitives/src/lib/theme.ts:9,35-53` | `getInitialTheme()` / `persistTheme()` reading/writing `localStorage["theme"]` | Remove `localStorage` helpers; keep `Theme`, `LIGHT_THEME_SHIPPED`, `resolveTheme`, `applyTheme`, `watchSystemTheme`. |
| `packages/react/primitives/src/providers/theme-provider.tsx:21-54` | Uncontrolled `useState` + `localStorage` | Controlled Context provider accepting `{ theme, onThemeChange, children }` (preserves zero `@kalaido/*` dep boundary). Consumed by `shadcn/sonner.tsx:19`, `appearance-section.tsx:23`, `utility-bar.tsx:345`. |
| `packages/react/primitives/src/shadcn/sidebar.tsx:25,48-65,107` | Reads/writes `localStorage["sidebar_state"]` even when controlled | Remove `localStorage` from `shadcn/sidebar.tsx`; control via desktop root scope (`sidebarOpen`) in `page-layout.tsx:30`. |
| `packages/react/components/src/core-providers.tsx:19-79` | Renders uncontrolled `<ThemeProvider>` | Accept `theme` + `onThemeChange` props (wired from each app's root scope) and pass to `<ThemeProvider>`. |
| `packages/react/components/src/recovery-view.tsx:37-52` | Calls `getHost().settings.clear()` + `host.reload()` directly | Accept optional `onBeforeClear` (wired to `rootScope.dispose()` + `await rootScope.flush()` when a scope exists), then `host.settings.clear()` + `host.reload()`. |

### 4.2 Mobile & Web: Unifying Duplicated Root Stores

`apps/mobile/src/state.ts` and `apps/web/src/state.ts` (145 lines) are **byte-for-byte identical**, and `apps/mobile/src/app.tsx` and `apps/web/src/app.tsx` (236 lines) differ by **one symbol** (`MobileApp` vs `WebApp`).

- **Target:** Extract a single shared cloud root scope factory (in `@kalaido/hooks`, distributed via `createScopeContext`) owning:
  - **Persisted (`hostSettingsPersistence`):** `theme`, `cloudSessionToken`, `lastOpenedKalaidoscopeId`. *(Cloud workspace list lives in `useCloudWorkspaces` `httpLiveSource` backed by `HostAdapter.settings` key `cachedCloudKalaidoscopes` so offline entries remain visible in the picker.)*
  - **Ephemeral:** `stage: CloudStage`.
- **Replaces across both `apps/mobile` and `apps/web`:**
  - `state.ts:29-145` (`cloudState` proxy, 10 direct mutations, 5 `getHost().settings.*` calls, `bootstrapCloudState`, `syncCloudWorkspaces`, `openCloudWorkspace`, `signOutOfCloud`).
  - `app.tsx:83,124,150,209` (`useSnapshot(cloudState)`) and **`app.tsx:194-197`** (direct `cloudState.stage = ...` mutation inside `ExplorePage` UI handler!).
  - `main.tsx`: wire `configureCloudSessionTokenBridge`, call `cloudScope.hydrate()`, pass `theme`/`onThemeChange` to `<CoreProviders>`.
- **Remains app-specific:** `host.ts`, `main.tsx` (mobile: `installKeyboardInset()`, `mobile.css`; web: dev `react-grab`, `web.css`), and route definitions (`react-router-dom` stays in `apps/*`).

### 4.3 Desktop Root Scope (`apps/desktop/src/`)

- **Replaces:**
  - `state/app-state.ts:50-112` (`appState` proxy, dead `lightDarkMode`, `loadStoredState`, `bootstrapStoredState`).
  - `state/app-state-actions.ts:5-62` (11 raw proxy mutators).
  - `hooks/use-ollama-model.ts:10-31` (local `useState` + `getSetting`/`setSetting("ollamaModel")`, consumed in `local-ai-section.tsx:18`).
  - `components/layout/utility-bar.tsx:39-69` (`sidecarStatus` `useState` + `registerSidecarStatusChangeListener` + `getLocalKalaidoscopeStatus`).
  - `providers/app-providers.tsx:15` (`subscribeInferenceRate` -> root scope dispatch).
  - `api/app/settings.ts` direct callers:
    - `features/onboarding/pages/OnboardingInterstitial.tsx:24-26` (3× `setSetting` + `completeOnboardingInterstitial`)
    - `features/create-kalaidoscope/actions.ts:191-196` (`addAvailableKalaidoscope` + 2× `setSetting`)
    - `lib/local-kalaidoscope.ts:63,98,110-112` (`setSetting`/`deleteSetting` dual-writes)
    - `lib/cloud-workspaces.ts:53-55,86-88` (`setAvailableKalaidoscopes` + `setSetting` dual-writes)
    - `lib/cloud-sign-out.ts:33-35,63,73` (`setAvailableKalaidoscopes` + `getSetting`/`setSetting`/`deleteSetting`)
    - `features/settings/components/danger-zone-section.tsx:14` (`resetAppSettings`)
- **Desktop root scope shape:**
  - **Persisted (`hostSettingsPersistence`):** `theme`, `cloudSessionToken`, `localKalaidoscopes`, `lastOpenedKalaidoscopeId`, `onboardingAcknowledged`, `errorReportingEnabled`, `usageStatisticsEnabled`, `ollamaModel`, `sidebarOpen`. *(Cloud workspaces come from `useCloudWorkspaces`, persisted as offline cache under `cachedCloudKalaidoscopes`.)*
  - **Ephemeral:** `appStage`, `sidecarStatus`, `latestInferenceRate`, `addFragmentModalOpen`, `feedbackDialogOpen`.
- **All 14 reactive `useSnapshot(appState)` consumers to migrate to narrowed `useScope` + `useScopeState`:**
  - `providers/app-providers.tsx:9`, `routes/app-router.tsx:63,118`, `routes/router-listeners.tsx:40,93`, `components/layout/page-layout.tsx:24`, `components/layout/utility-bar.tsx:278`, `features/boot/components/recovery-screen.tsx:29`, `features/boot/pages/BootError.tsx:10`, `features/create-kalaidoscope/components/kalaidoscope-list.tsx:19`, `features/create-kalaidoscope/components/nav-kalaidoscope-switcher.tsx:35`, `features/onboarding/pages/CloudWorkspaces.tsx:33`, `features/onboarding/pages/OnboardingLanding.tsx:30`, `features/settings/components/kalaidoscopes-section.tsx:12`, `features/status/pages/Status.tsx:53`.
- **All 5 imperative `appState.*` readers to migrate to `desktopScope.state`:**
  - `routes/use-app-navigate.ts:46,52`, `features/create-kalaidoscope/actions.ts:141,194`, `lib/local-kalaidoscope.ts:26,91,106,107`, `lib/cloud-workspaces.ts:39,73,81`, `lib/cloud-sign-out.ts:26,30` (and debug logger `main.tsx:50-52`).
- **Desktop `localStorage` exception (keep):** `apps/desktop/src/features/onboarding/restore.ts:9,15` (`kalaido.restore-stub-branch` dev/test stub — explicitly exempted in Plan §2.7.2).

---

## 5. Feature Workflow State, Optimistic Overlays, Streaming & Explicit Non-Targets

### 5.1 Feature Workflow State Candidates (`useScope` — Category 1)

| Priority | Location | Current State | Why `useScope` |
|---|---|---|---|
| **High** | `packages/react/features/src/explore/explore-screen.tsx:58` (`lastExploreSession` singleton) + `explore-compact-screen.tsx:61-70` | Module-level mutable singleton on desktop; duplicated `useState` (lost on unmount) on mobile/web | Replaces module singleton and unifies desktop/mobile/web Explore session persistence across route unmounts (`selected`, `newChatId`, `liveMessages`, `context`, `syncedClientId`, drawer toggles). |
| **High** | `packages/react/hooks/src/use-refine-session.ts:129-138` | 8 `useState` hooks shared across `NewProjection`, `ProjectionDetail`, `ProjectionReview`, `ProjectionDraftEditor`, `ReflectionRefine` | Owns non-stream control state (`parentId`, `clientId`, `refinementId`, `firstPrompt`, `initialMessages`); pairs with `useExternalWrite` (`creating`/`committing`) and streaming `messages` mirror. |
| **High** | `packages/react/hooks/src/use-draft-name.ts:36-37` | `name` `useState` + `userNamed` ref + auto-rename effect | Clean `{ name, userNamed }` scope + `useExternalWrite` rename. |
| **High** | `packages/react/features/src/projections/hooks/use-candidate-triage.ts:58-61` | `highlightedEditId`, `activeEditId` shared across `EditsStatusPill`, `ProjectionCanvasPane`, `RefineChatPanel` | Narrowed read/dispatch across 3 sibling panels. |
| **High** | `packages/react/features/src/import/hooks/use-import-picker.ts:16-19` | `file`, `entries`, `scanning`, `pickError` shared across `ImportFields`, `ImportNotesDialog`, `AddFragmentModal`, desktop `Import`/`OnboardingImport` | Multi-component picker workflow. |
| **Medium** | `packages/react/features/src/fragments/stream-screen.tsx:86-91` | `query`, `colourId`, `importId`, `selecting`, `selected` | Coordinated transitions (`selecting=false` clears `selected`, `clearFilters`) passed to `StreamToolbar` & rows. |
| **Medium** | `packages/react/features/src/rotation/rotation-screen.tsx:25,29` | `skipped: Set<string>`, `generatingFor` ref | Explicitly listed in Plan §2.6 (`busy` moves to `useExternalWrite`). |
| **Included** | `projections/projection-review-screen.tsx:100,138,142,153,168` (`advancing`, `foldingIn`, `pendingFoldInId`, `context`, `refineInput`), `reflections/reflection-refine-screen.tsx:78-89` (`cadence`, `fromDate`, `windowOverride`, `context`, `reflectionId`, `input`, `nameInput`), `colours/colours-screen.tsx:63-65` (`selectedId`, `composing`, `draftName`, `draftPrompt`) | Screen-level authoring drafts | Locked in Decision #8: adopt `useScope` across all 10 feature workflows. |

### 5.2 Strictly UI-Local Optimistic Overlays (Keep Local — Locked Decision #3)
- `packages/react/features/src/dashboard/dashboard-screen.tsx:180-189` (`useOptimistic` `visibleProposed`, `visiblePinned`).
- `packages/react/features/src/explore/hooks/use-bookmarks.ts:46` (`inFlight: ReadonlyMap<string, boolean>`).

### 5.3 Streaming (Category 5 — Keep Outside Live Reads / External Writes)
- `packages/react/components/src/chat-panel.tsx:232-256` — AI SDK `useChat` SSE streaming (Explore, Projections, Reflections). Handoff: live reads (`chat_conversation`, `chat_message`, `projection_snapshot`, `reflection_snapshot`) take over once turns/commits persist.
- `packages/react/components/src/context-meter/use-prompt-estimate.ts:99-102` — local `streamingChars / 4` mid-stream overlay.
- `packages/react/features/src/colours/hooks/use-colour-preview.ts:48-60` — `previewColourStream` SSE. Handoff: `createColour` -> live `colour` & `colour_fragment`.
- `apps/desktop/src/features/settings/components/local-ai-section.tsx:59-89` — `pullModel` NDJSON progress stream *(side note: currently missing unmount cleanup to abort `pullAbortRef.current`)*. Handoff: root scope `ollamaModel` + `local-ai:status` invalidation.
- `apps/desktop/src/lib/restore-kalaidoscope.ts:16-60,91-169` & `api/app/sidecar-client.ts:29-61` — transient one-shot sidecar stop listener & boot/restart polling.
- `apps/desktop/src/features/onboarding/hooks/use-pipeline-progress.ts:13-23` — monotonic `highWater` ref over `useOrganizeStatus()` driving canvas animation.

### 5.4 Explicit Non-Targets (Keep As-Is)
- **Boot / workspace DI contexts:** `HostProvider` (`hooks/src/host.tsx`), `KalaidoscopeClientContext` (`hooks/src/use-kalaidoscope-client.ts`), `ActiveKalaidoscopeContext` (`hooks/src/use-active-kalaidoscope.ts`), `MarkdownOpenLinkContext` (`primitives/src/kalaido/markdown-content.tsx`).
- **DOM / viewport / fault-isolation primitives:** `useAutoScroll` (`hooks/src/use-auto-scroll.ts`), `useIsMobile` (`primitives/src/hooks/use-mobile.ts`), `EditableText` (`primitives/src/kalaido/editable-text.tsx`), `useRequiredHighlights` (`primitives/src/kalaido/required-highlight.tsx`), `PanelErrorBoundary` (`components/src/panel-error-boundary.tsx`), `ErrorBoundary` (`desktop/src/components/error-boundary.tsx`), shadcn UI primitives (`carousel`, `calendar`, `chart`, `toggle-group`, `input-otp`, `combobox`).
- **Tauri menu event listeners:** `menu:navigate`, `menu:feedback`, `menu:check-updates` (`desktop/src/routes/router-listeners.tsx:22-89`).
- **Thin desktop route wrappers (14 files):** `Splash`, `Colours`, `Connections`, `Main`, `Explore`, `Stream`, `Map`, `NewProjection`, `ProjectionDetail`, `ProjectionReview`, `Projections`, `ReflectionRefine`, `Reflections`, `Rotation` — no state migration needed beyond prop updates if any.
- **Trivial isolated component micro-UI state:** popover/dialog open flags, search input boxes, confirm-delete toggles, clipboard "copied" timers, `AuthForm` inputs, `FeedbackDialog` draft, `EditCandidateModal` draft, `MentionTextarea` caret/autocomplete index.

---

## 6. Workspace & Auth Lifecycle / Cache Teardown Audit

Currently, **neither desktop nor mobile/web disposes SSE subscriptions or evicts SWR live caches** when switching, closing, restoring, or signing out of workspaces (relying on `cancelAllRequests()` or hard `reload()`). Every transition below must wire `disposeClientSubscriptions(prev)`, `clearWorkspaceLiveCache(prev.baseURL)`, `clearCloudLiveCache()`, and/or `await rootScope.flush()`:

| App | Location & Transition | Required Teardown / Hook-In |
|---|---|---|
| **Desktop** | `main.tsx:54` + root scope boot | Wire `configureCloudSessionTokenBridge`, call `await desktopScope.hydrate()`, attach `subscribeInferenceRate` & `registerSidecarStatusChangeListener` before leaving `"bootstrap"`. |
| **Desktop** | `lib/local-kalaidoscope.ts:53,72` (`switchLocalKalaidoscope`) | Before replacing/clearing `activeClient`: `disposeClientSubscriptions(prev)`, `await clearWorkspaceLiveCache(prev.baseURL)`, `prev.cancelAllRequests()`. |
| **Desktop** | `features/create-kalaidoscope/actions.ts:85,109` (`startAndConfigure`, `rollbackLocalKalaidoscope`) | Tear down any previously open client before activating the newly created workspace (e.g. when creating from `NavKalaidoscopeSwitcher`), and on rollback. |
| **Desktop** | `lib/local-kalaidoscope.ts:90-130` (`closeIfActive`, `removeKalaidoscope`) | Dispose & clear cache for active client before `setActiveKalaidoscopeClient(null)`. |
| **Desktop** | `lib/restore-kalaidoscope.ts:104` (`restoreKalaidoscope`) | Immediately after `restoreBackup()` succeeds (before waiting for restart), dispose old client & `clearWorkspaceLiveCache(prev.baseURL)` — critical because the restored DB may share the exact same `baseURL` (especially cloud!). |
| **Desktop** | `routes/app-router.tsx:132-136` (`KalaidoscopeContainer` unmount) | Safety-net `disposeClientSubscriptions(client)` alongside `client.cancelAllRequests()`. |
| **Desktop** | `lib/cloud-sign-out.ts:21-48` (`signOutOfCloud`) | If active workspace is cloud, dispose & clear workspace cache; call `clearCloudLiveCache()`; dispatch sign-out on root scope (drops token, prunes cloud cache, clears `lastOpenedKalaidoscopeId` if cloud); **`await desktopScope.flush()` before `reloadAppWindow()`**. |
| **Desktop** | `features/settings/components/danger-zone-section.tsx:12` & `recovery-view.tsx:41` | Dispose active client, stop/reset persisted root scope so queued write-throughs cannot race `settings.clear()`, clear `HostAdapter.settings`, then reload. |
| **Mobile & Web** | Shared cloud root `openCloudWorkspace` (replaces `apps/{mobile,web}/src/state.ts:89-134` & `app.tsx:158-162`) | Before replacing/clearing `activeClient` (including on error when switching from an already-open workspace): `disposeClientSubscriptions(prev)`, `await clearWorkspaceLiveCache(prev.baseURL)`, `prev.cancelAllRequests()`. |
| **Mobile & Web** | Shared cloud root `signOutOfCloud` (replaces `apps/{mobile,web}/src/state.ts:136-145`) | Dispose active client, `clearWorkspaceLiveCache`, `clearCloudLiveCache()`, dispatch sign-out on cloud root scope, **`await cloudScope.flush()` before `host.reload()`**. |

---

## 7. Dependencies, Guardrails & Documentation

### 7.1 `package.json` Changes

| Package | Add | Remove (Post-Migration) |
|---|---|---|
| `packages/react/hooks` | *(already has `@kalaido/state`)* | `valtio` *(already 0 imports today!)*, `swr`, `better-auth` |
| `packages/react/primitives` | — | `next-themes` *(already 0 imports today!)* |
| `packages/react/components` | `@kalaido/state` | — |
| `packages/react/features` | `@kalaido/state` | `swr` |
| `apps/desktop` | `@kalaido/state` | `swr`, `valtio` |
| `apps/mobile` | `@kalaido/state` | `valtio` |
| `apps/web` | `@kalaido/state` | `valtio` |

### 7.2 Documentation & Lint Guardrails

- **Update now:**
  - `AGENTS.md`: add `packages/react/state` (`@kalaido/state`) to Repository Layout (`:28-32`), Dependency Graph (`:45-47`), and Per-Package Rules (`:64-75`); update Allowed `@kalaido/*` deps for `hooks`, `components`, `features`; update Valtio note (`:80`) once scopes replace raw proxies.
  - `biome.json:145-177`: current `@kalaido/state` override excludes `packages/react/state/src/pocketbase/**` from the `@kalaido/*`, `@tauri-apps/*`, and `react-router-dom` import restrictions — add a second override for `packages/react/state/src/pocketbase/**` applying those same restrictions while permitting `pocketbase`.
- **Lock in after migration:**
  - `biome.json`: `noRestrictedImports` banning `"valtio"`, `"valtio/react"`, `"swr"`, and `"better-auth/react"` outside `packages/react/state/**` (forcing `@kalaido/state` / `@kalaido/hooks`).
  - `scripts/check-boundaries.mjs`: add `"swr"` and `"valtio"` to `BANNED_DEPS_BY_PKG` for `hooks`, `components`, `features`, and all 3 apps; add a `localStorage` check restricting direct access to `packages/lib/platform/src/web.ts` (allowlisting only `apps/desktop/src/features/onboarding/restore.ts`).

---

## 8. Locked Phased Migration Waves

Dependency-safe rollout order reflecting all locked decisions:

- **Wave 0 — Foundations & Contracts:**
  - Update `PersistentAppSetting` (`@kalaido/platform`: remove `lightDarkMode`, `pinnedProjections`, `availableKalaidoscopes`; add `theme`, `cloudSessionToken`, `localKalaidoscopes`, `cachedCloudKalaidoscopes`, `sidebarOpen`; clean break). Fix `tauri.ts` rejected `storePromise`.
  - Add `configureCloudSessionTokenBridge` (`@kalaido/client/cloud/auth`), normalize ID key names (`{ id }`/`{ ids }`) & wrap `signOutCloudAuth` in `Result<void, Error>` in `@kalaido/client` while preserving server-returned entity payloads for direct library callers.
  - Add `createScopeContext<S, E>()` in `@kalaido/hooks`, fix `biome.json` `packages/react/state/src/pocketbase/**` override, and update `AGENTS.md`.
- **Wave 1 — Core Live-Read Layer (`@kalaido/hooks`):**
  - Rewrite `useLiveCollection` / `useLiveCollectionWatching` on `useLiveRead` + `kalaidoscopeCollectionSource` (paired with Wave 3 `.mutate()` removals or clean staged transition).
  - Migrate `useCloudSession` (`atomLiveSource`), `useOrganizeStatus` & `useRotationStatus` (`kalaidoscopeEndpointSource`), `useColourSwatches`, `useContextSources`, `useFragmentLabels`.
  - Build shared `useCloudWorkspaces` (`httpLiveSource` + `offlineCache` reading/writing `cachedCloudKalaidoscopes` in `HostAdapter.settings` so cloud workspaces remain visible in pickers when offline).
- **Wave 2 — Persisted Root Scopes & Settings Unification (`primitives`, `components`, `mobile`, `web`, `desktop`):**
  - Make `ThemeProvider` & `CoreProviders` controlled (remove `localStorage` from `primitives/src/lib/theme.ts`), and remove `localStorage["sidebar_state"]` from `primitives/src/shadcn/sidebar.tsx` (controlled via desktop root scope `sidebarOpen`).
  - Create shared cloud root scope and migrate `apps/mobile` + `apps/web` (eliminating duplicated `state.ts` and wiring switch/sign-out teardowns + `flush()` before `reload()`).
  - Create desktop root scope and migrate `appState`, `useOllamaModel`, `sidecarStatus`, `latestInferenceRate`, `OnboardingInterstitial`, `DangerZoneSection` & `RecoveryView` (`dispose()` + `flush()` + `settings.clear()` + `reload()`), and all desktop lifecycle teardowns.
- **Wave 3 — Shared Components & Features (`@kalaido/components`, `@kalaido/features`):**
  - Migrate `FragmentDrawer`, `CloudAuthPanel`, `useFragmentSearch` (debounced `httpLiveSource` with `fragment` tag), `useWholeScopeFits`, `usePromptEstimate` (frozen pre-stream SWR key + local streaming overlay).
  - Migrate all features slice by slice (`map`, `fragments`, `import`, `colours`, `dashboard`, `explore`, `reflections`, `projections`, `rotation`, `auth`) — replacing remaining `useCollection` & raw `useSWR`, removing all `.mutate()`/`.refetch()` calls (pure CQRS for `createRefinement` seeded `chat_message`, `ProjectionReviewScreen` fold-in, `editProjectionCandidate`, `saveBookmarks`, `backfillReflection`, `useFileIngest`), adopting `useExternalWrite` (projecting/dropping payloads in React wrappers), and moving all 10 target workflows onto `useScope`.
  - Delete `packages/react/hooks/src/use-collection.ts`.
- **Wave 4 — Desktop-Only Features (`apps/desktop/src/features/*`):**
  - Migrate `Import.tsx` (`useCollection`), `WorkspaceAiPanel` / `WorkspaceBackupsPanel` / `WorkspaceQuotaPanel` (raw `useSWR` -> `useLiveRead` + `useExternalWrite`), `Status.tsx` (`startMap`/`startDiscover`/`startReconcile`), `create-kalaidoscope/actions.ts`, `OllamaSetupStatus` & `LocalAISection` (`useLiveRead(httpLiveSource)` with `revalidateOnFocus: true` + `invalidateLiveTags` on pull/button + pull abort cleanup), `CloudWorkspaces.tsx` & `Onboarding*`.
- **Wave 5 — Cleanup & Lock-In:**
  - Prune `swr`, `valtio`, `better-auth` (hooks), and `next-themes` (primitives) from `package.json`s.
  - Lock in Biome `noRestrictedImports` (`valtio`, `valtio/react`, `swr`, `better-auth/react` outside `packages/react/state/**`) and `scripts/check-boundaries.mjs` (`BANNED_DEPS_BY_PKG` + `localStorage` restriction outside `packages/lib/platform/src/web.ts`, allowlisting only `apps/desktop/src/features/onboarding/restore.ts`).
  - Run `./kalaido.sh check:ts && ./kalaido.sh test:ts`.
