# React App Restructure Plan

Status: **Decisions locked — awaiting API sign-off to begin implementation**

## Goal

Run a browser-hosted, cloud-only web version of Kalaido alongside the macOS desktop and Android mobile Tauri apps in a pnpm + Cargo monorepo, with strict dependency boundaries so each target only ships and depends on what it supports.

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

---

## Decisions Made

### 1. Monorepo workspace layout (`apps/` + `packages/`) — workspace move first (1B)
- **Decision:** Move directly to a pnpm workspace (`apps/` + `packages/`) rather than keeping `app/` or building a temporary sibling `web/`. Temporary breakage during the move is acceptable.
- **Justification:**
  - Enforces hard dependency boundaries via `package.json` (`apps/web` never depends on `@tauri-apps/*`).
  - Avoids paying two migration costs (extracting into sibling `web/` and later relocating `app/` + rewiring `kalaido.sh` / CI).

### 2. Two Tauri apps (`apps/desktop` and `apps/mobile`)
- **Decision:** Separate macOS (`apps/desktop/`) and Android/iOS (`apps/mobile/`) into two Tauri apps alongside `apps/web/`.
- **Justification:**
  - macOS and Android share zero lines of custom Rust and only 3 plugin init lines (`clipboard-manager`, `opener`, `store`).
  - Mobile is an independent product target with separate store compliance, signing, versioning, and release cadence from macOS notarized DMG/updater builds.
  - Gives structural symmetry across all three apps: single-entry Vite configs, dedicated `package.json` / `tsconfig.json`, and clean `src-tauri/` crates without `#[cfg(desktop)]` or `tauri.*.conf.json` overrides.

### 3. Root Cargo workspace (3A)
- **Decision:** Add a root `Cargo.toml` workspace with `members = ["apps/desktop/src-tauri", "apps/mobile/src-tauri"]`.
- **Justification:** Keeps one `Cargo.lock` and one shared `target/` build cache across both Tauri apps while letting each crate maintain its own minimal dependency list and `tauri.conf.json`.

### 4. Coarse `packages/` layout first (2A)
- **Decision:** Start with four shared packages:
  - `packages/platform` (`@kalaido/platform`) — `HostAdapter` interface, shared types (`KalaidoscopeMeta`, `PersistentAppSetting`, etc.), and runtime/React host wiring. Zero Tauri deps.
  - `packages/platform-tauri` (`@kalaido/platform-tauri`) — Tauri implementation of `HostAdapter` (`plugin-store`, `plugin-clipboard-manager`, `plugin-opener`, plus optional desktop diagnostics hook).
  - `packages/platform-web` (`@kalaido/platform-web`) — Browser implementation of `HostAdapter` (`localStorage`, `navigator.clipboard`, `window.open`, JS diagnostics).
  - `packages/core` (`@kalaido/core`) — Shared UI (`components/ui`, `components/kalaido`, `components/layout`, `components/feedback`, `error-boundary`), cloud + kalaidoscope API clients, shared hooks/lib, and shared screens.
- **Justification:** Avoids fighting circular imports across prematurely split `ui` / `api` / `features` packages; those can be split later once the graph is acyclic.

### 5. Three-layer separation: Host Adapter → Shared UI/Core → Per-App State & Routing
- **Decision:**
  1. **Host Adapter:** One shared interface (`HostAdapter`) with required core capabilities and optional sub-adapters (`undefined` when unsupported) instead of runtime-throwing stubs. Purely desktop-only Rust APIs (`local-scopes`, `ollama-status`, `llm-validate`, `downloads`, `ingest-file`, `updater`, `menu:*`) stay in `apps/desktop`.
  2. **Shared UI & Core:** Shared components, API clients, hooks, and shared screens live in `packages/core`, consuming `HostAdapter` and workspace/navigation props or contexts.
  3. **Per-App Routing & Global State:** Each app owns its router, route table, lifecycle state machine, and window chrome (`TitleBar` in desktop, `keyboard-inset` in mobile, browser chrome in web).
- **Justification:** Separates host runtime (Tauri vs Browser), workspace capability (local+cloud vs cloud-only), and form factor (desktop vs mobile) cleanly.

### 6. Keep `apps/web` on existing companion routes for this pass (4A)
- **Decision:** During the restructure, `apps/web` and `apps/mobile` stay at parity with the current 5 companion routes (`splash`, `boot-error`, `CloudSignIn`, `CloudWorkspacePicker`, `ExploreCompact`). Expanding `apps/web` to full cloud workspace UI and `BrowserRouter` happens in a follow-up pass.
- **Justification:** Keeps the structural migration verifiable against existing behaviour without mixing architecture changes with product/UX design for the full web app. Desktop-only workspace screens stay in `apps/desktop` until promoted into `packages/core` for Web.

### 7. Mobile identity & per-target versioning (5A)
- **Decision:** Both `apps/desktop` and `apps/mobile` start with identifier `com.northshoresoftware.kalaido` and version `0.0.15`. Split `kalaido.sh bump` into per-target bumping (`bump:desktop` / `bump:mobile`).
- **Justification:** Preserves existing dev/APK identities while decoupling future desktop and mobile release cadences.

---

## Target Directory Layout

```text
Cargo.toml                    # Rust workspace (apps/desktop/src-tauri, apps/mobile/src-tauri)
Cargo.lock
pnpm-workspace.yaml           # packages/*, apps/*
package.json                  # root workspace scripts & shared devDependencies (Biome, TS, Vitest)
biome.json
apps/
  desktop/
    package.json              # @kalaido/desktop
    index.html
    vite.config.ts
    tsconfig.json
    src/                      # desktop router, appState, desktop-only features & Tauri commands
    src-tauri/                # macOS Tauri crate (sidecar, updater, dialog, shell, menu, etc.)
  mobile/
    package.json              # @kalaido/mobile
    index.html
    vite.config.ts
    tsconfig.json
    src/                      # mobile router, cloud-only state, keyboard-inset, mobile.css
    src-tauri/                # Android/iOS Tauri crate (clipboard-manager, opener, store only)
  web/
    package.json              # @kalaido/web (zero @tauri-apps/* deps)
    index.html
    vite.config.ts
    tsconfig.json
    src/                      # web router, cloud-only state, web.css
packages/
  platform/                   # @kalaido/platform (HostAdapter interface & context)
  platform-tauri/             # @kalaido/platform-tauri
  platform-web/               # @kalaido/platform-web
  core/                       # @kalaido/core (shared UI, cloud/kalaidoscope API, shared screens)
kalaidoscope/                 # Go backend / sidecar (unchanged)
scripts/                      # workspace-level check scripts (nav, routes, design)
```

---

## Platform & Adapter Matrix

### Shared `HostAdapter` Surface

| Capability | macOS (`platform-tauri`) | Android (`platform-tauri`) | Web (`platform-web`) |
|---|---|---|---|
| `variant` | `"desktop"` | `"mobile"` | `"web"` |
| `settings` | `plugin-store` (`kalaido-settings.json`) | `plugin-store` | `localStorage` |
| `clipboard.writeHtml` | `plugin-clipboard-manager` | `plugin-clipboard-manager` | `navigator.clipboard` |
| `openExternalUrl` | `plugin-opener` | `plugin-opener` | `window.open` |
| `diagnostics.collect` | Optional desktop provider (`invoke("get_feedback_diagnostics")`) | JS fallback (version, UA, route, no sidecar) | JS fallback (version, UA, route, no sidecar) |
| `reload` | `window.location.reload()` | `window.location.reload()` | `window.location.reload()` |

### Desktop-Only (lives in `apps/desktop/src/api/`)

- Local workspaces & Go sidecar (`local-scopes.ts`, `createSidecarClient`, `local-kalaidoscope.ts`)
- Local disk file pickers & file reading (`openFilePicker`, `saveFilePicker`, `openDirectoryPicker`, `classifyPath`, `readLocalFileFromDisk`)
- Authenticated disk download (`downloadToFile`)
- Pre-sidecar LLM validation (`llm-validate.ts`) & Ollama probe (`ollama-status.ts`)
- Native OS menu listeners (`menu:*`) & auto-updater (`updater.ts`)
- Frameless window chrome (`TitleBar`)

---

## Execution Sequence

1. **API sign-off:** Review & approve `@kalaido/platform` signatures and `@kalaido/core` shared-screen/client seams before writing code.
2. **Workspace scaffolding:** Create root `pnpm-workspace.yaml`, root `package.json`, root `Cargo.toml`, `biome.json`, and package manifests for `packages/*` and `apps/*`.
3. **Implement `packages/platform`, `packages/platform-tauri`, `packages/platform-web`.**
4. **Extract `packages/core`:** Move shared UI, `api/cloud`, `api/kalaidoscope` (decoupling `createSidecarClient` and `ingestFile` from Tauri), shared hooks/lib, and shared companion screens (`Splash`, `BootError`, `CloudSignIn`, `CloudWorkspacePicker`, `ExploreCompact`), wiring them to `@kalaido/platform`.
5. **Split `apps/desktop`, `apps/mobile`, `apps/web`:**
   - Move desktop app + desktop `src-tauri/` into `apps/desktop/` (strip `#[cfg(desktop)]` and `tauri.android.conf.json`).
   - Create lean `apps/mobile/` + mobile `src-tauri/` (3 plugins only, own `tauri.conf.json` and `capabilities/mobile.json`).
   - Create standalone `apps/web/` (zero `@tauri-apps/*` dependencies).
6. **Update tooling, scripts & CI:** Update `kalaido.sh`, `scripts/check-*`, `vitest`, and `.github/workflows/*`.
7. **Verify:** Run Biome format/lint, `tsc --noEmit` per package/app, Vitest, route/nav/design checks, desktop Vite + Rust `cargo check`, mobile Vite + Rust `cargo check`, and web Vite build.
