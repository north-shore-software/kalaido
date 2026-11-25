# React Doctor — Category 6: Structural Decomposition, Deduplication & Baseline Config

**Baseline scan:** `react-doctor` full-repo run (`42 / 100`, 138 issues total)  
**Diagnostics covered (78 total — 30 structural maintainability warnings + 48 config-baseline items):**
- **Part A — Baseline Config (`doctor.config.json`, 48 issues):**
  - `packages/react/primitives/src/shadcn/**` — **21 issues** (1 error + 20 warnings across vendored shadcn primitives)
  - Desktop route-page `only-export-components` — **26 files / 27 warnings** (`apps/desktop/src/features/*/pages/*.tsx` exporting `fooRoute = defineRoute(...)` alongside the page component)
- **Part B — Duplicated JSX Subtrees (2 warnings):**
  - `react-doctor/duplicate-jsx-subtree` — **2 warnings** (`Maintainability`)
- **Part C — Oversized / High-Complexity Components & Hooks (28 warnings across 20 files):**
  - `react-doctor/no-giant-component` — **11 warnings** (`Maintainability`, >300 LOC)
  - `react-doctor/no-high-complexity-react-function` — **17 warnings** (`Maintainability`, high cyclomatic/cognitive complexity)

---

## 1. The Anti-Patterns & Config Gaps

1. **No `doctor.config.*` baseline:**
   - Biome (`biome.json:33`) and `scripts/check-design-classes.mjs` already exclude `packages/react/primitives/src/shadcn`, because those files are upstream shadcn templates. React Doctor currently scans them and penalizes the score for 21 vendor issues (including `recharts` eager import, `carousel.tsx` cleanup, `chart.tsx` context values, etc.).
   - Desktop's route architecture intentionally co-locates `export const fooRoute = defineRoute({ ..., Component: Foo })` in `apps/desktop/src/features/*/pages/*.tsx`, accounting for 27 of the 39 `only-export-components` warnings.

2. **Cross-app and cross-feature JSX duplication (2 sites):**
   - `apps/mobile/src/app.tsx:282` and `apps/web/src/app.tsx:282` duplicate the exact same 16-node `<CloudErrorBoundary><MemoryRouter>...</MemoryRouter></CloudErrorBoundary>` tree (and likely the surrounding cloud router/error-boundary shell).
   - `packages/react/features/src/colours/components/colour-detail-pane.tsx:213` and `packages/react/features/src/projections/projection-detail-screen.tsx:401` duplicate the exact same confirmation `<AlertDialogContent>` structure.

3. **Monolithic screens and high-branching render functions (20 files):**
   - Several core screens (`ProjectionReviewScreenInner` CC=62, `StatusPage` CC=47, `KalaidoscopeSetup` CC=45, `EditNoticeCard` CC=43, `ReflectionSeriesPanel` CC=25/cog=45, `ProjectionSideRail` CC=28/cog=41) mix data orchestration, write-handler wiring, modals/dialogs, and multi-section JSX inside a single 300–800 line component.
   - Note: Executing **Categories 1–3** first will already shrink `ChatPanel`, `ProjectionDetailScreen`, `ProjectionReviewScreen`, and `OrganizingSplash` significantly — so Part C should run **after** Categories 1–5!

---

## 2. The New Codebase Patterns

### Pattern 6A — Committed `doctor.config.json` Baseline
Create a root `doctor.config.json` (aligned with `biome.json` exclusions) using `pnpm dlx react-doctor@latest rules ...` or explicit config:
- Ignore `packages/react/primitives/src/shadcn/**`.
- Decide whether to ignore `only-export-components` for `apps/desktop/src/features/*/pages/**` (matching the existing route-module convention) **or** split route definitions into `*.route.ts` files.

### Pattern 6B — Shared Confirmation Dialog & Cloud App Shell Primitives
- **Shared `ConfirmDialog` in `@kalaido/components`** (or `@kalaido/primitives/kalaido` if domain-free): replaces repeated `<AlertDialog><AlertDialogTrigger /><AlertDialogContent>...</AlertDialogContent></AlertDialog>` boilerplate across Colours, Projections, Reflections, and Settings.
- **Shared `CloudErrorBoundary` in `@kalaido/components`** (note: routing `<MemoryRouter>`/`<Routes>` MUST remain in `apps/mobile` and `apps/web` per `AGENTS.md` — `packages/*` cannot import `react-router-dom`!). If the duplicate subtree is specifically the `<Routes>` block shared by mobile and web, keep `<Routes>` in each app and deduplicate only the non-router pieces (error boundary, splash/boot/login/workspaces page wrappers).

### Pattern 6C — Thin Container + Focused Sub-Views + Action Hooks
For every giant/high-complexity screen or widget, apply one consistent decomposition shape:
1. **Extract cohesive presentational sections** into sibling components (`<FooHeader>`, `<FooToolbar>`, `<FooDialogs>`, `<FooQueueSection>`) — each with flat props and zero hidden side effects.
2. **Extract pure branching / label-mapping logic** into plain `.ts` helper modules (keeps cognitive complexity out of React render bodies and makes it unit-testable).
3. **Keep the top-level screen as a thin orchestration shell** (<200 lines, low branching): connects live reads, scope state, and write handles, then composes the sub-views.
4. **Never break `AGENTS.md` package boundaries:** single-feature sub-components stay inside `packages/react/features/src/<feature>/components/` and hooks inside `packages/react/features/src/<feature>/hooks/`.

---

## 3. File-by-File Inventory & Migration Plan

### 3.1 Part A — Baseline Config (`doctor.config.json`)
- Ignore `packages/react/primitives/src/shadcn/**` (eliminates 21 vendor issues, incl. 1 error).
- Configure `only-export-components` decision for `apps/desktop/src/features/*/pages/*.tsx` (27 warnings).

### 3.2 Part B — Deduplication (2 warnings)
| File(s) | Line(s) | Planned Change |
|---|---|---|
| `packages/react/features/src/colours/components/colour-detail-pane.tsx` & `packages/react/features/src/projections/projection-detail-screen.tsx` | 213 & 401 | Extract a reusable `ConfirmDeleteDialog` / `ConfirmDialog` component in `@kalaido/components` (or `@kalaido/primitives/kalaido`) and adopt it at both sites. |
| `apps/mobile/src/app.tsx` & `apps/web/src/app.tsx` | 282 & 282 | Remember `AGENTS.md`: `apps/mobile` and `apps/web` cannot import from each other, and `packages/*` cannot import `react-router-dom`. Extract shared `CloudErrorBoundary` to `@kalaido/components` and evaluate whether the 6-route `<Routes>` list should remain duplicated (intentional per-app routing) or share a declarative route table config. |

### 3.3 Part C — Decomposition Targets (Prioritized by Severity / Complexity)

**Tier 1 — Highest complexity & size (both `no-giant-component` and `no-high-complexity-react-function`):**
| File | Component | Metrics | Suggested Split |
|---|---|---|---|
| `packages/react/features/src/projections/projection-review-screen.tsx` | `ProjectionReviewScreenInner` | >300 LOC, CC=62, Cog=61 | Split into: `useProjectionReviewActions` hook (approve/discard/edit/wave handlers) + `<ReviewHeaderBar>`, `<OutdatedCandidateBanner>`, `<ReviewDialogs>` + thin shell. |
| `apps/desktop/src/features/status/pages/Status.tsx` | `StatusPage` | >300 LOC, CC=47, Cog=46 | Split into `<PipelineStatusCard>`, `<QueueSection>`, `<IndexingActionsCard>`, `<DiagnosticsSection>`. |
| `apps/desktop/src/features/create-kalaidoscope/pages/KalaidoscopeSetup.tsx` | `KalaidoscopeSetup` | >300 LOC, CC=45, Cog=41 | Split step panels (`<LocationStep>`, `<ProviderStep>`, `<NameAndIconStep>`) + move validation helpers to `.ts`. |
| `packages/react/features/src/projections/projection-detail-screen.tsx` | `ProjectionDetailScreen` | >300 LOC, CC=25, Cog=25 | Split empty-state authoring view (`<ProjectionAuthoringView>`) from live/historical viewer (`<ProjectionSnapshotView>`) + header actions. |
| `packages/react/features/src/reflections/reflection-refine-screen.tsx` | `ReflectionRefineScreen` | >300 LOC, CC=24, Cog=24 | Split schedule/cadence bar, preview pane wiring, and commit/discard header into focused sub-components. |
| `packages/react/components/src/chat-panel.tsx` | `ChatPanel` | >300 LOC, CC=21, Cog=19 | Re-measure after Categories 1 & 3; extract `<ChatComposer>` (textarea, submit, trailing, context bar, meter) and `<QuotaBanner>`. |

**Tier 2 — High-complexity functions (not >300 LOC, but deeply branched):**
| File | Function | Metrics | Suggested Split |
|---|---|---|---|
| `packages/react/components/src/chat-messages.tsx` | `EditNoticeCard` | CC=43, Cog=51, depth=5 | Split into per-notice-kind renderers or lookup map + small action bar component. |
| `packages/react/features/src/reflections/components/reflection-series-panel.tsx` | `ReflectionSeriesPanel` | CC=25, Cog=45, depth=5 | Extract individual series entry row + status/retry controls. |
| `packages/react/features/src/projections/components/projection-side-rail.tsx` | `ProjectionSideRail` | CC=28, Cog=41, depth=3 | Extract per-section cards (sources, history list, metadata/status). |
| `packages/react/features/src/projections/components/snapshot-preview.tsx` | `SnapshotPreview` | CC=16, Cog=24, depth=4 | Extract preview state switch (loading / error / diff / rendered) into small sub-views. |
| `apps/desktop/src/features/settings/components/kalaidoscope-row.tsx` | `KalaidoscopeRow` | CC=17, Cog=24, depth=4 | Extract row action menu / status badge sub-component. |
| `packages/react/features/src/projections/components/projection-draft-editor.tsx` | `ProjectionDraftEditor` | CC=20, Cog=23, depth=3 | Extract draft toolbar & diff/edit action bar. |
| `packages/react/components/src/fragment-drawer.tsx` | `FragmentDrawer` | CC=13, Cog=17, depth=3 | Extract drawer header actions + body content renderer. |
| `packages/react/features/src/map/map-screen.tsx` | `MapScreen` | CC=15, Cog=17, depth=2 | Extract `<ThingsSection>` and `<RelationshipsSection>`. |
| `packages/react/features/src/rotation/components/active-rotation-card.tsx` | `ActiveRotationCard` | CC=15, Cog=17, depth=2 | Extract status/CTA derivation helper into `.ts`. |
| `packages/react/features/src/reflections/components/live-preview-pane.tsx` | `LivePreviewPane` | CC=8, Cog=16, depth=4 | Flatten nested conditional renders with early-return sub-components. |
| `packages/react/components/src/context-meter/use-prompt-estimate.ts` | `usePromptEstimate` | CC=16, Cog=13, depth=1 | Extract pure estimate computation / fallback helper into `.ts`. |

**Tier 3 — Giant components (>300 LOC, low cyclomatic complexity):**
| File | Component | Suggested Split |
|---|---|---|
| `apps/desktop/src/features/onboarding/components/organizing-splash.tsx` | `OrganizingSplash` | Move canvas animation engine (`runSplashLoop`) into a sibling `.ts` module; keep React component thin. |
| `packages/react/features/src/colours/components/colour-detail-pane.tsx` | `ColourDetailPane` | Extract `<ColourPromptEditor>` and `<ColourExamplesSection>`. |
| `packages/react/features/src/explore/explore-screen.tsx` | `ExploreScreen` | Extract conversation sidebar/list and active chat pane wrapper. |
| `packages/react/features/src/explore/explore-compact-screen.tsx` | `ExploreCompactScreen` | Extract compact conversation picker drawer/sheet and header. |
| `packages/react/features/src/fragments/stream-screen.tsx` | `StreamScreen` | Extract filter/search bar and timeline day-group list. |

---

## 4. Open Decisions

1. **Baseline `doctor.config.json` scope (recommend deciding *before* starting Categories 1–5 so progress is easy to measure):**
   - Ignore `packages/react/primitives/src/shadcn/**`? **(Recommended: Yes — aligns with Biome & `check-design-classes.mjs`.)**
   - For desktop `apps/desktop/src/features/*/pages/*.tsx` `only-export-components` (27 warnings):
     - **Option A (Recommended):** Exclude `apps/desktop/src/features/*/pages/**` from `only-export-components` in `doctor.config.json` (preserves Kalaido's co-located route-definition convention).
     - **Option B:** Split every desktop page into `Foo.tsx` (component) + `foo.route.ts` (`defineRoute(...)`).
2. **`apps/mobile/src/app.tsx` vs `apps/web/src/app.tsx` duplicate `<Routes>` tree:**
   - Extract `CloudErrorBoundary` to `@kalaido/components` and leave the 6 `<Route>` entries in each app (per `AGENTS.md`'s no-router-in-packages rule), or also tune/ignore that single `duplicate-jsx-subtree` finding?
3. **Decomposition scope (Part C):**
   - **Option A:** Tackle **Tier 1** first (the 6 highest-complexity giant screens), re-check score, then decide on Tiers 2–3.
   - **Option B:** Work through all 3 tiers wave-by-wave (Tier 1 → Tier 2 → Tier 3) to reach `0` maintainability warnings.
   - **Option C:** Defer Part C for now and focus on Categories 1–5 + Part A/B.

---

## 5. Verification

- Run `./kalaido.sh test:ts && ./kalaido.sh check:ts` (including `check:boundaries`, `check:nav`, `check:design`, `check:routes`) after each tier.
- Re-run `pnpm dlx react-doctor@latest . --verbose --yes` and verify score progression toward **95–100 / 100**.
