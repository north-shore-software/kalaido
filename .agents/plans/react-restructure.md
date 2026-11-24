# React App Restructure Plan

Status: **Architecture & boundaries locked — ready for step-by-step API review and implementation**

## Goal

Run a browser-hosted, cloud-only web version of Kalaido alongside the macOS desktop and Android mobile Tauri apps in a pnpm + Cargo monorepo, with strict, enforceable boundaries so each package and app only depends on and ships what it supports.

## Current Baseline (Verified in Repo)

- Single frontend package at `app/` with three Vite entry points (`index.html`, `mobile.html`, `web.html`) switched via `APP_TARGET` / `TAURI_ENV_PLATFORM` in `app/vite.config.ts`.
- `app/web.html` (`app/src/web/main.tsx`) currently mounts `CompanionRouter` (5 routes: `splash`, `boot-error`, `CloudSignIn`, `CloudWorkspacePicker`, `ExploreCompact`).
- `app/src-tauri/` builds both macOS and Android via `tauri.macos.conf.json`, `tauri.android.conf.json`, and `capabilities/{desktop,mobile}.json`.
- In `app/src-tauri/src/lib.rs`, all custom Rust `invoke` commands, the Go PocketBase sidecar (`plugin-shell`), `plugin-dialog`, `plugin-updater`, and native menus are `#[cfg(desktop)]`. Android registers only 3 plugins (`clipboard-manager`, `opener`, `store`) and zero custom Rust commands.
- All `@tauri-apps/*` imports in TypeScript are isolated to 9 files in `app/src/api/app/`.
- Coupling points to untangle during the restructure:
  - `app/src/routes/registry.ts` statically imports every desktop page, pulling desktop screens into `dist-web`.
  - `app/src/routes/use-app-navigate.ts` and `app/src/hooks/use-active-kalaidoscope.ts` bind directly to `registry.ts` and desktop `appState` (`AppStage`).
  - `app/src/routes/route-kit.ts` (`stageEntryRoute`) branches on `appVariant() === "desktop"` vs everything else, forcing `web` onto `"explore"`.
  - `app/src/api/kalaidoscope/client.ts` directly imports `getLocalKalaidoscopeStatus` / `getLocalKalaidoscopeAuthToken` from `@/api/app/local-scopes.ts`.
  - `app/src/api/kalaidoscope/ingest.ts` takes a disk `path` and calls `readLocalFileFromDisk` (Rust) even though it uploads a `Blob` in `FormData`.
  - `app/src/api/app/feedback.ts` calls `invoke("get_feedback_diagnostics")` unconditionally, even though that command is `#[cfg(desktop)]` in `app/src-tauri/src/lib.rs`.
  - `app/src/components/kalaido/` currently mixes ~30 stateless visual primitives with ~10 backend-connected domain widgets (`ChatPanel`, `ContextPicker`, `FragmentDrawer`, etc.).

---

## Decisions Made

### 1. Monorepo workspace layout (`apps/` + `packages/`) — workspace move first
- **Decision:** Move directly to a pnpm workspace (`apps/` + `packages/`) rather than keeping `app/` or creating a temporary sibling `web/`. Temporary breakage during the migration is acceptable.
- **Justification:**
  - Enforces hard dependency boundaries via `package.json` (`apps/web` never depends on `@tauri-apps/*`).
  - Avoids paying two migration costs (extracting into sibling `web/` and later relocating `app/` + rewiring `kalaido.sh` / CI).

### 2. Two Tauri apps (`apps/desktop` and `apps/mobile`)
- **Decision:** Separate macOS (`apps/desktop/`) and Android/iOS (`apps/mobile/`) into two Tauri apps alongside `apps/web/`.
- **Justification:**
  - macOS and Android share zero lines of custom Rust and only 3 plugin init lines (`clipboard-manager`, `opener`, `store`).
  - Mobile is an independent product target with separate store compliance, signing, versioning, and release cadence from macOS notarized DMG/updater builds.
  - Gives structural symmetry across all three apps: single-entry Vite configs, dedicated `package.json` / `tsconfig.json`, and clean `src-tauri/` crates free of `#[cfg(desktop)]` and `tauri.*.conf.json` overrides.

### 3. Root Cargo workspace
- **Decision:** Add a root `Cargo.toml` workspace with `members = ["apps/desktop/src-tauri", "apps/mobile/src-tauri"]`.
- **Justification:** Shares one `Cargo.lock` and one `target/` build cache across both Tauri apps while letting each crate keep its own minimal dependency list and `tauri.conf.json`.

### 4. Two-tier `packages/` split: `packages/lib/*` (pure TS) vs `packages/react/*` (React)
- **Decision:** Split shared packages into a pure TypeScript tier and a layered React tier:
  - `packages/lib/platform` (`@kalaido/platform`) — single package with subpath exports (`.`, `./tauri`, `./web`).
  - `packages/lib/client` (`@kalaido/client`) — backend clients (`cloud/`, `kalaidoscope/`), generated PocketBase types, pure utilities.
  - `packages/react/primitives` (`@kalaido/primitives`) — design tokens (`index.css`), brand assets, `shadcn/` (renamed from `ui/`), stateless visual primitives, `ThemeProvider`. Zero `@kalaido/*` deps (`MarkdownContent` takes an `onOpenLink` prop).
  - `packages/react/hooks` (`@kalaido/hooks`) — React contexts (`HostProvider`/`useHost`, `KalaidoscopeClientContext`, `ActiveKalaidoscopeContext`) and shared data hooks.
  - `packages/react/components` (`@kalaido/components`) — domain-connected widgets reused across 2+ features or by app chrome.
  - `packages/react/features` (`@kalaido/features`) — self-contained vertical feature slices shared across 2+ apps.
- **Justification:**
  - Makes the pure-TS vs React boundary visible directly in the directory tree (`packages/lib/*` can never import React).
  - Avoids a catch-all `core` junk drawer and separates visual primitives (domain-free) from domain widgets (backend-connected) by *coupling*, not component size.
  - Keeps `platform` as one package with `./tauri` (optional peerDeps on `@tauri-apps/*`) and `./web` subpaths so there is less package boilerplate while `apps/web` never installs Tauri.
  - Renaming `ui/` → `shadcn/` with `components.json` inside `packages/react/primitives/` makes shadcn CLI targets and Biome / `check-design-classes` exclusions self-explanatory.

### 5. Host Adapter + Per-App Routing & Global State
- **Decision:**
  - Shared `HostAdapter` interface covers only common cross-platform capabilities (`settings`, `clipboard`, `openExternalUrl`, `diagnostics`, `reload`), with optional sub-adapters (`undefined` when unsupported) instead of runtime-throwing stubs.
  - Purely desktop-only Tauri IPC (`local-scopes`, `sidecar-client`, `downloads`, `ingest-file`, `llm-validate`, `ollama-status`, `updater`, native dialogs, `menu:*` listeners) stays inside `apps/desktop/src/api/app/`.
  - Routing, route tables, global lifecycle state (`AppStage`), and window chrome (`TitleBar`, `NavSidebar`, `UtilityBar`, `keyboard-inset`) are **not shared** — each app owns its own.
- **Justification:** Keeps host runtime (Tauri vs Browser), workspace capability (local+cloud vs cloud-only), and form factor (desktop vs mobile) cleanly separated.

### 6. Keep `apps/web` on existing companion routes for this pass
- **Decision:** During the restructure, `apps/web` and `apps/mobile` stay at parity with the current 5 companion routes (`splash`, `boot-error`, `CloudSignIn`, `CloudWorkspacePicker`, `ExploreCompact`). Expanding `apps/web` to full cloud workspace UI and `BrowserRouter` happens in a follow-up pass.
- **Justification:** Keeps the structural migration verifiable against existing behaviour without mixing repo layout changes with product/UX design for the full web app.

### 7. Mobile identity & per-target versioning
- **Decision:** Both `apps/desktop` and `apps/mobile` start with identifier `com.northshoresoftware.kalaido` and version `0.0.15`. Split `kalaido.sh bump` per target (`bump:desktop` / `bump:mobile`).
- **Justification:** Preserves existing dev/APK identities while decoupling future desktop and mobile release cadences.

### 8. Package consumption: source / JIT workspace packages & `#*` internal imports
- **Decision:** Internal `packages/*` export TypeScript/TSX source directly (`"exports"` pointing to `./src/*`); apps' Vite builds, `tsc`, and Vitest compile directly from source with no separate `dist/` build step. Inside `packages/*`, internal imports use package-scoped Node `#*` subpath `"imports"` (`"#*": "./src/*"`) rather than `@/` (including `packages/react/primitives/components.json` using `"ui": "#shadcn"`, `"utils": "#lib/css-utils"`).
- **Justification:** Instant HMR across workspace packages and zero build-order / watch-daemon overhead. Because app Vite configs map `@` to each app's own `src/`, using `@/` inside source-consumed packages would resolve into the consuming app's tree; `#*` subpath imports are scoped per-package by Node, Vite, and TypeScript.

### 9. No `import.meta.env` in `packages/lib/*` — lazy runtime config injection & `better-auth/client`
- **Decision:** Apps read `import.meta.env.VITE_*` (and `import.meta.env.DEV`) in their own entrypoint (`main.tsx`) and call `configureClient({ authUrl, cloudPbUrl, posthog? })` alongside `setHost(host)`. `packages/lib/client` (`auth.ts`, `client.ts`, `posthog.ts`) constructs `authClient` and reads URLs/PostHog config **lazily** (`getAuthClient()`, `getAuthUrl()`, `getCloudPbUrl()`, `getPosthogConfig()`) with zero eager module-scope evaluation and zero `import.meta.env` reads. `auth.ts` uses `better-auth/client` (framework-free) instead of `better-auth/react`, and `@kalaido/hooks`'s `useCloudSession()` subscribes to its session atom. Each app's `vite.config.ts` keeps `requireCloudEnv()` so missing env vars still fail at build time.
- **Justification:** In ESM, static imports run before `main.tsx` calls `configureClient(...)`, so module-scope client creation would execute before config exists. Switching to `better-auth/client` keeps `packages/lib/*` genuinely React-free and Vite-free pure TypeScript.

### 10. Tailwind v4 scanning via per-package `@source` stylesheets
- **Decision:** Each React package that contains Tailwind classes owns its own stylesheet with `@source "./";`:
  - `packages/react/primitives/src/index.css` explicitly includes `@source "./";` alongside `@source "../node_modules/streamdown/dist/*.js";` (empirically verified: `@import`ing `index.css` from an app does **not** auto-scan `primitives/src/` without `@source "./";`).
  - `packages/react/components/src/styles.css` and `packages/react/features/src/styles.css` each contain `@source "./";`.
  - Apps `@import` the stylesheets of the React packages they use instead of writing relative `../../../packages/...` paths.
  - Keep `tailwindcss` in root `package.json` (and/or `@kalaido/primitives/package.json`) so `@import "tailwindcss"` resolves upward from `packages/react/primitives/src/`.
- **Justification:** Prevents Tailwind v4 from silently dropping classes used only inside symlinked workspace packages while keeping sibling apps' classes isolated (empirically verified with `@tailwindcss/vite@4.2.4`).

---

## Intended Repo Structure

```text
kalaido/
├── Cargo.toml                        # Rust workspace: apps/desktop/src-tauri, apps/mobile/src-tauri
├── Cargo.lock                        # Shared Rust lockfile
├── pnpm-workspace.yaml               # packages/lib/*, packages/react/*, apps/*
├── pnpm-lock.yaml                    # Shared JS/TS lockfile
├── package.json                      # Root scripts + shared devDeps (Biome, TS, Vitest, Vite, Tailwind)
├── tsconfig.base.json                # Shared strict TS compiler options
├── biome.json                        # Root Biome config (!packages/react/primitives/src/shadcn/**, !types.ts)
├── vitest.config.ts                  # Workspace test config
├── kalaido.sh                        # Per-target dev/build/check/bump commands
├── scripts/                          # Workspace checks (design classes, nav discipline, route validation)
│
├── packages/
│   ├── lib/                          # Pure TypeScript — ZERO React
│   │   ├── platform/                 # @kalaido/platform (exports: ".", "./tauri", "./web")
│   │   │   ├── package.json
│   │   │   ├── tsconfig.json
│   │   │   └── src/
│   │   │       ├── index.ts          # HostAdapter contract, shared types, setHost/getHost
│   │   │       ├── tauri.ts          # createTauriHost() (store, clipboard, opener)
│   │   │       └── web.ts            # createWebHost() (localStorage, navigator.clipboard, window.open)
│   │   │
│   │   └── client/                   # @kalaido/client
│   │       ├── package.json
│   │       ├── tsconfig.json
│   │       └── src/
│   │           ├── cloud/            # better-auth client, cloud workspace registry API
│   │           ├── kalaidoscope/     # PocketBase cloud & local_net clients, generated types, Blob-based ingest, domain APIs
│   │           └── lib/              # Pure domain & text utils (errors, mentions, markdown-diff, naming, ndjson, pins, datetime, labels, posthog, reconcile-cloud-workspaces)
│   │
│   └── react/                        # React layer
│       ├── primitives/               # @kalaido/primitives — ZERO @kalaido/* deps
│       │   ├── package.json
│       │   ├── tsconfig.json
│       │   ├── components.json       # shadcn CLI config ("ui": "#shadcn", "utils": "#lib/css-utils")
│       │   └── src/
│       │       ├── index.css         # Design tokens + Tailwind v4 theme + @source "./"; + streamdown @source
│       │       ├── assets/brand/     # SVGs, favicon, colors_and_type.css
│       │       ├── lib/              # css-utils.ts (cn), theme.ts
│       │       ├── shadcn/           # Generated shadcn primitives (excluded from Biome lint & design-class check)
│       │       ├── kalaido/          # Stateless visual primitives (Pill, SurfaceCard, Metric, OptionCards, EmptyState, Diff, Timeline, EditableText, MarkdownContent [onOpenLink prop], etc.)
│       │       ├── layout/           # Pure layout primitives (PaneHeader, Section, LocationLabel, ThemeToggle)
│       │       └── providers/        # ThemeProvider
│       │
│       ├── hooks/                    # @kalaido/hooks
│       │   ├── package.json
│       │   ├── tsconfig.json
│       │   └── src/                  # HostProvider/useHost, KalaidoscopeClientContext, ActiveKalaidoscopeContext, useCloudSession, useCollection, useLiveCollection, useColourSwatches, useFragmentLabels, useActiveContext, etc.
│       │
│       ├── components/               # @kalaido/components — reusable domain-connected widgets
│       │   ├── package.json
│       │   ├── tsconfig.json
│       │   └── src/                  # styles.css (@source "./";), ChatPanel, RefineChatPanel, ContextBar, ContextPicker, ContextMeter, FragmentCard, FragmentDrawer, DecisionCard, DocumentCard, SourceList, PinToggle, PageHeader, CloudAuthPanel, AuthForm, OAuthButtons, RecoveryView, SplashScreen, CoreProviders
│       │
│       └── features/                 # @kalaido/features — vertical feature slices shared by 2+ apps
│           ├── package.json
│           ├── tsconfig.json
│           └── src/
│               ├── styles.css        # @source "./";
│               ├── explore/          # BookmarksTray, ChatMessageActions, ConversationList, useBookmarks, useBookmarkActions, useConversations, ExploreCompactScreen
│               └── auth/             # CloudSignInScreen, CloudWorkspacePickerScreen
│
├── apps/
│   ├── desktop/                      # @kalaido/desktop (macOS, local + cloud, full UI)
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── vite.config.ts
│   │   ├── index.html
│   │   ├── DESIGN.md / AGENTS.md
│   │   ├── src/                      # Desktop router, registry, appState, host.ts, desktop-only api/app/*, TitleBar/NavSidebar/UtilityBar, desktop-only features/*
│   │   └── src-tauri/                # macOS-only Rust crate (sidecar, updater, dialog, shell, menu, feedback, local files)
│   │
│   ├── mobile/                       # @kalaido/mobile (Android/iOS, cloud-only, compact UI)
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── vite.config.ts
│   │   ├── index.html
│   │   ├── public/favicon.svg
│   │   ├── src/                      # Mobile router, cloud-only state, host.ts, keyboard-inset, mobile.css
│   │   └── src-tauri/                # Mobile-only Rust crate (clipboard-manager, opener, store only)
│   │
│   └── web/                          # @kalaido/web (Browser, cloud-only)
│       ├── package.json
│       ├── tsconfig.json
│       ├── vite.config.ts
│       ├── index.html
│       ├── public/favicon.svg
│       └── src/                      # Web router, cloud-only state, host.ts, web.css
│
├── kalaidoscope/                     # Go backend / sidecar (unchanged)
└── .github/workflows/                # CI / release workflows
```

---

## Dependency Graph & Directory Rules

### Allowed Dependency Direction (Strictly Acyclic)

```text
packages/lib/platform  ──► (no @kalaido/* deps)
packages/lib/client    ──► platform
packages/react/primitives ──► (no @kalaido/* deps)
packages/react/hooks      ──► platform, client
packages/react/components ──► platform, client, primitives, hooks
packages/react/features   ──► platform, client, primitives, hooks, components
apps/desktop              ──► platform (., ./tauri), client, primitives, hooks, components, features
apps/mobile               ──► platform (., ./tauri), client, primitives, hooks, components, features
apps/web                  ──► platform (., ./web),   client, primitives, hooks, components, features
```

Cross-tier invariants:
- **No upward imports:** `packages/lib/*` must never import from `packages/react/*` or `apps/*`.
- **No sibling app imports:** `apps/*` must never import from another `apps/*`.
- **No Tauri leakage:** `@tauri-apps/*` may only appear in `packages/lib/platform/src/tauri.ts`, `apps/desktop/`, and `apps/mobile/`. It must never appear in `packages/lib/platform/src/{index,web}.ts`, `packages/lib/client/`, `packages/react/*`, or `apps/web/`.
- **No router leakage:** `react-router-dom` may only appear in `apps/*`. Shared components and features receive navigation triggers as callback props.
- **No `@/` aliases inside `packages/*`:** Each package uses package-scoped `#*` subpath `"imports"` (`"#*": "./src/*"`) for internal imports so app-level `@/*` Vite aliases never collide with package source.

### Per-Directory Rules

| Directory / Package | Allowed `@kalaido/*` deps | Allowed runtime/framework deps | Must contain | Must NOT contain |
|---|---|---|---|---|
| **`packages/lib/platform`** (`@kalaido/platform`) | None | `neverthrow`. Optional peerDeps on `@tauri-apps/{api,plugin-store,plugin-clipboard-manager,plugin-opener}` used **only** in `src/tauri.ts`. | `HostAdapter` interface, shared cross-layer types (`AppVariant`, `KalaidoscopeMeta`, `PersistentAppSetting`, `FeedbackContext`, `FeedbackDiagnostics`), `setHost`/`getHost`, `./tauri` (`createTauriHost`), `./web` (`createWebHost`). | React, JSX, hooks, PocketBase, domain APIs, desktop-only Tauri plugins (`dialog`, `shell`, `updater`, custom Rust `invoke`s). `src/index.ts` and `src/web.ts` must never import `@tauri-apps/*`. |
| **`packages/lib/client`** (`@kalaido/client`) | `platform` | `pocketbase`, `better-auth` (`better-auth/client` only), `jwt-decode`, `neverthrow`, `ai`, `diff`, `date-fns`, `posthog-js`. | Pure TypeScript backend clients (`cloud/`, `kalaidoscope/`), lazy `configureClient(...)` runtime config (`getAuthClient()`, `getAuthUrl()`, `getCloudPbUrl()`, `getPosthogConfig()`), generated PocketBase `types.ts`, Blob-based `ingestFile`, `createCloudClient` / `createLocalNetClient`, pure domain/text utilities (`errors`, `mentions`, `markdown-diff`, `naming`, `ndjson`, `pins`, `datetime`, `labels`, `reconcile-cloud-workspaces`), PostHog client wrapper. | React, `better-auth/react`, JSX, React hooks, DOM layout code, `import.meta.env` / `vite/client`, eager module-scope client/config initialization, `react-router-dom`, `@tauri-apps/*`, local filesystem path reading, sidecar IPC (`createSidecarClient`). |
| **`packages/react/primitives`** (`@kalaido/primitives`) | **None** | `react`, `react-dom`, `@base-ui/react`, `radix-ui`, `@phosphor-icons/react`, `class-variance-authority`, `clsx`, `tailwind-merge`, `cmdk`, `embla-carousel-react`, `input-otp`, `react-day-picker`, `react-resizable-panels`, `recharts`, `shadcn`, `sonner`, `streamdown`, `@streamdown/math`, `katex`, `vaul`, `tw-animate-css`, `@fontsource-variable/*`. | Design tokens (`src/index.css`), brand SVGs (`assets/brand/`), `lib/css-utils.ts` (`cn`), `lib/theme.ts`, generated `shadcn/` primitives + `components.json`, stateless visual primitives (`kalaido/*`, `layout/*`), `ThemeProvider`. Side-effects (such as opening links in `MarkdownContent`) are injected via callback props (`onOpenLink`). | Any `@kalaido/*` dependency, PocketBase, `better-auth`, `@ai-sdk/react`, `swr`, `valtio`, `react-router-dom`, `@tauri-apps/*`, domain concepts (fragments, projections, workspaces), global app state. |
| **`packages/react/hooks`** (`@kalaido/hooks`) | `platform`, `client` | `react`, `swr`, `neverthrow`, `ai`, `pocketbase`, `sonner`, `better-auth` (`better-auth/react` `useStore` if used, or `useSyncExternalStore`). | React contexts (`HostProvider`/`useHost`, `KalaidoscopeClientContext`/`useKalaidoscopeClient`, `ActiveKalaidoscopeContext`/`useActiveKalaidoscope`) and shared domain/data hooks (`useCloudSession` subscribing to `@kalaido/client`'s session atom, `useCollection`, `useLiveCollection`, `useColourSwatches`, `useFragmentLabels`, `useActiveContext`, `useNoteIngest`, `useOrganizeStatus`, `useProjectionSnapshot`, `useRefineSession`, `useReflectionSeries`, `useResumeRefinement`, `useRotationStatus`, `useMobile`, `useAutoScroll`, `useDraftName`, `useCurrentUserId`). | JSX UI components (except bare context `<Provider>` wrappers), `react-router-dom`, `@tauri-apps/*`, app-specific lifecycle state (`AppStage`). |
| **`packages/react/components`** (`@kalaido/components`) | `platform`, `client`, `primitives`, `hooks` | `react`, `@ai-sdk/react`, `ai`, `@phosphor-icons/react`, `posthog-js`, `sonner`, `neverthrow`. | Domain-connected widgets reused across **2+ features** or by app chrome (`ChatPanel`, `RefineChatPanel`, `ContextBar`, `ContextPicker`, `ContextMeter`, `FragmentCard`, `FragmentDrawer`, `DecisionCard`, `DocumentCard`, `SourceList`, `PinToggle`, `PageHeader`, `CloudAuthPanel`, `AuthForm`, `OAuthButtons`, `RecoveryView`, `SplashScreen`, `CoreProviders`). | `react-router-dom`, `@tauri-apps/*`, app-specific global state (`appState`/`AppStage`), single-feature-only UI. |
| **`packages/react/features`** (`@kalaido/features`) | `platform`, `client`, `primitives`, `hooks`, `components` | `react`, `ai`, `@phosphor-icons/react`, `neverthrow`, `sonner`. | Self-contained vertical feature slices shared across **2+ apps** (each directory owns its feature-specific components, hooks, and screen views, e.g. `explore/`, `auth/`). Navigation and workspace switching are injected via callback props. | `react-router-dom`, `@tauri-apps/*`, desktop-only features, local sidecar logic, app-specific `AppStage`. |
| **`apps/desktop`** (`@kalaido/desktop`) | `platform` (`.`, `./tauri`), `client`, `primitives`, `hooks`, `components`, `features` | `react`, `react-dom`, `react-router-dom`, `valtio`, `neverthrow`, `@tauri-apps/{api,plugin-store,plugin-clipboard-manager,plugin-opener,plugin-dialog}` + `@tauri-apps/cli`. | Desktop router & `registry.ts`, desktop `appState`/`AppStage`, `host.ts` (wiring `createTauriHost({ variant: "desktop", collectDiagnostics })`), desktop-only `api/app/*` (`local-scopes`, `sidecar-client`, `downloads`, `ingest-file`, `llm-validate`, `ollama-status`, `updater`, `feedback`, dialogs, `menu:*`), desktop chrome (`TitleBar`, `NavSidebar`, `UtilityBar`, `PageLayout`, `FeedbackDialog`), desktop-only `features/*`, macOS `src-tauri/` crate. | Mobile or web entry points, `#[cfg(mobile)]`, `tauri.android.conf.json`, `capabilities/mobile.json`. |
| **`apps/mobile`** (`@kalaido/mobile`) | `platform` (`.`, `./tauri`), `client`, `primitives`, `hooks`, `components`, `features` | `react`, `react-dom`, `react-router-dom`, `valtio`, `neverthrow`, `@tauri-apps/{api,plugin-store,plugin-clipboard-manager,plugin-opener}` + `@tauri-apps/cli`. | Mobile router, cloud-only state, `host.ts` (`createTauriHost({ variant: "mobile" })`), `keyboard-inset.ts`, `mobile.css`, mobile-only `src-tauri/` crate (3 plugins, zero custom Rust commands). | Desktop-only Tauri plugins (`dialog`, `shell`, `updater`), sidecar/local-workspace code, desktop routes/screens, `macos-private-api`. |
| **`apps/web`** (`@kalaido/web`) | `platform` (`.`, `./web`), `client`, `primitives`, `hooks`, `components`, `features` | `react`, `react-dom`, `react-router-dom`, `valtio`, `neverthrow`. | Web router, cloud-only state, `host.ts` (`createWebHost()`), `web.css`, web build/deploy config. | **Any `@tauri-apps/*` dependency or import** (including `@kalaido/platform/tauri`), sidecar/local-workspace code, desktop-only screens. |

---

## Platform & Adapter Matrix

### Shared `HostAdapter` (`@kalaido/platform`)

| Capability | macOS (`apps/desktop` via `./tauri`) | Android (`apps/mobile` via `./tauri`) | Web (`apps/web` via `./web`) |
|---|---|---|---|
| `variant` | `"desktop"` | `"mobile"` | `"web"` |
| `settings` | `plugin-store` (`kalaido-settings.json`) | `plugin-store` | `localStorage` |
| `clipboard.writeHtml` | `plugin-clipboard-manager` | `plugin-clipboard-manager` | `navigator.clipboard` |
| `openExternalUrl` | `plugin-opener` | `plugin-opener` | `window.open` |
| `diagnostics.collect` | Desktop hook (`invoke("get_feedback_diagnostics")`) | JS fallback (version, platform, route) | JS fallback (version, platform, route) |
| `reload` | `window.location.reload()` | `window.location.reload()` | `window.location.reload()` |

### Desktop-Only (lives exclusively in `apps/desktop`)

- Local workspaces & Go PocketBase sidecar (`api/app/local-scopes.ts`, `api/app/sidecar-client.ts`, `lib/local-kalaidoscope.ts`)
- Local disk file pickers & file reading (`openFilePicker`, `saveFilePicker`, `openDirectoryPicker`, `classifyPath`, `readLocalFileFromDisk`)
- Authenticated disk download (`downloadToFile`)
- Pre-sidecar LLM validation (`llm-validate.ts`) & Ollama probe (`ollama-status.ts`)
- Native OS menu event listeners (`menu:*`) & auto-updater (`updater.ts`)
- Frameless window chrome (`TitleBar`, `data-tauri-drag-region`)

---

## Staged Implementation Plan (Gate Per Boundary)

Each stage proposes its public API/surface as text for sign-off before files are written:

1. **Workspace root + `packages/lib/platform`** — root pnpm/Cargo configs + `@kalaido/platform` (`.`, `./tauri`, `./web`).
2. **`packages/lib/client`** — pure TS cloud & kalaidoscope clients (decoupling sidecar client and Blob-based `ingestFile`) + pure utils.
3. **`packages/react/primitives`** — `index.css`, brand assets, `shadcn/` + `components.json`, stateless primitives (`MarkdownContent` with `onOpenLink`), `ThemeProvider`.
4. **`packages/react/hooks`** — `HostProvider`/`useHost`, workspace contexts, shared data hooks.
5. **`packages/react/components` + `packages/react/features`** — domain widgets (`ChatPanel`, `ContextPicker`, `CloudAuthPanel`, `RecoveryView`, etc.) and shared feature slices (`explore/`, `auth/`).
6. **`apps/desktop`, `apps/mobile`, `apps/web`** — wire each app + split Rust `src-tauri/` crates, remove old `app/`.
7. **Tooling, `kalaido.sh`, CI & full verification** — update check scripts, Vitest, `kalaido.sh` (including per-target `bump`), `.github/workflows/*`, and verify all builds/tests/checks.
