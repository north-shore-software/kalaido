# React App Restructure Plan

Status: **Draft — architecture in progress**

## Goal

Run a browser-hosted, cloud-only web version of Kalaido alongside the existing macOS desktop and Android mobile Tauri apps, with clear structural boundaries so each target only ships and depends on what it actually supports.

## Current Baseline (Verified in Repo)

- Single frontend package at `app/` with three Vite entry points (`index.html`, `mobile.html`, `web.html`) switched via `APP_TARGET` / `TAURI_ENV_PLATFORM` in `app/vite.config.ts`.
- `app/web.html` (`app/src/web/main.tsx`) currently mounts `CompanionRouter` (the same 5-route shell as mobile: `splash`, `boot-error`, `CloudSignIn`, `CloudWorkspacePicker`, `ExploreCompact`).
- `app/src-tauri/` builds both macOS and Android via `tauri.macos.conf.json`, `tauri.android.conf.json`, and `capabilities/{desktop,mobile}.json`.
- In `app/src-tauri/src/lib.rs`, **all** custom Rust `invoke` commands, the Go PocketBase sidecar (`plugin-shell`), `plugin-dialog`, `plugin-updater`, and native menus are `#[cfg(desktop)]`. Android registers only 3 plugins (`clipboard-manager`, `opener`, `store`) and zero custom Rust commands.
- All `@tauri-apps/*` imports in TypeScript are isolated to 9 files in `app/src/api/app/`.
- Known coupling points to untangle:
  - `app/src/routes/registry.ts` statically imports every desktop page, pulling desktop screens into `dist-web` even through `CompanionRouter`.
  - `app/src/routes/use-app-navigate.ts` and `app/src/hooks/use-active-kalaidoscope.ts` bind directly to `registry.ts` and desktop `appState` (`AppStage`).
  - `app/src/routes/route-kit.ts` (`stageEntryRoute`) branches on `appVariant() === "desktop"` vs everything else, forcing `web` onto `"explore"`.
  - `app/src/api/kalaidoscope/ingest.ts` takes a disk `path` and calls `readLocalFileFromDisk` (Rust) even though it ultimately uploads a `Blob` in `FormData`.
  - `app/src/features/settings/components/workspace-backups-panel.tsx` uses `saveFilePicker` + Rust `downloadToFile` rather than a host download adapter.
  - `app/src/api/app/feedback.ts` calls `invoke("get_feedback_diagnostics")` unconditionally, but that command is `#[cfg(desktop)]` in `app/src-tauri/src/lib.rs`.

---

## Decisions Made

### 1. Monorepo workspace layout (`apps/` + `packages/`) over in-place `app/` or sibling `web/`
- **Decision:** Move to a pnpm workspace with distinct `apps/*` and shared `packages/*` (Option 3), skipping a temporary sibling `web/` beside `app/` (Option 4).
- **Justification:**
  - Enforces hard dependency boundaries via `package.json` (`apps/web` never depends on `@tauri-apps/*`).
  - Gives `apps/web` independent build, routing, and deployment config.
  - Option 4 would still require setting up pnpm workspaces and extracting `packages/*`, then paying a second migration cost later to move `app/` and rewire `kalaido.sh` / CI.

### 2. Two Tauri apps (`apps/desktop` and `apps/mobile`) instead of one shared `src-tauri/`
- **Decision:** Separate `apps/desktop/` (macOS) and `apps/mobile/` (Android, and future iOS) into two Tauri apps alongside `apps/web/`.
- **Justification:**
  - macOS and Android currently share zero lines of custom Rust and only 3 one-line plugin registrations (`clipboard-manager`, `opener`, `store`).
  - Mobile is an important independent product target with a different distribution pipeline, signing/store rules (e.g. `macos-private-api` vs store compliance), release cadence, and versioning from macOS DMG/updater releases.
  - Gives complete structural symmetry across `apps/desktop`, `apps/mobile`, and `apps/web`: each is a single-entry Vite project with its own `package.json`, `tsconfig.json`, and (where native) clean `src-tauri/` free of `#[cfg(desktop)]` and `tauri.*.conf.json` override layers.
  - Eliminates `APP_TARGET` / `TAURI_ENV_PLATFORM` entry-switching in Vite.

### 3. Three-layer architecture: Host Adapter → Shared UI/Core → Per-App State & Routing
- **Decision:** Structure code around three conceptual layers:
  1. **Host Adapter (`HostAdapter`):** One shared interface exposing host-provided capabilities. Required core methods are implemented on every platform; platform-restricted capabilities are modeled as optional sub-adapters (`undefined` when unsupported) rather than runtime-throwing stubs, so TypeScript enforces capability checks at call sites. Purely desktop-only APIs (`local-scopes`, `ollama-status`, `llm-validate`, native `menu:*` listeners) stay inside `apps/desktop` and do not need to live on the shared interface.
  2. **Shared UI & Core:** Shared design-system components, API clients (`cloud`, `kalaidoscope`), hooks, and whole shared screens.
  3. **Per-App Routing & Global App State (not shared):** Each app owns its bootstrap/lifecycle state machine (e.g. desktop local-sidecar `AppStage` vs web URL-driven cloud auth), router (`MemoryRouter` vs `BrowserRouter`), route table, and window chrome (`TitleBar`, `keyboard-inset`, sidebar composition).
- **Justification:**
  - Prevents conflating *host runtime* (Tauri vs Browser) with *workspace capability* (local+cloud vs cloud-only) or *form factor* (desktop vs mobile) — Android is Tauri + cloud-only + mobile, while Web is Browser + cloud-only + desktop/responsive.
  - Keeps shared screens decoupled from desktop-specific boot flow and `registry.ts`. Shared screens interact with active workspace state, UI overlays, and navigation through thin shared contracts/contexts (or props) supplied by each app shell.

---

## Target Top-Level Shape

```text
apps/
  desktop/       # Vite + src-tauri/ (macOS, Go sidecar, local + cloud, full UI)
  mobile/        # Vite + src-tauri/ (Android/iOS, 3 Tauri plugins, cloud-only, compact UI)
  web/           # Vite (browser, cloud-only, zero @tauri-apps/* deps)
packages/
  ...            # shared host contract, adapters, UI, API clients, shared screens (granularity TBD)
kalaidoscope/    # Go backend / sidecar (unchanged)
```

---

## Platform & Adapter Matrix

### Host Adapters (shared interface, implemented per host)

| Capability | Current module(s) | macOS (`apps/desktop`) | Android (`apps/mobile`) | Web (`apps/web`) |
|---|---|---|---|---|
| Settings KV store | `api/app/settings.ts` | `plugin-store` | `plugin-store` | `localStorage` |
| Clipboard (HTML + text) | `api/app/os-integrations.ts` | `plugin-clipboard-manager` | `plugin-clipboard-manager` | `navigator.clipboard` |
| Open external URL | `api/app/os-integrations.ts` | `plugin-opener` | `plugin-opener` | `window.open` |
| Cloud auth session | `api/cloud/auth.ts` | Bearer token in `localStorage` | Bearer token in `localStorage` | Bearer in `localStorage` (or cookies later) |
| File import (optional) | `os-integrations.ts`, `ingest-file.ts`, `ingest.ts` | `plugin-dialog` + Rust `classify_path` / `read_file_bytes` | Optional / `<input type="file">` | `<input type="file">` / drag-drop → `File`/`Blob` |
| Authenticated download (optional) | `os-integrations.ts`, `downloads.ts` | `saveFilePicker` + Rust `download_to_file` | Optional | `fetch` + auth headers → `Blob` → `<a download>` |
| Feedback diagnostics | `api/app/feedback.ts` | Rust `get_feedback_diagnostics` | JS fallback (version, UA, route) | JS fallback (version, UA, route) |
| Reload window | `api/app/os-integrations.ts` | `window.location.reload()` | `window.location.reload()` | `window.location.reload()` |

### Desktop-Only (stays in `apps/desktop`, omitted from `apps/mobile` and `apps/web`)

- Local workspaces & Go PocketBase sidecar (`api/app/local-scopes.ts`, `lib/local-kalaidoscope.ts`)
- Local workspace directory/file pickers (`openDirectoryPicker`, `OnboardingLanding`)
- Pre-sidecar LLM key validation (`api/app/llm-validate.ts`)
- Local Ollama detection (`api/app/ollama-status.ts`)
- Native OS menu event listeners (`menu:*` in `routes/router-listeners.tsx`)
- Auto-updater (`api/app/updater.ts`, `plugin-updater`)
- Frameless window chrome (`TitleBar`, `data-tauri-drag-region`)

---

## Open Decisions (Not Yet Made)

1. **`packages/` granularity**
   - *Coarse first:* `packages/platform` (interfaces + shared contexts), `packages/platform-tauri`, `packages/platform-web`, and one `packages/core` (UI + API + hooks + shared screens).
   - *Fine upfront:* split `packages/ui`, `packages/api`, `packages/features` immediately.
2. **Rust workspace**
   - *Root Cargo workspace* (`members = ["apps/desktop/src-tauri", "apps/mobile/src-tauri"]`) sharing one `Cargo.lock` and `target/` cache.
   - *Independent Cargo crates* per Tauri app (separate `Cargo.lock` and `target/`).
3. **`apps/web` feature scope & routing**
   - Which routes/screens Web exposes (full cloud workspace UI vs a smaller subset).
   - `BrowserRouter` (deep-linkable URLs, browser history) vs `MemoryRouter`.
   - Whether Web keeps Bearer-in-`localStorage` auth or moves to cookie auth.
4. **Migration sequence**
   - *Seams first inside `app/src/`:* introduce `HostAdapter` and decouple shared screens from `registry.ts` / `appState` before moving directories and updating `kalaido.sh` / CI.
   - *Workspace first:* scaffold `apps/` + `packages/` upfront and migrate directly.
5. **Tooling & CI updates (follows from above)**
   - Root `pnpm-workspace.yaml` / scripts, Biome, Vitest, `check:nav` / `check:routes` / `check:design`.
   - `kalaido.sh` commands (`dev`, `dev:android`, `dev:web`, `build:*`, `gen:types`, `bump` per target, `check:*`).
   - `.github/workflows/` (`pr.yml`, `build-desktop.yml`, `release-desktop.yml`, `react-doctor.yml`, plus future web/mobile workflows).
