# AGENTS.md

Repository guide and working rules for agents in Kalaido.

## Working Discipline

- **You do not make decisions:** Never choose product behaviour, technical choices with user-visible impact, architecture (boundaries, schemas, dependencies, layout), or scope. Propose options freely; adopt nothing without human direction. When in doubt, stop and ask — the interruption is cheaper than rework.
- **Stop on out-of-scope discoveries:** If you notice a bug or broken assumption outside the current task, stop mid-task and report it. Do not fix it "while you're in there" or "because it blocks the task."
- **Do the minimum:** Solve exactly what was asked with the smallest diff that works. No adjacent refactors, no preamble, no recap, no restating the request, and no re-reading or re-verifying what a tool already confirmed. Drop padding, never signal.
- **No git operations:** Never run `git add`, `commit`, `branch`, `checkout`, `stash`, `merge`, `rebase`, `push`, `tag`, or create PRs unless explicitly authorized for that session. Edit the working tree only.
- **Honest reporting:** State in full what you did and did not do. If something failed, say so and show the output. If you could not verify it, say so. If you broke a rule here, stop, state exactly what changed, and do not revert it yourself.

## Repository Layout

Kalaido is a pnpm + Cargo workspace with a Go PocketBase backend (`kalaidoscope/`):

```text
├── Cargo.toml                  # Rust workspace: apps/desktop/src-tauri, apps/mobile/src-tauri
├── pnpm-workspace.yaml         # brand, packages/lib/*, packages/react/*, apps/*
├── biome.json                  # Format, lint, and import-boundary rules
├── kalaido.sh                  # Entrypoint for all dev, build, check, test, and bump commands
├── scripts/                    # Boundary, navigation, design-class, and route checks
├── brand/                      # @kalaido/brand (static brand assets: logo marks, wordmarks)
├── packages/
│   ├── lib/                    # Pure TypeScript — ZERO React, ZERO import.meta.env
│   │   ├── platform/           # @kalaido/platform (exports: ".", "./tauri", "./web")
│   │   └── client/             # @kalaido/client (cloud auth/registry, PocketBase clients, pure utils)
│   └── react/                  # React layer
│       ├── primitives/         # @kalaido/primitives — only @kalaido/brand (tokens, shadcn/, stateless UI)
│       ├── state/              # @kalaido/state — zero @kalaido/* deps (scope, persistence, live reads, paired writes, PB SSE hub)
│       ├── hooks/              # @kalaido/hooks (HostProvider, workspace & scope contexts, Kalaido live/persistence bridges, shared data hooks)
│       ├── components/         # @kalaido/components (reusable domain widgets across 2+ features or app chrome)
│       └── features/           # @kalaido/features (default home for portable vertical feature slices)
├── apps/
│   ├── desktop/                # @kalaido/desktop (macOS Tauri + Go sidecar, local + cloud, full UI)
│   ├── mobile/                 # @kalaido/mobile (Android/iOS Tauri, 3 plugins, cloud-only)
│   └── web/                    # @kalaido/web (Browser SPA, cloud-only, ZERO @tauri-apps/* deps)
└── kalaidoscope/               # Go PocketBase backend / sidecar
```

## Dependency Graph & Cross-Package Invariants

Dependencies flow strictly one way:

```text
platform ──► client ──► hooks ──► components ──► features ──► apps/*
state (zero @kalaido/* deps) ──► hooks ──► components ──► features ──► apps/*
primitives (only @kalaido/brand) ──► components ──► features ──► apps/*
brand ──► primitives, components
```

Hard invariants (enforced by `biome.json`, `scripts/check-boundaries.mjs`, `scripts/check-navigation-discipline.mjs`, and `tsc --noEmit`):

- **No React in `packages/lib/*`:** no `react`, `react-dom`, `better-auth/react`, or `.tsx` files.
- **No `import.meta.env` in `packages/lib/*`:** no `vite/client` in `packages/lib/*/tsconfig.json`. Apps read env vars in `main.tsx` and pass them into `configureClient(...)`.
- **No `@kalaido/*` deps in `packages/react/primitives` except `@kalaido/brand`:** primitives must remain domain-free; external side-effects (such as opening links in `MarkdownContent`) are passed in via callback props.
- **No `@tauri-apps/*` outside Tauri hosts:** allowed only in `packages/lib/platform/src/tauri.ts` (optional peerDeps), `apps/desktop/`, and `apps/mobile/`. Never in `platform/src/{index,web}.ts`, `client`, `packages/react/*`, or `apps/web/`.
- **No `react-router-dom` in `packages/*`:** routing and route tables belong exclusively in `apps/*`. Shared components and features accept navigation callbacks as props.
- **No `@/` aliases in `packages/*`:** internal package imports use package-scoped `#*` subpath `"imports"` (`"#*": "./src/*"`). Only `apps/*` map `@/*` to their own `src/`.
- **No relative cross-package imports:** never import across package boundaries with `../..` (except test fixtures under `kalaidoscope/`).
- **No cross-app imports:** `apps/desktop`, `apps/mobile`, and `apps/web` never import from each other.
- **Source-consumed (JIT) packages with extensionless `exports`/`imports`:** `packages/*` export `./src/*` directly with no `dist/` build step. Do not use wildcard patterns with `.ts`/`.tsx` suffixes (e.g. `"./*.ts": "./src/*.ts"`) in `package.json` `exports`/`imports` — Vite's resolver treats the `.` unescaped and breaks extensionless filenames ending in `ts` (such as `fragments`).

## Per-Package Rules

| Package | Allowed `@kalaido/*` deps | Belongs here | Does NOT belong here |
|---|---|---|---|
| `brand` | None | Static brand assets (logo marks, wordmarks) consumed by `primitives`, `components`, and repo docs. | Code, any dependency. |
| `packages/lib/platform` | None | `HostAdapter` interface, shared cross-layer types (`KalaidoscopeMeta`, `PersistentAppSetting`, `FeedbackDiagnostics`), `setHost`/`getHost`, `./tauri` (`createTauriHost`), `./web` (`createWebHost`). | React, PocketBase, domain APIs, desktop-only Tauri plugins (`dialog`, `shell`, `updater`, custom Rust `invoke`s). `@tauri-apps/*` only in `src/tauri.ts`. |
| `packages/lib/client` | `platform` | `better-auth/client`, cloud workspace registry API, PocketBase cloud & `local_net` clients, generated `kalaidoscope/types.ts`, Blob-based `ingestFile`, lazy `configureClient(...)` + accessors (`getAuthClient`, `getAuthUrl`, `getCloudPbUrl`, `getPosthogConfig`), pure domain/text utils, PostHog wrapper. | React, `better-auth/react`, hooks, `import.meta.env`, eager module-scope client/config initialization, `@tauri-apps/*`, disk paths, sidecar IPC. |
| `packages/react/primitives` | `brand` | `src/index.css` (tokens + Tailwind theme + `@source "./";` + streamdown `@source`), `lib/{css-utils,theme}.ts`, `hooks/use-mobile.ts`, `shadcn/` + `components.json`, stateless visual primitives (`kalaido/*`, `layout/*`), `ThemeProvider`. | Any `@kalaido/*` package except `brand`, PocketBase, `better-auth`, AI SDK, `swr`, `valtio`, `react-router-dom`, `@tauri-apps/*`, domain concepts, global app state. |
| `packages/react/state` | None | Domain-agnostic React state primitives: `./scope` (`createScope`, `useScope`, `useScopeState`, `persist` controller), `./live` (`useLiveRead`, `useExternalWrite`, `httpLiveSource`, `atomLiveSource`, tag/cache registry), `./pocketbase` (`pbCollectionSource`, `pbEndpointSource`, ref-counted SSE hub, optional `pocketbase` peerDep). | Any `@kalaido/*` dependency, `better-auth`, `@ai-sdk/react`, `ai`, `react-router-dom`, `@tauri-apps/*`, Kalaido domain schemas or app-specific state. |
| `packages/react/hooks` | `platform`, `client`, `state` | App-wide contexts (`HostProvider`/`useHost`, `KalaidoscopeClientContext`, `ActiveKalaidoscopeContext`, `createScopeContext`), Kalaido bridges (`kalaidoscope-live`, `scope-persistence`), `cloud-root-scope`, `useCloudSession`, `useCloudWorkspaces`, core PocketBase live hooks (`useLiveCollection`), and domain hooks reused across **2+ features or packages**. | Single-feature hooks (belong in `packages/react/features/src/<feature>/hooks/`), pure cross-feature helpers/parsers (belong in `@kalaido/client`), UI components (beyond bare context providers), `swr`, `valtio`, `better-auth`, `react-router-dom`, `@tauri-apps/*`, app-specific `AppStage`. |
| `packages/react/components` | `brand`, `platform`, `client`, `primitives`, `state`, `hooks` | `src/styles.css` (`@source "./";`), domain-connected widgets reused across **2+ features** or app chrome (`ChatPanel`, `ContextPicker`, `FeedbackDialog`, `FragmentDrawer`, `PageHeader`, `CloudAuthPanel`, `RecoveryView`, `SplashScreen`, `CoreProviders`, host-wired `MarkdownContent`). | `swr`, `valtio`, `better-auth`, `react-router-dom`, `@tauri-apps/*`, app-specific `appState`/`AppStage`, single-feature-only UI. |
| `packages/react/features` | `platform`, `client`, `primitives`, `state`, `hooks`, `components` | `src/styles.css` (`@source "./";`), **default home** for vertical feature slices — any feature that does not require platform-only capabilities belongs here even if only one app mounts it today (each directory owns its components, `hooks/use-*.ts`, and screen views, exposed via its `./<feature>` barrel and decoupled from routing/app state via props/callbacks, e.g. `explore/`, `auth/`, `colours/`, `projections/`). | `swr`, `valtio`, `better-auth`, `react-router-dom`, `@tauri-apps/*`, platform-bound features (sidecar/local-workspace/Ollama/updater/native-dialog logic), app-specific `AppStage`, deep hook subpath exports in `package.json`. |
| `apps/desktop` | Any `packages/*` | Thin platform shell & genuinely desktop-only code: desktop router & `registry.ts`, thin route/`PageLayout` wrappers around `@kalaido/features/*`, desktop `state/` (`appState`/`AppStage`), `host.ts` (`@kalaido/platform/tauri` + Rust diagnostics), desktop-only `api/app/*` (`local-scopes`, `sidecar-client`, `downloads`, `ingest-file`, `llm-validate`, `ollama-status`, `updater`, `feedback`, dialogs, `menu:*`), desktop chrome (`TitleBar`, `NavSidebar`, `UtilityBar`, `PageLayout`), platform-bound desktop features (local sidecar/Ollama/updater flows), macOS `src-tauri/`. | Portable feature UI/hooks that can live in `packages/react/*`, non-hook state inside `hooks/`, mobile/web entrypoints, `#[cfg(mobile)]`, Android Tauri config. |
| `apps/mobile` | Any `packages/*` | Mobile router, cloud-only state, `host.ts` (`@kalaido/platform/tauri`), `keyboard-inset.ts`, `mobile.css`, mobile-only `src-tauri/` (`clipboard-manager`, `opener`, `store` only). | Desktop Tauri plugins (`dialog`, `shell`, `updater`), `macos-private-api`, sidecar/local-workspace code, desktop routes. |
| `apps/web` | Any `packages/*` except `@kalaido/platform/tauri` | Web router, cloud-only state, `host.ts` (`@kalaido/platform/web`), `web.css`, web deploy config. | Any `@tauri-apps/*` dep or import, sidecar/local-workspace code, desktop-only screens. |

## Key Architectural Conventions

- **Shared by default:** Put new product features, screens, hooks, and widgets in `packages/react/*` by default — even when only one app mounts them initially — keeping them decoupled from `react-router-dom` and app-specific `appState` via props/callbacks (and small capability adapters like `ImportAdapter` when a feature needs a platform operation). Keep code in `apps/<platform>` only when it owns app wiring/routing/chrome or requires platform-specific capabilities (e.g. sidecar, local filesystem, Ollama, Tauri dialogs/updater, mobile keyboard insets).
- **Hook placement & layout:** Put cross-feature and app-wide hooks in `packages/react/hooks/src/`; put single-feature hooks in `packages/react/features/src/<feature>/hooks/use-*.ts` (exposed only through the feature's `./<feature>` barrel, never deep hook subpath exports); keep widget-coupled hooks co-located in `packages/react/components/src/` and domain-free UI/DOM hooks in `packages/react/primitives/src/`; put pure parsers/helpers shared outside one feature in `packages/lib/client`; keep only actual platform-bound React hooks in `apps/<platform>/src/hooks/` (put root `@kalaido/state` scopes and other non-hook global state in `state/` or `state.ts`).
- **Startup wiring (`main.tsx`):** Every app initializes `setHost(createAppHost())` and `configureClient({ authUrl, cloudPbUrl, posthog? })` before rendering, and wraps the tree in `<HostProvider host={host}>`. Each app's `vite.config.ts` enforces `requireCloudEnv()` at build time.
- **Desktop-only Tauri IPC:** Keep desktop-only Rust commands and wrappers inside `apps/desktop/src/api/app/` and `apps/desktop/src-tauri/`. Do not add desktop-only capabilities to `@kalaido/platform` unless multiple platforms need the contract (in which case model them as optional sub-adapters, not runtime-throwing stubs).
- **Tailwind v4 `@source` stylesheets:** Tailwind v4 does not auto-scan symlinked workspace packages. `packages/react/primitives/src/index.css`, `packages/react/components/src/styles.css`, and `packages/react/features/src/styles.css` each declare `@source "./";`, and each app's entry CSS `@import`s them.
- **shadcn components:** Live in `packages/react/primitives/src/shadcn/` (configured in `packages/react/primitives/components.json` with `#shadcn` and `#lib/css-utils`). Excluded from Biome lint and `check-design-classes.mjs`.
- **Generated PocketBase types:** `packages/lib/client/src/kalaidoscope/types.ts` is generated from `kalaidoscope/` schema via `./kalaido.sh gen:types`. Never hand-edit it; `./kalaido.sh check:schema-freshness` verifies it matches.
- **Desktop navigation discipline:** Inside `apps/desktop/src/`, never import raw `react-router-dom` navigation hooks/components (`useNavigate`, `Link`, `useParams`, etc.) outside `apps/desktop/src/routes/`. Use declared transitions (`useAppNavigate`, `RouteLink`).
- **Design radius rule:** Zero border radius everywhere outside `packages/react/primitives/src/shadcn/` (`rounded-none`, `rounded-full`, or arbitrary `rounded-[…]` only; enforced by `check-design-classes.mjs`).
- **Versioning:** Desktop (`Kalaido`) and mobile (`kalaido-mobile`) version independently via `./kalaido.sh bump:desktop` and `./kalaido.sh bump:mobile`.

## Commands & Checks

Always run repo tasks through `./kalaido.sh` (it exports `VITE_BETTER_AUTH_URL` and `VITE_CLOUD_PB_URL`):

- `./kalaido.sh check:ts` — Biome format + lint (including import boundary rules), `check:boundaries`, `check:nav`, `check:design`, `check:routes`, `pnpm -r typecheck`, and production builds for `desktop`, `mobile`, and `web`.
- `./kalaido.sh test:ts` — Vitest across `packages/` and `apps/`.
- `./kalaido.sh fmt:ts` — Biome format `--write`.
- `./kalaido.sh check:go` / `./kalaido.sh test:go` / `./kalaido.sh check:schema-freshness` — Go backend checks and schema typegen freshness.
- `./kalaido.sh check:rust` / `./kalaido.sh test:rust` — `cargo fmt --check`, `cargo clippy --workspace`, `cargo test --workspace`.
- `./kalaido.sh dev` / `dev:web` / `dev:android` — Run desktop, web, or Android dev targets.
- `./kalaido.sh build:app` / `build:web` / `build:android` — Build targets.

## Sub-Project Routing

When working inside these areas, also read and follow their local instructions:

- **UI & design system:** `apps/desktop/AGENTS.md` and `apps/desktop/DESIGN.md`
- **Go backend & generated audit docs:** `kalaidoscope/AGENTS.md`
