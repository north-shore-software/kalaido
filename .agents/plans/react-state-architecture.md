# React State Architecture: Current State & Intended End State

**Scope:** `packages/react/*`, `packages/lib/*`, `apps/desktop`, `apps/mobile`, `apps/web`, desktop Tauri Rust host state, and the `kalaidoscope/` + cloud external backends.

---

## Part 1: Current State (Audit)

State in the React layer is currently split across ~8 distinct mechanisms with overlapping responsibilities: Valtio proxies (`appState`, `cloudState`), React Contexts, module-level JS singletons, SWR + PocketBase realtime (`useLiveCollection`), SWR without realtime (`useCollection`, raw `useSWR`), component-local `useState` + manual subscriptions (`useOrganizeStatus`, `useRotationStatus`, `useReflectionSeries`, `useFileIngest`), Better Auth's nanostore atom, AI SDK `useChat`, `HostAdapter.settings`, direct `localStorage`, and Rust `Mutex` state.

### 1.1 In-Memory Only (React / JS / Process Memory — Lost on Reload)

#### Global App Shell, Stores, Contexts & Singletons
| State | Current Mechanism | Location | Notes |
|---|---|---|---|
| Desktop lifecycle stage (`appStage`), modal flags (`addFragmentModalOpen`, `feedbackDialogOpen`), `latestInferenceRate` | Valtio `appState` proxy + pub/sub | `apps/desktop/src/state/app-state.ts`, `packages/lib/client/src/lib/inference-rate.ts` | `latestInferenceRate` is fed from SSE `data-inference_rate` stream parts and visually expires after 5s in `UtilityBar`. |
| Mobile & Web lifecycle stage (`cloudState.stage`) | Valtio `cloudState` proxy | `apps/mobile/src/state.ts`, `apps/web/src/state.ts` | Duplicated stage machine across mobile and web (`bootstrap`, `signed_out`, `workspace_loading`, `workspace_open`, errors). |
| Navigation history & one-shot route seeds | `MemoryRouter` (all 3 apps) | `apps/desktop/src/routes/app-router.tsx`, `apps/mobile/src/app.tsx`, `apps/web/src/app.tsx` | Carries handoff seeds (`ProjectionSeed`, `ReflectionSeed`, `ColourSeed`, `initialPrompt`); not persisted. |
| Active PocketBase client & local auth token | Module singleton `activeClient` + `KalaidoscopeClientContext` | `packages/lib/client/src/lib/active-kalaidoscope-client.ts`, `packages/react/hooks/src/use-kalaidoscope-client.ts` | Holds active `TypedPocketBase`; for `local_file`/`local_net`, `pb.authStore` token is memory-only. |
| Host adapter, client config, active workspace context, markdown link handler | Module singletons + React Contexts | `packages/lib/platform/src/index.ts`, `packages/lib/client/src/config.ts`, `packages/react/hooks/src/host.tsx`, `packages/react/hooks/src/use-active-kalaidoscope.ts`, `packages/react/primitives/src/kalaido/markdown-content.tsx` | Boot-time DI and derived active workspace view. |
| Cloud short-lived JWT cache (`cachedJwt`, `inflightJwt`, `cachedClient`) | Module singletons | `packages/lib/client/src/cloud/auth.ts` | Derived from the persisted session token; refreshed 30s before expiry. |
| Desktop sidecar status (`SidecarStatus`), pending app update, Ollama status & pull progress | Rust `Mutex` (`KalaidoscopeState`, `PendingUpdate`) + React `useState` | `apps/desktop/src-tauri/src/kalaidoscope.rs`, `apps/desktop/src-tauri/src/updater.rs`, `apps/desktop/src/components/layout/utility-bar.tsx`, `apps/desktop/src/features/settings/components/local-ai-section.tsx` | Sidecar phase/port/token live in Rust process memory and push into `UtilityBar` via `sidecar:pocketbase:status` events. |

#### Feature-Level Workflow & Session State
- **Explore:**
  - `lastExploreSession` **module-level singleton** (`packages/react/features/src/explore/explore-screen.tsx`) retains `selected`, `newChatId`, `messages`, and `context` across route unmounts on desktop (`ExploreCompactScreen` on mobile/web uses `useState` only and resets on unmount).
  - Pre-send `context: ContextItem[]` selection, `newChatId`, optimistic bookmark `inFlight` map (`use-bookmarks.ts`), batch bookmark action `phase`/`error` (`use-bookmark-actions.ts`).
  - `ChatPanel` composer `input`, `quotaHit` flag, `lastSentSpecRef`/`lastSentWindowRef` diff baselines, and ephemeral server-computed token estimates (`useWholeScopeFits`, `usePromptEstimate` via `/api/llm/count-tokens`).
- **Refinement (Projections & Reflections):**
  - `useRefineSession` (`clientId`, `refinementId`, `firstPrompt`, `creating`, `committing`, live `messages` and derived `preview` / `phase`).
  - `useDraftName` (`name` draft + `userNamed` ref guarding auto-rename).
  - `useCandidateTriage` (`activeEditId`, `highlightedEditId` for `j`/`k` diff navigation).
  - `ProjectionReviewScreen` (`context` draft, `busy`, `advancing`, `foldingIn`) and `ReflectionRefineScreen` (`cadence`, `fromDate`, `windowOverride`, `context`, `input`, `nameInput` ahead of debounced `usePersistSchedule`).
- **Rotation:** `skipped: Set<string>`, `generatingFor` ref, `busy` (`rotation-screen.tsx`).
- **Colours:** `selectedId`, `composing`, `draftName`, `draftPrompt`, streamed live preview `matches` + client-side `typeFilter` (`colours-screen.tsx`, `use-colour-preview.ts`).
- **Stream & Import:** Search `query`, `colourId`/`importId` filters, bulk `selecting`/`selected` ID set (`stream-screen.tsx`); picked file & scanned archive preview entries (`use-import-picker.ts`); note/file upload `phase`/`errorMsg` (`use-note-ingest.ts`, `use-import-submit.ts`).
- **Dashboard & Onboarding:** `useOptimistic` overlays (`visibleProposed`, `visiblePinned` in `dashboard-screen.tsx`); monotonic `highWater` progress ref (`use-pipeline-progress.ts`).
- **UI micro-state:** Drawer/modal/dialog/popover open toggles, inline rename buffers (`EditableTitle`), form drafts & required-field highlights, busy spinners, error boundaries.
- **Unused primitive:** `createScope` / `useScope` (`packages/react/hooks/src/use-scope.ts`) is implemented in `@kalaido/hooks` with zero production callers.

---

### 1.2 Client-Local Persisted State (Device / Browser Storage, Read or Cached in React)

| State | Storage Backend | React / JS Cache | Sync / Lifecycle |
|---|---|---|---|
| `availableKalaidoscopes` (`local_file`, `local_net`, and cached `cloud` entries) | Tauri `kalaido-settings.json` (`packages/lib/platform/src/tauri.ts`) / Web `localStorage["kalaido-settings"]` (`packages/lib/platform/src/web.ts`) | Valtio `appState.availableKalaidoscopes` (desktop) / `cloudState.workspaces` (mobile, web) | Device-only source of truth for `local_file`/`local_net`. For `cloud`, local offline cache reconciled against `GET /kalaidoscopes` via `syncCloudWorkspaces()`. Manually dual-written to Valtio + `setSetting`. |
| `lastOpenedKalaidoscopeId` | Host settings store | Encoded into `appStage` / `cloudState.stage` at boot | Read once at boot to auto-reopen last workspace; written on open/create, deleted on close/sign-out. |
| `onboardingAcknowledged`, `errorReportingEnabled`, `usageStatisticsEnabled` | Host settings store (desktop) | Valtio `appState` | Hydrated at boot (`app-state.ts`), written in `OnboardingInterstitial`, synced to PostHog (`core-providers.tsx`). |
| `ollamaModel` | Host settings store (desktop) | Component `useState` in `useOllamaModel()` (`apps/desktop/src/hooks/use-ollama-model.ts`) | Read async on mount; writes to `useState` + `setSetting`. Not in Valtio. |
| `theme` (`"light" \| "dark" \| "system"`) | `localStorage["theme"]` (`packages/react/primitives/src/lib/theme.ts`) | `ThemeContext` `useState` (`theme-provider.tsx`) | Read synchronously on mount; updated on `setTheme` + OS `matchMedia` listener when `"system"`. |
| Cloud auth bearer token (`kalaido.cloud.session-token`) | `localStorage` (`packages/lib/client/src/cloud/auth.ts`) | Read on demand by Better Auth & registry fetches | Updated from `set-auth-token` response header; cleared on sign-out or 401/403. |
| `kalaido.restore-stub-branch` | `localStorage` (`apps/desktop/src/features/onboarding/restore.ts`) | None (read imperatively) | Dev/test stub selector for onboarding archive restore UI. |
| PostHog identity / telemetry state | `posthog-js` internal storage | `PostHogProvider` | Enabled only after desktop onboarding consent. |
| *(Dead / legacy keys)* `lightDarkMode`, `pinnedProjections` | Typed in `PersistentAppSetting` (`packages/lib/platform/src/index.ts`) | `lightDarkMode` initialized on desktop `appState`, never updated | Superseded by `localStorage["theme"]` and PocketBase `projection.pinned` / `reflection.pinned`. |

*(Desktop local workspace data directories under `<app_data_dir>/kalaidoscopes/<id>/pb_data` live on disk, managed by Rust in `apps/desktop/src-tauri/src/kalaidoscope.rs`, and are served by the PocketBase sidecar.)*

---

### 1.3 Backend-Only Persistent State (Not Cached in React Memory)

- **PocketBase collections never queried into React:**
  - `lens` — Generation prompt text and `parent_lens_id` lineage (client read/write disabled; server-only).
  - `reflection_refinement` — Persisted reflection refinement sessions (no client resume hook exists).
  - `reflection_window` — Explicitly backfilled window rows (React only reads computed `GET /api/reflections/:id/windows`).
  - `kalaidoscope_config.api_key` (write-only; stripped on read, exposed only as boolean `has_api_key`) & `kalaidoscope_config.model_set` (superuser-only).
  - `usage` (historical periods — raw collection is never queried; only current period is fetched via `GET /api/usage` in Settings).
  - `users` & PocketBase system auth tables (`_superusers`, `_authOrigins`, `_externalAuths`, `_mfas`, `_otps`) — used imperatively for `local_net` auth and sidecar token refresh only.
  - `_kalaido_schema` SQL table, `schema-migration-failed.json`, and `pre-migration-v*.db` backups.
- **Backend-only fields & blobs on synced collections:**
  - `fragment.raw_content`, soft-deleted `fragment` rows (`deleted_at != ""`), and raw uploaded `ingest.file` blobs.
  - `fragment_annotation.{things, decisions, questions, conclusions, consolidated_at, generated_from_map_version}` (React only reads `summary` and `view_stream.title`).
  - `colour.{thing_ids, prompt_match_completed_up_to_fragment_id, last_provider_error_kind, created_by_discover_run_id}` (worker watermarks/metadata).
  - `*_snapshot.{output_raw, resolved_context}` (server-side audit/diff inputs).
- **Backup archives & restore status:** `.zip` archives on local disk or cloud object store; restore status (`boot_id`, `last_restore`) is polled imperatively during restore without React caching.
- **External cloud backend state:** Better Auth DB sessions/credentials and full cloud billing/quota ledger.

---

### 1.4 Backend-Persistent State Cached in React Memory

#### A. SWR + PocketBase Realtime (`useLiveCollection` / `useLiveCollectionWatching`)
Keyed by `["collection", client.baseURL, collection, params]` with PocketBase SSE `.subscribe("*", revalidate)` debounced 50ms triggering full list re-fetch (`mutate()`).
- `projection`, `projection_snapshot`, `projection_refinement`
- `reflection`, `reflection_snapshot`
- `view_stream` (watching `fragment`, `colour_fragment`, `fragment_annotation`)
- `chat_message` (Explore bookmarks via `useBookmarks`; projection refinement history via `useResumeRefinement`)
- `colour_fragment` (`FragmentDrawer` single-fragment tags)
- `fragment_annotation` (`FragmentDrawer` `summary` field only)
- `kalaidoscope_map` (`MapScreen`)
- `llm_queue_status` (`UtilityBar`, `StatusPage` — singleton PB mirror of backend LLM scheduler)
- `map_run`, `discover_run`, `ingest` (Status `useEventLog`)

#### B. SWR Without Realtime (`useCollection` / Direct `useSWR`)
Refreshed only on mount, window focus, or manual `mutate()` — no realtime invalidation.
- `colour` (`useColourSwatches`, `useContextSources`, `ColoursScreen`, `StreamScreen`, `FragmentDrawer`, `AddFragmentModal`, `Import`, `ImportNotesDialog`, `BookmarkActions`)
- `colour_fragment` (`ColoursScreen` counts & selected colour members)
- `fragment` (`useContextSources` types, `useFragmentLabelsQuery`, `ContextPicker`)
- `ingest` (`StreamScreen` completed-import filter dropdown)
- `chat_conversation` + first-message preview (`useConversations`, refreshed on `onTurnComplete`)
- `kalaidoscope_config` (`WorkspaceAiPanel`, manual `mutate()` on save)
- Backups list `GET /api/kalaidoscope/backups` (`WorkspaceBackupsPanel`, manual `mutate()` on create/delete)
- Current-month `GET /api/usage` & cloud `GET /api/quota` (`WorkspaceQuotaPanel`)

#### C. Component / Hook-Local `useState` Caches (Outside SWR)
- `GET /api/organize` (`useOrganizeStatus`) — local `useState` + 9 PocketBase collection subscriptions (300ms debounce) **per mounted consumer**.
- `GET /api/rotation` (`useRotationStatus`) — local `useState`, refetched on mount or manual `refetch()`.
- `GET /api/reflections/:id/windows` (`useReflectionSeries`) — local `useState`, refetched when `reflection_snapshot` or `reflection.window_spec_versions` changes.
- Active chat & refinement transcripts (`chat_message` seeded into `@ai-sdk/react` `useChat`, mirrored in `ExploreScreen`'s `liveMessages` + `lastExploreSession` and `useRefineSession`'s `messages`).
- Active file import job (`useFileIngest`) — single-record `ingest` subscription into local `useState`.

#### D. Non-SWR Global Stores Caching Cloud State
- **Better Auth session** — nanostore atom (`getCloudSessionAtom()`) read via `useCloudSession()`; invalidated on sign-out or 401/403.
- **Cloud Workspace Registry (`GET /kalaidoscopes`)** — reconciled via `syncCloudWorkspaces()` into both Valtio (`appState.availableKalaidoscopes` / `cloudState.workspaces`) and `HostAdapter.settings`.

---

### 1.5 Known Sharp Edges in Current State
1. **Triple-layer workspace list & manual dual-writes:** `availableKalaidoscopes` lives across Cloud Registry, `HostAdapter.settings`, and Valtio, with callers manually updating both Valtio and `setSetting`.
2. **Dead settings keys:** `PersistentAppSetting.lightDarkMode` and `pinnedProjections` remain typed (and `lightDarkMode` remains on desktop `appState`) despite being replaced by `localStorage["theme"]` and PocketBase `pinned`.
3. **Duplicated subscriptions in `useOrganizeStatus`:** Per-component `useState` opens 9 PocketBase subscriptions and fetches `GET /api/organize` independently for each mounted consumer (`UtilityBar` + `Dashboard`/`Map`/`Status`).
4. **Non-live `colour` / `colour_fragment` caches:** Background `discover` and colour-matching workers mutate `colour` and `colour_fragment`, but `useCollection` consumers do not update live.
5. **Module-level Explore session cache:** `lastExploreSession` caches chat state outside Valtio/SWR on desktop only, diverging from mobile/web.
6. **Unused scope abstraction:** `createScope` / `useScope` exists in `@kalaido/hooks` but is not yet wired into any app or feature.

---

## Part 2: Intended End State

The target architecture enforces a strict separation into **five explicit state categories**, eliminating ad-hoc dual-writes, stale non-live caches, and per-component fetch silos.

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│  1. In-Memory Client State          │  2. Client-Local Persisted State       │
│  createScope / useScope             │  createScope / useScope + write-through│
│  • Read-only snapshots              │  • Optimistic background persistence   │
│  • Explicit dispatch(event)         │  • Boot hydration gate for async store │
│  • Parent → child narrowing         │  • Zero manual dual-writes             │
└──────────────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────────────┐
│  3. External Live Reads             │  4. External Paired Writes (Commands)  │
│  Unified live-read hook             │  Unified async write hook              │
│  • Single source of truth for UI    │  • Async, awaitable, exposes status    │
│  • Realtime push where supported    │  • Returns status (+ new ID on create) │
│  • Paired-write / focus / reconnect │  • NEVER returns updated entity data   │
│    invalidation where no push exists│  • Invalidates paired non-push reads   │
│  * Exception: cloud scope list      │                                        │
│    keeps a local offline cache      │                                        │
└──────────────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────────────┐
│  5. Streaming (Explicit Separate Category)                                   │
│  • Incremental SSE / token / progress streams before persistence settles     │
│  • Explore & Refinement chat (useChat), Colour preview, Ollama model pull    │
└──────────────────────────────────────────────────────────────────────────────┘
```

### 2.1 In-Memory Client State — Unified on `createScope` / `useScope`
- All shared, app-level, and feature-workflow in-memory state moves onto `createScope` / `useScope` (`packages/react/hooks/src/use-scope.ts`):
  - State is exposed strictly as read-only snapshots (`useSnapshot(handle.state)`).
  - Mutations happen exclusively through typed `dispatch(event)` handlers.
  - Child screens and features receive narrowed handles exposing only the state keys and events they are permitted to read or dispatch.
- Replaces:
  - Raw global Valtio proxies (`apps/desktop/src/state/app-state.ts`, `apps/mobile/src/state.ts`, `apps/web/src/state.ts`).
  - Ad-hoc module-level session singletons (`lastExploreSession` in `explore-screen.tsx`).
  - Shared/feature workflow state spread across disconnected `useState`/Context hooks.
- Truly local micro-UI state (e.g., transient hover/input/popover flags with no cross-component ownership) remains local where a scope adds no value.

### 2.2 Client-Local Persisted State — Transparent Optimistic Persistence on `useScope`
- Extend `createScope` / `useScope` so any state slice that must survive app restarts persists **transparently in the background**:
  - Reads are synchronous from the scope once hydrated.
  - Writes update scope memory immediately and flush optimistically to the local persistence adapter in the background (fire-and-forget; local storage is treated as fast and non-blocking).
  - Callers never call `setSetting(...)` / `localStorage.setItem(...)` alongside state mutations.
- **Boot hydration gate:** Because Tauri `plugin-store` (`kalaido-settings.json`) is asynchronous to read on startup, persisted root scopes retain an explicit boot hydration gate before transitioning past `bootstrap`.
- Removes dead legacy keys (`lightDarkMode`, `pinnedProjections`) and eliminates fragmented local storage wrappers (`useOllamaModel`, manual `setSetting` calls across `local-kalaidoscope.ts`, `cloud-workspaces.ts`, `cloud-sign-out.ts`, `OnboardingInterstitial`, `create-kalaidoscope/actions.ts`).

### 2.3 External Persistent Reads — Unified Live-Read Primitive
- All reads from external persistent stores (PocketBase collections & views, computed PocketBase endpoints, Better Auth session, Cloud Registry) go through **one unified live-read abstraction** equivalent in ergonomics to `useLiveCollection`.
- **Transparent liveness:** From the caller's perspective, every external read updates live automatically:
  - **Push-capable sources** (PocketBase collections, views, `kalaidoscope_config`, and PB-derived endpoints like `/api/organize`, `/api/rotation`, `/api/reflections/:id/windows`) revalidate via shared/deduped PocketBase realtime subscriptions.
  - **Non-push sources** (Cloud Registry `GET /kalaidoscopes`, Better Auth session, `/api/kalaidoscope/backups`, `/api/usage`, `/api/quota`) revalidate transparently via paired-write invalidation plus mount/focus/reconnect — with the exact same caller contract.
- **Shared cache & deduped subscriptions:** Multiple mounted consumers (e.g., `UtilityBar` + `Dashboard` + `Status` reading organize status, or multiple views reading `colour`) share one cache entry and one subscription set rather than duplicating work in component-local `useState`.
- **Explicit exception — offline cloud scope list:** The list of cloud scopes remains persisted locally so that cloud workspaces still appear when the device is offline (even though unreachable/unusable) rather than disappearing. When online/synced, the live Cloud Registry read reconciles into this persisted offline snapshot.

### 2.4 External Persistent Writes — Paired Async Command Hook
- All mutations against external persistent stores go through **one paired write hook** designed to work with the live-read layer:
  - Async and awaitable.
  - Exposes mutation lifecycle status (`idle` / `pending` / `success` / `error`) so callers can render spinners, disable controls, or handle errors uniformly.
  - **Does not return updated entity values:** Updated state always arrives through the live-read layer (single source of truth, no manual response-merging into React state).
  - **Create commands may return the newly created entity ID** alongside the status so callers can immediately navigate or chain follow-up actions (e.g., `createProjection`, `createReflection`, `createColour`, `createRefinement`, `submitImport`, `saveBookmarks`).
  - Automatically invalidates any paired non-push live reads on completion (transparently closing the loop for Cloud Registry, Better Auth, backups, etc.).

### 2.5 Streaming — Explicit Separate Category
- Incremental, in-flight streams whose intermediate state does not exist in persistent storage are explicitly classified and handled outside the CRUD live-read / command-write pair:
  - **Explore & Refinement chat streaming** (`useChat` SSE turns and mid-stream lens/preview parts).
  - **Colour prompt live preview** (`previewColourStream`).
  - **Local Ollama model pull progress** (`pullModel`).
- Once a stream finishes and the backend commits durable rows (`chat_message`, `projection_snapshot`, installed Ollama model), persistent reads resume ownership of the settled state.

---

### 2.6 Mapping: Current State → Intended End State

| Current State / Hook | Target Category | Notes |
|---|---|---|
| `appState` (ephemeral fields), `cloudState.stage`, `lastExploreSession`, `inference-rate`, feature workflow states (`useRefineSession` non-stream control state, `useDraftName`, `useCandidateTriage`, `Rotation` skipped set, `Stream` filters/selection, `Import` picker) | **1. In-memory `createScope` / `useScope`** | Root app scope narrowed down to feature scopes; eliminates raw Valtio proxies and module singletons. |
| `availableKalaidoscopes` (`local_file`, `local_net`), `lastOpenedKalaidoscopeId`, `onboardingAcknowledged`, telemetry prefs, `ollamaModel`, `theme` | **2. Persisted `createScope` / `useScope`** | Optimistic background write-through + boot hydration gate; dead keys (`lightDarkMode`, `pinnedProjections`) removed. |
| `availableKalaidoscopes` (`cloud` entries) | **3. External live read + local offline cache exception** | Reconciled from Cloud Registry when online; persisted locally so cloud scopes remain visible offline. |
| All `useLiveCollection`, `useLiveCollectionWatching`, `useCollection`, raw `useSWR` (`useConversations`, `WorkspaceAiPanel`, `WorkspaceBackupsPanel`, `WorkspaceQuotaPanel`), `useOrganizeStatus`, `useRotationStatus`, `useReflectionSeries`, `useFileIngest` status, `useCloudSession` | **3. Unified external live read** | Single live-updating read contract; shared/deduped subscriptions; non-live `colour`/`colour_fragment` become live. |
| Direct imperative mutations (`create*`, `update*`, `delete*`, `restore*`, `approve*`, `regenerate*`, `archive*`, `setBookmark`, `saveBookmarks`, `writeWorkspaceLlmConfig`, backup create/delete/restore, `startMap`/`startDiscover`/`startReconcile`, cloud auth & archive mutations) | **4. Paired async write hook** | Returns status (+ new ID on creates); never returns entity payloads; triggers invalidation for non-push sources. |
| `ChatPanel` (`useChat`), `useColourPreview` (`previewColourStream`), `LocalAISection` (`pullModel`) | **5. Streaming (explicit category)** | Dedicated streaming primitives with clean handoff to live reads once settled. |
| `lens`, `reflection_refinement`, `reflection_window`, `kalaidoscope_config.api_key`, historical `usage`, backend watermarks/blobs/migration files | **Backend-only (unchanged)** | Remains strictly server-owned; never cached in React. |

---

### 2.7 Open Design Decisions (To Align Before Implementation)

1. **Client-local storage unification:** Should `theme` (`localStorage["theme"]`) and `kalaido.cloud.session-token` (`localStorage`) fold into `HostAdapter.settings` / persisted scopes, or keep `localStorage` for synchronous first-paint/auth-header access?
2. **Underlying engine for unified live reads & paired writes:** Build on top of SWR (wrapping cache keys, shared subscription ref-counting, and paired mutation invalidation) or introduce a dedicated reactive cache/store?
3. **Exact scope persistence API:** How should `createScope` / `useScope` declare persisted keys and plug into `HostAdapter.settings` (e.g., a `persist` option with adapter + serialization + `hydrated` flag, or a dedicated `createPersistedScope` wrapper)?
4. **Desktop Rust host state (`SidecarStatus`, `PendingUpdate`):** Fold into the desktop root `createScope` via event listeners, or keep as a desktop-only live read?
5. **Optimistic UI on external writes:** Where needed (e.g., `DashboardScreen` `useOptimistic` dismiss/unpin, `useBookmarks` `inFlight` toggle), should optimistic overlays live as a feature of the paired write/live-read contract or stay local to the specific UI surface?
6. **Migration phasing:** Order of rollout across primitives → `packages/react/hooks` → `apps/{mobile,web}` (smaller surface) vs. `apps/desktop` + `packages/react/features`.
