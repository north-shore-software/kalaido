# React Doctor — Category 6: Structural Decomposition, Deduplication & Baseline Config

**Baseline scan:** `react-doctor` v0.9.23 full-repo run (`42 / 100 Critical`, 138 issues across 488 scanned files: 11 errors, 127 warnings)  
**Diagnostics covered (77 total — 30 structural maintainability warnings + 47 config-baseline items):**
- **Part A — Baseline Config (`doctor.config.json`, 47 issues):**
  - `packages/react/primitives/src/shadcn/**` — **21 issues** across 55 vendored shadcn files (1 error: `effect-needs-cleanup` in `carousel.tsx:93`; 20 warnings: `only-export-components` ×6, `no-array-index-as-key` ×3, `jsx-no-constructed-context-values` ×3, `prefer-tag-over-role` ×2, `no-pass-live-state-to-parent` ×1, `no-prop-callback-in-effect` ×1, `no-pass-data-to-parent` ×1, `prefer-dynamic-import` ×1, `rerender-memo-before-early-return` ×1, `no-redundant-roles` ×1)
  - Desktop route-page `only-export-components` — **25 files / 26 warnings** (`apps/desktop/src/features/*/pages/*.tsx` exporting `fooRoute = defineRoute(...)` alongside the page component; `ReflectionRefine.tsx` exports both `newReflectionRoute` and `refineReflectionRoute`)
- **Part B — Duplicated JSX Subtrees (2 warnings):**
  - `react-doctor/duplicate-jsx-subtree` — **2 warnings** (`Maintainability`; hardcoded thresholds: `minimumNodeCount: 6`, `minimumDepth: 3`, `minimumOccurrences: 2`)
- **Part C — Oversized / High-Complexity Components & Hooks (28 warnings across 20 files):**
  - `react-doctor/no-giant-component` — **11 warnings** (`Maintainability`; hardcoded threshold: component function AST span `> 300` lines)
  - `react-doctor/no-high-complexity-react-function` — **17 warnings** (`Maintainability`; hardcoded threshold: `cyclomatic > 15` **or** `cognitive > 15` on any React component or `use*` hook; `maxNestingDepth` is informational only)

> **Exact Cross-Plan Diagnostic Accounting (`138 / 138`):** Category 1 (`8`) + Category 2 (`8`) + Category 3 (`21`) + Category 4 (`5`) + Category 5 (`19`, incl. 7 non-route `only-export-components` across 6 files) + Category 6 (`77` = `47` Part A + `2` Part B + `28` Part C) = **138 baseline issues**.

---

## 1. The Anti-Patterns & Config Gaps

1. **No `doctor.config.*` baseline (and monorepo path-matching pitfall):**
   - Biome (`biome.json:33`) and `scripts/check-design-classes.mjs` already exclude `packages/react/primitives/src/shadcn` because those files are upstream shadcn templates. Without a `doctor.config.json`, React Doctor scans all 55 files and reports 21 vendor diagnostics.
   - Desktop's route architecture co-locates `export const fooRoute = defineRoute({ ..., Component: Foo })` in `apps/desktop/src/features/*/pages/*.tsx`, accounting for 26 of the 39 `only-export-components` warnings (`apps/desktop/src/routes/registry.ts` is the sole importer of all 26 `*Route` symbols).
   - **Monorepo path-matching constraint (empirically verified):** `react-doctor . --yes` scans 9 workspace projects (`kalaido-workspace`, `@kalaido/components`, `@kalaido/features`, `@kalaido/hooks`, `@kalaido/primitives`, `@kalaido/state`, `@kalaido/desktop`, `@kalaido/mobile`, `@kalaido/web`). Both `ignore.files` and `ignore.overrides[].files` match paths **relative to each scanned sub-project directory** (e.g. `src/shadcn/**` in `@kalaido/primitives`, `src/features/*/pages/*.tsx` in `@kalaido/desktop`) — root-only prefixes like `"packages/react/primitives/src/shadcn/**"` or `"apps/desktop/src/features/*/pages/**"` alone are silent no-ops during workspace scans.

2. **Cross-app and cross-feature JSX duplication (2 sites):**
   - `apps/mobile/src/app.tsx` (296 lines) and `apps/web/src/app.tsx` (296 lines) are **byte-for-byte identical on lines 1–279** (and `apps/{mobile,web}/src/state.ts` are 100% identical across all 46 lines); only line 280 (`export function MobileApp()` vs `export function WebApp()`) differs. At line 282, React Doctor flags the outer 16-node `<CloudErrorBoundary><MemoryRouter>...</MemoryRouter></CloudErrorBoundary>` JSX tree (`depth: 5`, suppressing the nested 15-node `<MemoryRouter>` and 13-node `<Routes>` subtrees).
   - `packages/react/features/src/colours/components/colour-detail-pane.tsx:213` and `packages/react/features/src/projections/projection-detail-screen.tsx:401` duplicate the exact same 7-node confirmation `<AlertDialogContent>` structure (`depth: 3`). Three additional files (`projection-review-screen.tsx:804`, `duplicate-workspace-dialog.tsx:28`, `workspace-backups-panel.tsx:165`) implement the same confirm-dialog pattern with minor prop variations (`disabled={busy}`, custom labels).

3. **Monolithic screens and high-branching render functions (20 files, 28 warnings):**
   - Six screens exceed **both** `> 300` component lines and `> 15` cyclomatic/cognitive complexity (`ProjectionReviewScreenInner` 716 lines / CC=62 / Cog=61, `StatusPage` 371 lines / CC=47 / Cog=46, `KalaidoscopeSetup` 452 lines / CC=45 / Cog=41, `ProjectionDetailScreen` 383 lines / CC=25 / Cog=25, `ReflectionRefineScreen` 339 lines / CC=24 / Cog=24, `ChatPanel` 354 lines / CC=21 / Cog=19).
   - Eleven functions under 300 lines exceed `CC > 15` or `Cog > 15` (5 of which — `LivePreviewPane` Cog=16, `usePromptEstimate` CC=16, `FragmentDrawer` Cog=17, `MapScreen` Cog=17, `ActiveRotationCard` Cog=17 — exceed the threshold by only 1–2 points).
   - Five components have `CC <= 15` and `Cog <= 15` but span `> 300` lines (`OrganizingSplash` 342 component lines in a 1111-line file, `ColourDetailPane` 325 lines, `ExploreScreen` 355 lines, `ExploreCompactScreen` 325 lines, `StreamScreen` 302 lines — only 2 lines over 300).
   - **Sequencing & score context (empirically verified):** Fixing Categories 1–5 + Part A + Part B **without any Part C edits** raises the React Doctor score from **`42 / 100 Critical` → `88 / 100 Great`** (0 errors, 28 Maintainability warnings). Part C must run **after** Categories 1–5 because 8 of the 20 Part C files (`ChatPanel`, `ChatMessages`, `OrganizingSplash`, `ProjectionDetailScreen`, `ProjectionReviewScreen`, `MapScreen`, `Status.tsx`, `ColourDetailPane`) are directly modified in Categories 1–5 and Part B.

---

## 2. The New Codebase Patterns

### Pattern 6A — Committed `doctor.config.json` Baseline (Dual Root + Sub-Project Globs)
Place `doctor.config.json` at the repo root with `$schema` (`https://react.doctor/schema/config.json`) and include **both** repo-root-relative and package-root-relative globs whenever targeting files inside workspace packages:
```json
{
  "$schema": "https://react.doctor/schema/config.json",
  "ignore": {
    "files": [
      "packages/react/primitives/src/shadcn/**",
      "src/shadcn/**"
    ]
  }
}
```
If desktop route co-location is preserved via config (see D6.2), use `ignore.overrides` with both `"apps/desktop/src/features/*/pages/*.tsx"` and `"src/features/*/pages/*.tsx"`. Note that `react-doctor` `rules` accepts only `"error" | "warn" | "off"` severities — rule thresholds (`300` lines, complexity `15`, JSX subtree `6` nodes) are hardcoded in `react-doctor` v0.9.23 and cannot be parameterized in config.

### Pattern 6B — Router-Free Cloud Shell & Shared `ConfirmDialog`
- **Cloud app deduplication (`AGENTS.md`-compliant):** Keep `react-router-dom` (`MemoryRouter`, `Routes`, `Route`, `Navigate`, `useNavigate`) strictly inside `apps/mobile/src/app.tsx` and `apps/web/src/app.tsx` (never in `packages/*`, never importing across `apps/mobile` and `apps/web`). Render routes from a typed descriptor list via `<Route key={r.path} path={r.path} Component={r.Component} />` (5 JSX nodes `< 6` threshold, clearing `duplicate-jsx-subtree`), and share router-free cloud UI/state helpers (`CloudErrorBoundary`, `useCloudWorkspacesList`, `pathForCloudStage`, and optionally callback-driven cloud page views) through `@kalaido/components` / `@kalaido/hooks` / `@kalaido/features/auth`.
- **Shared `ConfirmDialog`:** Wrap `AlertDialog` + `AlertDialogContent` boilerplate into a single domain-free `ConfirmDialog` supporting both controlled (`open` / `onOpenChange`) and trigger-wrapped (`trigger?: ReactElement`) invocation, `variant` (`"default" | "destructive"`), and `busy` disabling.

### Pattern 6C — Thin Container + Focused Sub-Views + Pure `.ts` Helpers
For decomposed screens, widgets, and hooks:
1. **Extract pure branching, status-wording, and state-derivation logic** into plain `.ts` helpers first (reduces `cyclomatic` and `cognitive` complexity inside React functions without multiplying component files, and makes logic directly unit-testable).
2. **Extract cohesive presentational sections** into private sibling components (`<ReviewHeaderActions>`, `<StatusOrganizeColumn>`, `<CloudIdField>`) with flat props and zero hidden side effects.
3. **Keep top-level screens as thin orchestration shells** (`<= 250` lines, `CC <= 15`, `Cog <= 15`) wiring live reads, scope state, and write handles to sub-views.
4. **Preserve package & barrel boundaries (`AGENTS.md`):**
   - Single-feature sub-components and hooks stay inside `packages/react/features/src/<feature>/components/` and `hooks/` without adding deep subpath exports to `package.json`.
   - Inside `packages/react/components/`, place private extracted `.tsx` sub-components in subdirectories (e.g. `src/chat/`, `src/fragment-drawer/`) rather than top-level `src/*.tsx`, because `@kalaido/components/package.json` maps `"./*": "./src/*.tsx"` as public exports.
   - Respect `apps/desktop/AGENTS.md`'s **250-LOC UI change budget checkpoint** (`added + subtracted` lines per wave; report to user whenever `>= 250` LOC).

---

## 3. File-by-File Inventory & Migration Plan

### 3.1 Part A — Baseline Config (`doctor.config.json`)
- Exclude `packages/react/primitives/src/shadcn/**` + `src/shadcn/**` (`488 → 433` scanned files; `138 → 117` issues, `-1` error, `-20` warnings).
- Resolve desktop `apps/desktop/src/features/*/pages/*.tsx` `only-export-components` (`25` files / `26` warnings) per **D6.2** (either `ignore.overrides` dropping `117 → 91` issues, or splitting into `*.route.ts` modules).

### 3.2 Part B — Deduplication (`duplicate-jsx-subtree`, 2 warnings)
| File(s) | Line(s) | Subtree Metrics | Planned Change |
|---|---|---|---|
| `apps/mobile/src/app.tsx` & `apps/web/src/app.tsx` | 282 & 282 | 16 JSX nodes, depth 5 (`MobileApp > CloudErrorBoundary` / `WebApp > CloudErrorBoundary`) | Per **D6.3**: Extract `CloudErrorBoundary` (and optionally shared router-free cloud page/hook helpers) to shared packages; render `<Routes>{CLOUD_ROUTES.map((r) => <Route key={r.path} path={r.path} Component={r.Component} />)}</Routes>` in each app (`5` JSX nodes `< 6`, clearing the warning with zero `react-router-dom` in `packages/*`). |
| `packages/react/features/src/colours/components/colour-detail-pane.tsx` & `packages/react/features/src/projections/projection-detail-screen.tsx` | 213 & 401 | 7 JSX nodes, depth 3 (`AlertDialog > AlertDialogContent`) | Per **D6.4**: Extract `ConfirmDialog` (supporting optional `trigger` + controlled `open`/`onOpenChange`, `busy`, `variant`) and adopt at both sites (plus optional adoption at `projection-review-screen.tsx:804`, `duplicate-workspace-dialog.tsx:28`, `workspace-backups-panel.tsx:165`). |

### 3.3 Part C — Decomposition Targets (Exact Verified Metrics)

**Tier 1 — Dual-flagged (`> 300` component lines AND `CC > 15` / `Cog > 15`; 6 files, 12 warnings):**
| File (Total LOC) | Component (Span LOC) | Exact Complexity | Cross-Plan Overlap | Suggested Split |
|---|---|---|---|---|
| `packages/react/features/src/projections/projection-review-screen.tsx` (830) | `ProjectionReviewScreenInner` (716 LOC, `:115–830`) | CC=62, Cog=61, depth=4 | **Cat 3** (`:204`, `:376–413` fold-in) | Extract `formatOutdatedCandidate` (`.ts`), `useProjectionReviewActions` hook (approve, refresh, discard-and-refresh, fold-in, wave skip/next), `<ReviewHeaderActions>`, and `<ReviewRefineColumn>` + `ConfirmDialog`. |
| `apps/desktop/src/features/status/pages/Status.tsx` (431) | `StatusPage` (371 LOC, `:52–422`) | CC=47, Cog=46, depth=1 | **Cat 5** (`:338` key, `queueHeldLabels`), **D6.2** (`:424`) | Extract `<OrganizePipelinesColumn>` (Mapping, Discover, Colour, Reconcile cards), `<LlmQueueCard>`, and `<WorkspaceEventLogCard>` into `apps/desktop/src/features/status/components/`. |
| `apps/desktop/src/features/create-kalaidoscope/pages/KalaidoscopeSetup.tsx` (569) | `KalaidoscopeSetup` (452 LOC, `:109–560`) | CC=45, Cog=41, depth=2 | **D6.2** (`:562`) | Single-page setup form (not a multi-step wizard; no location input): extract `cloud-id.ts` (`deriveCloudId`, `randomFallbackCloudId`, `describeCloudIdStatus`), `useCloudIdCheck` hook, `<SetupSignInGate>`, and `<CloudIdField>`. |
| `packages/react/features/src/projections/projection-detail-screen.tsx` (451) | `ProjectionDetailScreen` (383 LOC, `:69–451`) | CC=25, Cog=25, depth=2 | **Cat 3** (`:130`, `:207`), **Part B** (`:400`) | Replace inline delete `AlertDialog` with `ConfirmDialog` (Part B), extract `buildSnapshotTimeline` / `buildForkSeed` (`.ts`) and `<ProjectionDetailActions>` (Branch + More menus). |
| `packages/react/features/src/reflections/reflection-refine-screen.tsx` (437) | `ReflectionRefineScreen` (339 LOC, `:99–437`) | CC=24, Cog=24, depth=2 | None | Extract `<ReflectionRefineMiddlePane>` (chat vs initial composer vs preparing state) and `useReflectionRefineSeed` / action helpers so `ReflectionRefineScreen` drops well below 250 LOC and CC/Cog <= 15. |
| `packages/react/components/src/chat-panel.tsx` (499) | `ChatPanel` (354 LOC, `:146–499`) | CC=21, Cog=19, depth=1 | **Cat 1** (6 ref errors + 1 lazy-ref), **Cat 3** (3 effects) | Re-measure after Categories 1 & 3; extract spec/confirmation message builders (`src/chat/chat-spec-sync.ts` or `useChatSpecSync` hook) into a private `src/chat/` subdirectory so `ChatPanel` drops below 250 LOC and CC <= 15 without adding new wildcard exports. |

**Tier 2 — High-complexity functions (`<= 300` component lines, `CC > 15` or `Cog > 15`; 11 files, 11 warnings):**
| File (Total LOC) | Function (Span LOC) | Exact Complexity | Cross-Plan Overlap | Suggested Split |
|---|---|---|---|---|
| `packages/react/components/src/chat-messages.tsx` (1108) | `EditNoticeCard` (150 LOC, `:510–659`) | CC=43, Cog=51, depth=5 | **Cat 5** (`:1002` `settledBy`) | Extract pure `describeEditNotice(notice, liveEdit)` helper (`.ts` for label, icon kind, undo state, fallback copy) + `<EditNoticeUndoControl>` + `<EditNoticeBody>` in `src/chat/`. |
| `packages/react/features/src/reflections/components/reflection-series-panel.tsx` (249) | `ReflectionSeriesPanel` (202 LOC, `:48–249`) | CC=25, Cog=45, depth=5 | None | Extract `<SelectedWindowView>` (lines 174–234: error / loading / empty / window header pills + markdown body) and pure button-label helpers. |
| `packages/react/features/src/projections/components/projection-side-rail.tsx` (192) | `ProjectionSideRail` (161 LOC, `:32–192`) | CC=28, Cog=41, depth=3 | None | Extract `<ProjectionFreshnessCard>` (or per-status card switch helper) separate from the read-only banner and `<Timeline>` rail. |
| `packages/react/features/src/projections/components/snapshot-preview.tsx` (110) | `SnapshotPreview` (87 LOC, `:24–110`) | CC=16, Cog=24, depth=4 | None | Split `readOnly` branch (`<HistoricalSnapshotPreview>`) from live branch (`<LiveSnapshotPreview>`). |
| `apps/desktop/src/features/settings/components/kalaidoscope-row.tsx` (134) | `KalaidoscopeRow` (118 LOC, `:17–134`) | CC=17, Cog=24, depth=4 | None | Extract `<KalaidoscopeRowActions>` (Switch / Unarchive / inline confirm Archive or Remove controls). |
| `packages/react/features/src/projections/components/projection-draft-editor.tsx` (173) | `ProjectionDraftEditor` (139 LOC, `:35–173`) | CC=20, Cog=23, depth=3 | **Cat 3** (if `ChatPanel` API changes) | Extract pure `draftPhaseStatus(phase, hasDraft)` / `approveButtonLabel(committing, approveLabel)` helpers + `<DraftPreviewColumn>`. |
| `packages/react/components/src/fragment-drawer.tsx` (419) | `FragmentDrawer` (117 LOC, `:52–168`) | CC=13, Cog=17, depth=3 *(+2 over Cog 15)* | None | Extract `<FragmentDrawerBody>` (or `<FragmentDrawerLoading>`) in `src/fragment-drawer/` to drop Cog from 17 to <= 10. |
| `packages/react/features/src/map/map-screen.tsx` (204) | `MapScreen` (164 LOC, `:41–204`) | CC=15, Cog=17, depth=2 *(+2 over Cog 15)* | **Cat 5** (`:178` key) | Extract `<MapThingsSection>` and `<MapRelationshipsSection>` (drops Cog well below 15). |
| `packages/react/features/src/rotation/components/active-rotation-card.tsx` (135) | `ActiveRotationCard` (99 LOC, `:37–135`) | CC=15, Cog=17, depth=2 *(+2 over Cog 15)* | None | Extract pure badge/CTA presentation helper or `<RotationCardBody>` to drop CC/Cog below 15. |
| `packages/react/features/src/reflections/components/live-preview-pane.tsx` (79) | `LivePreviewPane` (57 LOC, `:23–79`) | CC=8, Cog=16, depth=4 *(+1 over Cog 15)* | None | Extract `previewPhasePillLabel(phase, hasPreview)` and `emptyPreviewCopy(started, phase)` pure helpers at module top (drops Cog from 16 to ~4). |
| `packages/react/components/src/context-meter/use-prompt-estimate.ts` (191) | `usePromptEstimate` (118 LOC, `:74–191`) | CC=16, Cog=13, depth=1 *(+1 over CC 15)* | None | Extract pure `buildPromptEstimate({ enabled, streaming, resolved, debouncing, isLoading, error, messages })` helper (drops CC from 16 to ~8). |

**Tier 3 — Giant components (`> 300` component lines, `CC <= 15` and `Cog <= 15`; 5 files, 5 warnings):**
| File (Total LOC) | Component (Span LOC) | Cross-Plan Overlap | Suggested Split |
|---|---|---|---|
| `apps/desktop/src/features/onboarding/components/organizing-splash.tsx` (1111) | `OrganizingSplash` (342 LOC, `:770–1111`; lines `1–768` are already pure canvas helpers) | **Cat 1** (`:801–804`), **Cat 2** (`:809–820`) | Move pure canvas math/drawing helpers (`:1–768`) + `requestAnimationFrame` canvas loop (`:820–1055`) into `organizing-splash-canvas.ts`; `OrganizingSplash.tsx` becomes a ~110-line React wrapper. |
| `packages/react/features/src/colours/components/colour-detail-pane.tsx` (416) | `ColourDetailPane` (325 LOC, `:65–389`) | **Part B** (`:205–228`) | Adopting `ConfirmDialog` in Part B already saves ~18 lines; extracting `<ColourPromptSection>` (`:231–281`, 51 lines) or `<ColourMemberCard>` drops `ColourDetailPane` under 260 LOC. |
| `packages/react/features/src/explore/explore-screen.tsx` (459) | `ExploreScreen` (355 LOC, `:105–459`) | **Cat 3** (if `onMessagesChange` changes) | Extract `useExploreSession` hook (recent-conversation restore + history context sync) or `<ExploreHistoryAside>` + `<ExploreHeaderActions>` to drop under 260 LOC. |
| `packages/react/features/src/explore/explore-compact-screen.tsx` (419) | `ExploreCompactScreen` (325 LOC, `:95–419`) | **Cat 3** (if `onMessagesChange` changes) | Extract `<CompactExploreHeader>` (workspace switcher dropdown + action buttons, `:277–346`, 70 lines) to drop `ExploreCompactScreen` to ~255 LOC. |
| `packages/react/features/src/fragments/stream-screen.tsx` (381) | `StreamScreen` (302 LOC, `:80–381` — *only 2 lines over 300*) | **Cat 4** *(note unflagged `<div role="button">` on `:339`)* | Extract `<StreamTimelineRow>` (`:331–374`) into `./components/stream-parts.tsx` to drop `StreamScreen` to ~255 LOC. |

---

## 4. Decision Points

| ID | Decision | Feasible Options | Cross-Plan Coupling | Selected |
|---|---|---|---|---|
| **D6.1** | Baseline `doctor.config.json` & vendored `shadcn/` exclusion | Option A (Commit `doctor.config.json` ignoring `shadcn/` with root + package globs) · Option B (Do not ignore `shadcn/`; patch 21 vendor issues in place) | **Cat 2** (`carousel.tsx:93`), **Cat 3** (`carousel.tsx:90`), **Cat 4** (`breadcrumb.tsx`, `item.tsx`), **Cat 5** (`chart.tsx`, `field.tsx`, 6 `only-export-components`) | _Pending_ |
| **D6.2** | Desktop route-page `only-export-components` (25 files / 26 warnings) | Option A (Per-path `ignore.overrides` in `doctor.config.json`) · Option B (Split `defineRoute(...)` into sibling `*.route.ts` files) · Option C (Move `defineRoute(...)` declarations into `apps/desktop/src/routes/`) | **Cat 5** (§3.4 handles the 6 non-route `only-export-components` files) | _Pending_ |
| **D6.3** | Cross-app cloud shell & router deduplication (`apps/mobile/src/app.tsx` & `apps/web/src/app.tsx`) | Option A (Extract shared router-free cloud shell/views + per-app mapped `<Route Component={...} />`) · Option B (Extract `CloudErrorBoundary` only + per-app mapped `<Route Component={...} />`) · Option C (Per-path `ignore.overrides` for `duplicate-jsx-subtree` on `app.tsx`) | None | _Pending_ |
| **D6.4** | Shared `ConfirmDialog` package placement, API shape & adoption scope | Option A (`@kalaido/primitives/kalaido` with dual `trigger` + `open`/`onOpenChange` props, adopt at 2 flagged sites) · Option B (`@kalaido/primitives/kalaido`, adopt across all 5 simple confirm sites) · Option C (`@kalaido/components` instead of `@kalaido/primitives`) | **Part C Tier 1** (`ProjectionDetailScreen`, `ProjectionReviewScreen`) & **Tier 3** (`ColourDetailPane`) | _Pending_ |
| **D6.5** | Part C decomposition scope, wave sizing & 250-LOC UI budget | Option A (All 3 tiers across small reviewable waves → `100 / 100`) · Option B (Tier 1 + top complexity hotspots only → `~89–92 / 100`) · Option C (Defer Part C code splits; land Cat 1–5 + Part A/B → `88 / 100 Great`) | **Cat 1–5** (8 shared files; Part C must run after Cat 1–5) | _Pending_ |
| **D6.6** | Module placement & export-barrel policy for extracted Part C parts | Option A (Strictly private co-location; subdirectories in `@kalaido/components` to avoid `"./*"` wildcard exports; zero barrel changes) · Option B (Private co-location by default, selectively re-exporting sub-components targeted by direct unit tests) | None | _Pending_ |
| **D6.7** | Tier 1 & borderline Tier 2 decomposition style | Option A (Pure `.ts` helpers + action hooks first, minimal JSX sub-components) · Option B (Section-per-file JSX sub-component splits alongside action hooks) | **Cat 1** (`ChatPanel`, `OrganizingSplash`), **Cat 2** (`OrganizingSplash`), **Cat 3** (`ProjectionReviewScreen`, `ProjectionDetailScreen`, `ChatPanel`) | _Pending_ |

---

### D6.1 — Baseline `doctor.config.json` & Vendored `shadcn/` Exclusion

**Decision:** _Pending_

**Files & Callers Verified:**
- `biome.json` (`:33`) and `scripts/check-design-classes.mjs` already exclude `packages/react/primitives/src/shadcn` (55 files).
- `react-doctor` v0.9.23 reads root `doctor.config.json` (schema `https://react.doctor/schema/config.json`).
- **Empirical glob finding:** Because `react-doctor . --yes` scans `@kalaido/primitives` with `packages/react/primitives` as its project directory, `ignore.files: ["packages/react/primitives/src/shadcn/**"]` alone matches **0 files** (`488` files scanned, `138` issues). Including both `"packages/react/primitives/src/shadcn/**"` and `"src/shadcn/**"` excludes all 55 shadcn files (`433` files scanned, `138 → 117` issues: `11 → 10` errors, `127 → 107` warnings; score remains `42 / 100` until Categories 1–5 clear error-level rules). No other workspace package has a `src/shadcn/` directory.

**Cross-Plan Coupling:** All counts in `doctor-02` (`carousel.tsx:93`), `doctor-03` (`carousel.tsx:90`), `doctor-04` (`breadcrumb.tsx:65`, `item.tsx:11`), and `doctor-05` (`chart.tsx`, `field.tsx`, and 6 `only-export-components` warnings) assume `shadcn/` is excluded by D6.1. Landing D6.1 first gives a clean baseline before Categories 1–5 start.

#### Option A — Commit root `doctor.config.json` ignoring `shadcn/` with root + package globs
- **How it works:** Add root `doctor.config.json` with `"$schema": "https://react.doctor/schema/config.json"` and `"ignore": { "files": ["packages/react/primitives/src/shadcn/**", "src/shadcn/**"] }`. Leave `packages/react/primitives/src/shadcn/*.tsx` untouched.
- **Verification:** Empirically tested with `pnpm dlx react-doctor@latest . --no-cache --verbose --yes`: scanned files `488 → 433`, issues `138 → 117` (`-1` error, `-20` warnings), matching `biome.json` and `check-design-classes.mjs`.
- **Pros:**
  - Aligns React Doctor with Biome and `check-design-classes.mjs` so upstream `shadcn` components remain unpatched templates.
  - Works identically whether `react-doctor` is run at the workspace root (`./kalaido.sh doctor:react`) or filtered via `--project @kalaido/primitives`.
- **Cons:**
  - Genuine runtime issues inside vendored `shadcn/` wrappers (such as eager `recharts` import in unused/used `chart.tsx` or `carousel.tsx` listener cleanup) stay hidden unless audited separately.

#### Option B — Do not ignore `shadcn/`; patch the 21 diagnostics inside `packages/react/primitives/src/shadcn/`
- **How it works:** Keep `shadcn/` scanned and edit `carousel.tsx`, `chart.tsx`, `field.tsx`, `breadcrumb.tsx`, `item.tsx`, `toggle-group.tsx`, `pagination.tsx`, `badge.tsx`, `button.tsx`, `button-group.tsx`, `navigation-menu.tsx`, `tabs.tsx`, and `toggle.tsx` (plus move `buttonVariants` / `badgeVariants` / `toggleVariants` into `.ts` files and update callers).
- **Verification:** Requires updating all workspace imports of `buttonVariants`, `badgeVariants`, etc., and running `./kalaido.sh check:ts && ./kalaido.sh test:ts`.
- **Pros:**
  - Zero file exclusions; fixes `carousel.tsx` effect cleanup and `chart.tsx` context memoization directly.
- **Cons:**
  - Diverges from upstream shadcn templates across 13 files and forces churn on `buttonVariants`/`badgeVariants` callers, contradicting the existing repo convention in `AGENTS.md` and `biome.json`.

**Ruled-Out Options:**
- *`"ignore": { "files": ["packages/react/primitives/src/shadcn/**"] }` (root-only glob):* Empirically verified as a **no-op** (`488` files scanned, `138` issues unchanged) because `@kalaido/primitives` resolves `ignore.files` relative to `packages/react/primitives/`.

---

### D6.2 — Desktop Route-Page `only-export-components` (25 files / 26 warnings)

**Decision:** _Pending_

**Files & Callers Verified:**
- Every desktop screen under `apps/desktop/src/features/*/pages/*.tsx` (25 files) exports its page component plus `export const <name>Route = defineRoute(...)` (`ReflectionRefine.tsx` exports 2: `newReflectionRoute` and `refineReflectionRoute` = 26 warnings).
- Full grep across `apps/desktop/src/` confirmed **`apps/desktop/src/routes/registry.ts` is the only file in the entire repository that imports any `*Route` symbol**.
- `scripts/validate-routes.ts` (`pnpm check:routes`) dynamically imports only `../apps/desktop/src/routes/registry` and `../apps/desktop/src/routes/route-ids` — it does not scan `pages/*.tsx` filenames directly.
- `apps/desktop/src/features/*/pages/` already uses sibling `*.transitions.ts` files (`Status.transitions.ts`, `KalaidoscopeSetup.transitions.ts`, etc.) right next to `*.tsx` pages.
- `react-doctor` v0.9.23 `ReactDoctorIgnoreConfig` (`dist/index.d.ts:450–481`) natively supports per-path rule overrides via `ignore.overrides: [{ files: string[], rules?: string[] }]`.

**Cross-Plan Coupling:** `doctor-05` §3.4 cleans up the remaining 7 non-route `only-export-components` warnings across 6 files (`colour.tsx`, `location-label.tsx`, `sidecar-status-dot.tsx` ×2, `utility-bar.tsx`, `workspace-backups-panel.tsx`, `app-router.tsx`). Together with D6.1 (`6` in `shadcn/`) and D6.2 (`26` in desktop route pages), all `39` `only-export-components` warnings are accounted for.

#### Option A — Per-path `ignore.overrides` in `doctor.config.json` (preserve co-located `defineRoute`)
- **How it works:** Add an override entry to `doctor.config.json`:
  ```json
  "overrides": [
    {
      "files": [
        "apps/desktop/src/features/*/pages/*.tsx",
        "src/features/*/pages/*.tsx"
      ],
      "rules": ["react-doctor/only-export-components"]
    }
  ]
  ```
- **Verification:** Empirically tested with `pnpm dlx react-doctor@latest . --no-cache --verbose --yes` and `--project @kalaido/desktop`: `only-export-components` drops `33 → 7` (`-26` desktop route-page warnings; total issues `117 → 91`), while still flagging all 7 non-page `only-export-components` sites (`sidecar-status-dot.tsx`, `utility-bar.tsx`, `workspace-backups-panel.tsx`, `app-router.tsx`, `colour.tsx`, `location-label.tsx`).
- **Pros:**
  - Zero source-file churn across 25 route pages; preserves Kalaido's co-located `defineRoute` convention.
  - Keeps `only-export-components` active everywhere else in `@kalaido/desktop` and `packages/react/*`.
- **Cons:**
  - Vite Fast Refresh still performs a full reload (losing local component state) whenever any desktop `pages/*.tsx` file is edited in dev mode, because `registry.ts` imports `*Route` from those `.tsx` modules.
  - Note: `"src/features/*/pages/*.tsx"` would also match if another app or package later created a `src/features/*/pages/*.tsx` directory (currently only `apps/desktop` has this layout).

#### Option B — Split `defineRoute(...)` into sibling `*.route.ts` files (25 files)
- **How it works:** Move each `export const fooRoute = defineRoute({ ..., Component: Foo })` out of `apps/desktop/src/features/<feature>/pages/Foo.tsx` into `Foo.route.ts` (matching the existing `Foo.transitions.ts` sibling convention), leaving `Foo.tsx` exporting only the `Foo` React component, and update the 25 import paths in `apps/desktop/src/routes/registry.ts`.
- **Verification:** Empirically prototyped on `Splash.tsx` + `Splash.route.ts` + `registry.ts`: `pnpm check:routes` (`validate-routes OK — 26 desktop routes`), `pnpm check:boundaries`, `pnpm check:nav`, and `pnpm --filter @kalaido/desktop typecheck` all passed cleanly. Eliminates all 26 warnings with zero config overrides.
- **Pros:**
  - Restores real Vite Fast Refresh state preservation when editing any of the 25 desktop page components in `tauri dev`.
  - No `ignore.overrides` needed in `doctor.config.json`; `only-export-components` is enforced uniformly repo-wide.
- **Cons:**
  - Adds 25 small (~12-line) `*.route.ts` files alongside existing `*.transitions.ts` and `*.tsx` files (`~300` lines moved across 26 files, triggering the `apps/desktop/AGENTS.md` 250-LOC reporting checkpoint).

#### Option C — Move `defineRoute(...)` calls into `apps/desktop/src/routes/registry.ts` (or route table modules)
- **How it works:** Export only the page component from each `pages/*.tsx` file, keep `*.transitions.ts` co-located (or imported into `registry.ts`), and construct `defineRoute(...)` entries inside `apps/desktop/src/routes/`.
- **Verification:** Compatible with `scripts/validate-routes.ts` and `scripts/check-navigation-discipline.mjs` (`apps/desktop/src/routes/` is the designated router directory).
- **Pros:**
  - Restores Vite Fast Refresh on all 25 pages without adding 25 new `*.route.ts` files.
- **Cons:**
  - Shifts route metadata (`path`, `requiredScope`, `transitions`) out of feature directories into central `routes/`, moving away from feature-co-located route declarations.

**Ruled-Out Options:**
- *Global `"rules": { "react-doctor/only-export-components": "off" }`:* Silences real Fast Refresh regressions across shared primitives/components (including the 6 files in `doctor-05`).
- *Root-only override glob `["apps/desktop/src/features/*/pages/**"]`:* Empirically verified as a **no-op** (`33` warnings unchanged) because `@kalaido/desktop` resolves override globs relative to `apps/desktop/`.

---

### D6.3 — Cross-App Cloud Shell & Router Deduplication (`apps/mobile/src/app.tsx` & `apps/web/src/app.tsx`)

**Decision:** _Pending_

**Files & Callers Verified:**
- `diff -u apps/mobile/src/app.tsx apps/web/src/app.tsx` showed **lines 1–279 are 100% identical**; only line 280 (`export function MobileApp()` vs `export function WebApp()`) differs. `diff -u apps/mobile/src/state.ts apps/web/src/state.ts` also showed **0 differences** (46 lines).
- `AGENTS.md`, `biome.json`, and `scripts/check-boundaries.mjs` forbid `react-router-dom` in `packages/*` and forbid cross-app imports between `apps/mobile` and `apps/web`.
- **Critical empirical findings from `duplicate-jsx-worker.js` & live CLI runs:**
  - `duplicate-jsx-subtree` hashes JSX structure with `minimumNodeCount: 6` and `minimumDepth: 3`, suppressing inner duplicates nested inside outer duplicates.
  - Every other component in `app.tsx` (`ExplorePage` = 4 JSX nodes; `CloudErrorBoundary`, `LoginPage`, `WorkspacesPage`, `BootErrorPage` = 1 JSX node each) is below the 6-node threshold.
  - **Surprise 1:** Removing/extracting `CloudErrorBoundary` alone while leaving the 6 literal `<Route path="..." element={<... />} />` elements inside `<MemoryRouter>` **still fails `duplicate-jsx-subtree`** (flags `<MemoryRouter>` at line 282: 15 JSX nodes, depth 4).
  - **Surprise 2:** Mapping `CLOUD_ROUTES` via `<Route key={path} path={path} element={<Page />} />` inside `<CloudErrorBoundary>` **still fails `duplicate-jsx-subtree`** (6 JSX nodes: `CloudErrorBoundary > MemoryRouter > StageNavigationListener + Routes > Route > Page`, depth 5).
  - **Verified fix:** Mapping `CLOUD_ROUTES` via React Router v7's `Component` prop (`<Route key={r.path} path={r.path} Component={r.Component} />`) reduces the tree to **5 JSX nodes** (`< 6` threshold) and **completely clears `duplicate-jsx-subtree` (`2 → 1`)** while typechecking cleanly in both `@kalaido/mobile` and `@kalaido/web`.

**Cross-Plan Coupling:** None (`CloudWorkspacePickerScreen` in `doctor-05` §3.1 is consumed by `WorkspacesPage` without prop changes).

#### Option A — Extract router-free cloud shell & page views to shared packages + per-app mapped `<Route Component={...} />`
- **How it works:**
  1. Move `CloudErrorBoundary` (`onBeforeClear` prop) to `@kalaido/components/cloud-error-boundary` (re-exported from `@kalaido/components`).
  2. Move router-free `pathForCloudStage` + `useCloudWorkspacesList` to `@kalaido/hooks/cloud-root-scope` (or `@kalaido/components`), and router-free `CloudBootErrorView` / `CloudExploreView` (accepting callbacks/render-guard instead of `<Navigate>`) to `@kalaido/features/auth` or `@kalaido/components`.
  3. Keep `<MemoryRouter>`, `<Routes>`, `<Route key={r.path} path={r.path} Component={r.Component} />`, `StageNavigationListener` (`useNavigate`), `LoginPage` (`useNavigate`), `WorkspacesPage` (`useNavigate`), and `ExplorePage`'s `<Navigate>` guard in thin (~75-line) `apps/mobile/src/app.tsx` and `apps/web/src/app.tsx`.
- **Verification:** `CLOUD_ROUTES.map((r) => <Route key={r.path} path={r.path} Component={r.Component} />)` empirically verified with `react-doctor --no-cache` (`duplicate-jsx-subtree` cleared for `app.tsx`), `pnpm check:boundaries`, `pnpm check:nav`, and `tsc --noEmit` across `@kalaido/mobile` and `@kalaido/web`.
- **Pros:**
  - Eliminates both the `duplicate-jsx-subtree` warning and ~200 lines of genuine copy-pasted non-router logic (`useCloudWorkspacesList`, `CloudErrorBoundary`, `ExplorePage` PocketBase lifecycle & provider tree) between mobile and web.
  - 100% compliant with `AGENTS.md` ("Shared by default" + zero `react-router-dom` in `packages/*` + zero cross-app imports).
- **Cons:**
  - Touches `@kalaido/components` (and/or `@kalaido/hooks` / `@kalaido/features`) in addition to `apps/mobile/src/app.tsx` and `apps/web/src/app.tsx`.

#### Option B — Minimal extraction: `CloudErrorBoundary` in `@kalaido/components` + per-app `CLOUD_ROUTES` map with `Component={r.Component}`
- **How it works:** Move `CloudErrorBoundary` (`onBeforeClear: () => Promise<void>`) to `@kalaido/components`, and replace the 6 literal `<Route path="..." element={<... />} />` lines in `apps/mobile/src/app.tsx` and `apps/web/src/app.tsx` with a module-level `CLOUD_ROUTES` array rendered via `<Route key={r.path} path={r.path} Component={r.Component} />`. Keep the remaining local route-page functions in each `app.tsx`.
- **Verification:** Empirically verified in isolated workspace: `react-doctor --no-cache` drops `duplicate-jsx-subtree` `2 → 1` (`138 → 137` issues); `check:boundaries`, `check:nav`, and `tsc --noEmit` pass.
- **Pros:**
  - Smallest possible diff (~35 lines touched per app + 1 small component) that clears `duplicate-jsx-subtree` and shares `CloudErrorBoundary`.
  - Keeps mobile and web free to diverge on their page wrappers (`ExplorePage`, `WorkspacesPage`) without coordinating shared props.
- **Cons:**
  - Leaves ~220 lines of identical non-JSX helper/hook code (`pathForStage`, `useCloudWorkspacesList`, `ExplorePage`, `state.ts`) duplicated across `apps/mobile` and `apps/web`.

#### Option C — Keep both `app.tsx` files as-is (or extract `CloudErrorBoundary` only) and suppress via `ignore.overrides`
- **How it works:** Add `{ "files": ["apps/mobile/src/app.tsx", "apps/web/src/app.tsx", "src/app.tsx"], "rules": ["react-doctor/duplicate-jsx-subtree"] }` to `doctor.config.json` (note `"src/app.tsx"` is safe only because `apps/desktop/src/` has no `src/app.tsx` — desktop uses `src/routes/app-router.tsx`).
- **Verification:** Verified via `ReactDoctorIgnoreOverride` schema in `react-doctor` v0.9.23.
- **Pros:**
  - Keeps explicit literal `<Route path="..." element={<... />} />` JSX in each app if independent evolution is anticipated.
- **Cons:**
  - Suppresses future accidental JSX duplication inside `src/app.tsx` and leaves all 296 lines duplicated.

**Ruled-Out Options:**
- *Shared `<CloudAppRouter>` in `packages/react/*`:* Violates `AGENTS.md`, `biome.json`, and `scripts/check-boundaries.mjs` (`react-router-dom` is banned in `packages/*`).
- *Importing between `apps/mobile` and `apps/web`:* Violates `AGENTS.md` and `scripts/check-boundaries.mjs` (cross-app imports are banned).
- *Extracting `CloudErrorBoundary` alone while keeping literal `<Route>` elements (or `<Route element={<Page />} />`):* Empirically proven with `react-doctor --no-cache` to **still fail `duplicate-jsx-subtree`** (15 JSX nodes and 6 JSX nodes respectively, both `>= 6`).

---

### D6.4 — Shared `ConfirmDialog` Package Placement, API Shape & Adoption Scope

**Decision:** _Pending_

**Files & Callers Verified:**
- Full-repo search for `AlertDialog` found **6 call sites** (plus the definition in `packages/react/primitives/src/shadcn/alert-dialog.tsx`):
  1. `packages/react/features/src/colours/components/colour-detail-pane.tsx:205` — **flagged** (`7` JSX nodes, depth 3); uses `<AlertDialogTrigger render={<Button variant="destructive" ...>Delete</Button>} />` (uncontrolled).
  2. `packages/react/features/src/projections/projection-detail-screen.tsx:400` — **flagged** (`7` JSX nodes, depth 3); uses controlled `<AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>` (opened from a `DropdownMenuItem`).
  3. `packages/react/features/src/projections/projection-review-screen.tsx:804` — controlled `open`/`onOpenChange`, `disabled={busy}`, `variant="destructive"` on `AlertDialogAction`.
  4. `apps/desktop/src/features/onboarding/components/duplicate-workspace-dialog.tsx:28` — controlled `open`/`onCancel`, `disabled={busy}`, custom action label.
  5. `apps/desktop/src/features/settings/components/workspace-backups-panel.tsx:165` — controlled `open={!!restoringId}`, `disabled={busy}`.
  6. `apps/desktop/src/features/onboarding/components/restore-provider-dialog.tsx:78` — stateful form modal containing `<ProviderFields />` (not a simple confirm dialog).
- Package dependency check: `packages/react/primitives` already owns `#shadcn/alert-dialog` and `#shadcn/button` with zero `@kalaido/*` deps beyond `@kalaido/brand`, and exports `./kalaido` (`packages/react/primitives/src/kalaido/index.ts`) + `./kalaido/*`. `ConfirmDialog` has **zero domain concepts** (purely `title`, `description`, `confirmLabel`, `cancelLabel`, `variant`, `busy`, `onConfirm`, plus optional `trigger` and optional `open`/`onOpenChange`).

**Cross-Plan Coupling:** Adopting `ConfirmDialog` in `ProjectionDetailScreen`, `ProjectionReviewScreen`, and `ColourDetailPane` directly shrinks three Part C targets (Tier 1 & Tier 3).

#### Option A — Place `ConfirmDialog` in `@kalaido/primitives/kalaido` (supporting both `trigger` and `open`/`onOpenChange`), adopt at the 2 flagged sites
- **How it works:** Create `packages/react/primitives/src/kalaido/confirm-dialog.tsx` (re-exported from `src/kalaido/index.ts`) wrapping `#shadcn/alert-dialog`:
  - Accepts `title: ReactNode`, `description: ReactNode`, `confirmLabel?: ReactNode` (default `"Confirm"`), `cancelLabel?: ReactNode` (default `"Cancel"`), `variant?: "default" | "destructive"`, `busy?: boolean`, `onConfirm: () => void`, plus optional `trigger?: ReactElement` (rendered via `<AlertDialogTrigger render={trigger} />`) and optional `open?: boolean` / `onOpenChange?: (open: boolean) => void`.
  - Replace the duplicated blocks in `colour-detail-pane.tsx:205–228` (`trigger={<Button ...>}`) and `projection-detail-screen.tsx:400–416` (`open={confirmDelete} onOpenChange={setConfirmDelete}`).
- **Verification:** Domain-free stateless UI primitive matches `AGENTS.md` rules for `@kalaido/primitives` (`#shadcn/*` internal imports, zero banned deps); reduces both call sites from 7+ JSX nodes to 1–2 JSX nodes (`< 6`), clearing `duplicate-jsx-subtree`.
- **Pros:**
  - Domain-free primitive lives alongside `DecisionCard`, `EmptyState`, and `SurfaceCard` in `@kalaido/primitives/kalaido`, usable from every React layer (`primitives`, `components`, `features`, `apps/*`).
  - Dual `trigger` + controlled `open`/`onOpenChange` support avoids forcing `ColourDetailPane` to add unnecessary `useState<boolean>` boilerplate while cleanly supporting dropdown-triggered dialogs in `ProjectionDetailScreen`.
  - Minimal diff (only touches the 2 flagged files).
- **Cons:**
  - Leaves the 3 unflagged confirm-dialog sites (`projection-review-screen.tsx`, `duplicate-workspace-dialog.tsx`, `workspace-backups-panel.tsx`) on raw `AlertDialog` unless adopted later.

#### Option B — Place `ConfirmDialog` in `@kalaido/primitives/kalaido` and adopt across all 5 simple confirm sites
- **How it works:** Same `ConfirmDialog` in `@kalaido/primitives/kalaido` as Option A, adopted in `colour-detail-pane.tsx`, `projection-detail-screen.tsx`, `projection-review-screen.tsx`, `duplicate-workspace-dialog.tsx`, and `workspace-backups-panel.tsx` (leaving only `restore-provider-dialog.tsx` on raw `AlertDialog` because it embeds `<ProviderFields />`).
- **Verification:** Same boundary/design compliance; also trims ~20 lines from `ProjectionReviewScreen` (Tier 1).
- **Pros:**
  - One consistent confirmation dialog pattern across features and desktop settings/onboarding, eliminating near-miss future `duplicate-jsx-subtree` triggers.
- **Cons:**
  - Slightly wider diff (+3 files beyond the 2 flagged sites).

#### Option C — Place `ConfirmDialog` in `@kalaido/components` instead of `@kalaido/primitives/kalaido`
- **How it works:** Create `packages/react/components/src/confirm-dialog.tsx` and re-export from `packages/react/components/src/index.ts`. Adopt at the 2 (or 5) sites.
- **Verification:** `@kalaido/features` and `apps/*` can both import `@kalaido/components`.
- **Pros:**
  - Keeps `@kalaido/primitives` focused strictly on non-overlay primitives if dialogs are viewed as higher-level chrome alongside `FeedbackDialog`.
- **Cons:**
  - Unlike `FeedbackDialog` (which depends on `@kalaido/platform` and `@kalaido/client`), `ConfirmDialog` is 100% domain-free (`AlertDialog` wrapper only), and placing it in `@kalaido/components` prevents `@kalaido/primitives` from ever using it internally.

---

### D6.5 — Part C Decomposition Scope, Wave Sizing & 250-LOC UI Change Budget

**Decision:** _Pending_

**Files & Callers Verified:**
- **Empirically verified `react-doctor` score curve** (measured with `pnpm dlx react-doctor@latest . --no-cache --yes`):
  - Current repo baseline (138 issues): **`42 / 100 Critical`**
  - Part A alone (`shadcn/` + desktop route overrides; 91 issues): **`42 / 100 Critical`** (held down by 10 bug errors + 15 active rules)
  - Categories 1–5 + Part A + Part B complete, **0 Part C edits** (28 warnings): **`88 / 100 Great`** (`0` errors, `28` Maintainability warnings: `17` complexity, `11` giant)
  - Categories 1–5 + Part A + Part B + **Tier 1 cleared** (16 warnings left): **`89 / 100 Great`** (`11` complexity, `5` giant)
  - Categories 1–5 + Part A + Part B + **Tiers 1–3 all cleared** (0 warnings): **`100 / 100 Great`**
- **Rule threshold configurability verified:** `ReactDoctorConfig.rules` (`dist/index.d.ts:839`) accepts only `"error" | "warn" | "off"` (`RuleSeverityOverride`). The `> 300` LOC threshold in `no-giant-component` and `> 15` cyclomatic/cognitive thresholds in `no-high-complexity-react-function` are hardcoded in `oxlint-plugin-react-doctor`.
- **`apps/desktop/AGENTS.md` change budget:** Requires spawning a subagent after UI changes to sum `lines added + lines subtracted` on the current branch; if `>= 250 LOC`, the agent must report the figure and advise the user that the change is growing large. Splitting even a single 400–800 LOC screen moves ~200 lines out and ~200 lines into new files (`~400+` combined `added + subtracted` LOC).

**Cross-Plan Coupling:** **High — Part C must execute last (after Categories 1–5 + Part B).** Eight Part C files are edited earlier: `ChatPanel` (Cat 1, Cat 3), `ChatMessages` (Cat 5), `OrganizingSplash` (Cat 1, Cat 2), `ProjectionDetailScreen` (Cat 3, Part B), `ProjectionReviewScreen` (Cat 3, Part B), `MapScreen` (Cat 5), `Status.tsx` (Cat 5, D6.2), and `ColourDetailPane` (Part B). Re-running `react-doctor` after Categories 1–5 + Part B gives exact post-cleanup metrics before any Part C split begins.

#### Option A — Execute all 3 tiers in small reviewable waves after Categories 1–5 + Part A/B (target: `100 / 100`, 0 warnings)
- **How it works:** After Categories 1–5 and Parts A–B land (`88 / 100`), decompose all 20 Part C files in small, feature-scoped waves (e.g. Projections wave, Reflections/Colours/Map/Rotation wave, Chat/Components wave, Explore/Stream wave, Desktop Status/Setup/Splash/Settings wave), running `./kalaido.sh test:ts && ./kalaido.sh check:ts`, `react-doctor`, and the `apps/desktop/AGENTS.md` LOC-budget subagent check at each wave boundary.
- **Verification:** Clears all 11 `no-giant-component` and 17 `no-high-complexity-react-function` warnings (`100 / 100`, `0` issues), enabling optional `--blocking warning` in CI.
- **Pros:**
  - Reaches a zero-warning `100 / 100` baseline so `--scope changed` or `--blocking warning` catches any future complexity/size regression immediately.
  - Breaks up genuine maintainability hotspots (`ProjectionReviewScreenInner` CC=62, `EditNoticeCard` CC=43, `StatusPage` CC=47, `KalaidoscopeSetup` CC=45).
- **Cons:**
  - Highest total diff volume (touches 20 files + creates ~25–30 internal helper/sub-component modules; every wave will exceed the 250-LOC `added + subtracted` advisory threshold).
  - Includes borderline splits on clean files like `StreamScreen` (302 lines — 2 lines over 300), `LivePreviewPane` (Cog=16 — 1 over 15), and `usePromptEstimate` (CC=16 — 1 over 15).

#### Option B — Execute Tier 1 + severe Tier 2 hotspots (`CC/Cog >= 25`) + `OrganizingSplash` `.ts` extraction; defer borderline splits
- **How it works:** Decompose the 6 Tier 1 screens (`ProjectionReviewScreen`, `StatusPage`, `KalaidoscopeSetup`, `ProjectionDetailScreen`, `ReflectionRefineScreen`, `ChatPanel`), the 3 genuinely knotted Tier 2 components (`EditNoticeCard` CC=43/Cog=51, `ReflectionSeriesPanel` Cog=45, `ProjectionSideRail` Cog=41), and `OrganizingSplash` (moving its canvas loop to `.ts`). Leave the 10 mild/borderline files (`StreamScreen` 302 LOC, `LivePreviewPane` Cog=16, `usePromptEstimate` CC=16, etc.) intact unless touched later.
- **Verification:** Empirically projected at **`89–92 / 100 Great`** (`0` errors, ~10 mild Maintainability warnings remaining).
- **Pros:**
  - Focuses engineering review budget strictly on high-payoff structural improvements (eliminates every function with CC/Cog > 24 and every >360-LOC monolith).
  - Avoids artificial file-splitting churn on readable 302–325 line screens and Cog=16–17 components.
- **Cons:**
  - Leaves ~10 Maintainability warnings in full scans (`--scope changed` still works cleanly for new code, though `--blocking warning` on full scans cannot be turned on without `ignore.overrides`).

#### Option C — Defer Part C code splits; land Part A + Part B + Categories 1–5 (`88 / 100 Great`)
- **How it works:** Complete Part A (`doctor.config.json`), Part B (2 `duplicate-jsx-subtree` fixes), and Categories 1–5 (all Bugs, Performance, Accessibility, and `only-export-components`), then stop and tackle Part C decompositions opportunistically per feature when touching those screens. (Optionally configure `surfaces` if hiding Maintainability warnings from PR/CI gates while keeping them visible in local CLI.)
- **Verification:** Empirically verified score: **`88 / 100 Great`** (`0` errors, `0` Bug/Perf/A11y warnings, `28` Maintainability warnings).
- **Pros:**
  - Zero refactoring risk on complex interactive screens (`ProjectionReviewScreen`, `ExploreScreen`, `KalaidoscopeSetup`) while still achieving `88 / 100 Great` and fixing 100% of correctness, performance, and accessibility findings.
  - Stays closest to `AGENTS.md` ("Do the minimum") and `apps/desktop/AGENTS.md` change budgets.
- **Cons:**
  - Leaves 28 Maintainability warnings in full-repo `react-doctor` output.

**Ruled-Out Options:**
- *Raising `maxLines` (e.g. 300 → 400) or `maxComplexity` (e.g. 15 → 25) in `doctor.config.json`:* Verified in `react-doctor` v0.9.23 `dist/index.d.ts` and `oxlint-plugin-react-doctor` source — rule thresholds are hardcoded constants (`300` and `15`) and `rules` only accepts `"error" | "warn" | "off"`.

---

### D6.6 — Module Placement & Export-Barrel Policy for Extracted Part C Parts

**Decision:** _Pending_

**Files & Callers Verified:**
- `packages/react/features/package.json` exposes feature barrels (`./explore`, `./projections`, `./reflections`, `./colours`, `./fragments`, `./map`, `./rotation`, `./auth`); `AGENTS.md` explicitly bans deep hook subpath exports in `@kalaido/features/package.json`.
- **Important wildcard-export discovery in `@kalaido/components`:** `packages/react/components/package.json` (`:15, :24`) declares `"./*": "./src/*.tsx"` and `"#*": "./src/*.tsx"`. Any new file placed directly at `packages/react/components/src/<name>.tsx` **automatically becomes a public `@kalaido/components/<name>` package export**, whereas files placed inside subdirectories (`src/chat/`, `src/fragment-drawer/`) remain private unless explicitly added to `exports` or `src/index.ts`.

**Cross-Plan Coupling:** None.

#### Option A — Strictly private co-location with zero public barrel expansion
- **How it works:**
  - In `@kalaido/features`: place extracted sub-components in `src/<feature>/components/`, hooks in `src/<feature>/hooks/use-*.ts`, and pure helpers in `src/<feature>/*.ts` (or `lib/`), **without** adding them to `src/<feature>/index.ts` or `package.json`.
  - In `@kalaido/components`: place extracted sub-components/helpers for `ChatPanel`, `EditNoticeCard` (`ChatMessages`), and `FragmentDrawer` inside private subdirectories (`src/chat/`, `src/fragment-drawer/`) so `"./*": "./src/*.tsx"` and `src/index.ts` expose zero new public symbols.
  - In `apps/desktop`: place extracted sub-components in `apps/desktop/src/features/<feature>/components/` and helpers/hooks in `hooks/` or sibling `.ts` files.
- **Verification:** Verified against `scripts/check-boundaries.mjs` and `packages/react/{components,features}/package.json`.
- **Pros:**
  - Keeps package public APIs minimal and unchanged; prevents internal decomposition artifacts from leaking across features.
- **Cons:**
  - Direct unit tests of pure `.ts` helpers inside a package import them via package-internal `#*` or relative paths within that package's own `*.test.ts` files (which matches existing package test layout).

#### Option B — Private by default, selectively re-exporting extracted sub-components from feature/component barrels
- **How it works:** Same directory layout as Option A, except re-export extracted sub-views/helpers from `<feature>/index.ts` or `@kalaido/components` when cross-package tests or stories want to mount them directly.
- **Verification:** Passes `check:boundaries` and `tsc --noEmit`.
- **Pros:**
  - Allows apps or integration tests outside the owning package to import extracted sub-views directly.
- **Cons:**
  - Widens public feature barrels with implementation-detail sub-views that have only a single parent caller.

---

### D6.7 — Tier 1 & Borderline Tier 2 Decomposition Style

**Decision:** _Pending_

**Files & Callers Verified:**
- Inspecting all 20 Part C files revealed two critical factual nuances:
  1. **`KalaidoscopeSetup.tsx` (`:109–560`, 452 LOC, CC=45, Cog=41) is a single-page form, NOT a multi-step wizard:** There is no location field (`:250`: `locationInput: ""`), and all fields (`Workspace Name` + `IconPicker`, `StorageOptionCards` + `CloudIdentityPanel`/`CloudSignInNotice`, conditional `Cloud ID` input with debounced availability check, conditional local `ProviderFields`) render on one `<form>` alongside an alternate `gate` view (`<CloudAuthPanel>`). Most of its complexity (`CC=45`) comes from inline cloud-ID derivation/availability state (`:153–195`, `:294–320`) and submit validation (`:214–292`), not wizard steps.
  2. **Five Tier 2 targets and two Tier 3 targets are within 1–25 points/lines of passing:** `LivePreviewPane` (`Cog=16`, +1), `usePromptEstimate` (`CC=16`, +1), `FragmentDrawer` (`Cog=17`, +2), `MapScreen` (`Cog=17`, +2), `ActiveRotationCard` (`Cog=17`, +2), `StreamScreen` (`302` LOC, +2 lines), `ExploreCompactScreen` (`325` LOC, +25 lines), and `ColourDetailPane` (`325` LOC before `ConfirmDialog` saves ~18 lines → `~307` LOC, +7 lines).
  3. **`OrganizingSplash.tsx` (`1111` total LOC; component `:770–1111` = `342` LOC, CC<=15):** Lines `1–768` are already pure non-React canvas math/drawing functions, and lines `820–1055` (`236` lines) are an imperative 2D canvas `requestAnimationFrame` loop inside `useEffect`.

**Cross-Plan Coupling:**
- `ProjectionReviewScreenInner` (`:376–413` `pendingFoldIn` + `:204` redirect) and `ProjectionDetailScreen` (`:130` redirect + `:207` `adoptDraftName`) depend on **Category 3** decisions.
- `ChatPanel` (`:191–223` refs + `:271–305` effects) depends on **Category 1** and **Category 3** decisions.
- `OrganizingSplash` (`:801–804` ref writes + `:809–820` `ending` state & `swapTimer` cleanup) depends on **Category 1** and **Category 2** decisions.

#### Option A — Pure `.ts` helper & custom-hook extraction first, adding JSX sub-components only for distinct UI regions
- **How it works:**
  - Prefer extracting pure `.ts` derivation modules (`cloud-id.ts`, `edit-notice.ts`, `prompt-estimate.ts`, `organizing-splash-canvas.ts`, `outdated-reason.ts`) and focused workflow hooks (`useProjectionReviewActions`, `useCloudIdCheck`) before splitting JSX.
  - Split JSX sub-components only along genuine visual/domain seams (`<OrganizePipelinesColumn>` / `<LlmQueueCard>` / `<WorkspaceEventLogCard>` in `Status.tsx`; `<ReviewHeaderActions>` / `<ReviewRefineColumn>` in `ProjectionReviewScreen`; `<SetupSignInGate>` / `<CloudIdField>` in `KalaidoscopeSetup`; `<SelectedWindowView>` in `ReflectionSeriesPanel`; `<ProjectionFreshnessCard>` in `ProjectionSideRail`).
  - Clear borderline Tier 2 targets (`LivePreviewPane`, `usePromptEstimate`, `ActiveRotationCard`) purely with module-level `.ts` helpers so zero extra `.tsx` component wrappers are introduced where JSX is already <100 lines.
- **Verification:** Verified against `oxlint-plugin-react-doctor`'s `no-high-complexity-react-function` (`cyclomatic <= 15 && cognitive <= 15` is evaluated per function, so moving branching into plain non-React `.ts` helpers — which are neither JSX-returning nor `use*` hooks — completely removes complexity from the React function without triggering `no-high-complexity-react-function` on the helper!).
- **Pros:**
  - Directly leverages how `no-high-complexity-react-function` works (only React components and `use*` hooks are checked; pure `.ts` domain functions are exempt and easily unit-tested).
  - Keeps JSX trees cohesive and avoids prop-drilling micro-components on small files like `LivePreviewPane` (79 LOC) and `ActiveRotationCard` (135 LOC).
- **Cons:**
  - Pure `.ts` extraction alone does not shrink JSX line count on pure-LOC Tier 3 screens (`ExploreScreen`, `ExploreCompactScreen`, `StreamScreen`), which still need 1 extracted JSX sub-component each if Tier 3 is in scope.

#### Option B — Uniform JSX sub-component section splits across all targeted components
- **How it works:** Decompose every targeted component primarily by splitting each conditional branch and layout panel into separate `.tsx` sub-components (e.g. per-status JSX components in `SnapshotPreview`, `LivePreviewPane`, `EditNoticeCard`, `ActiveRotationCard`, `KalaidoscopeRow`, plus multi-component splits on all Tier 1 & Tier 3 screens).
- **Verification:** Reduces both line span (`<= 300`) and per-component complexity (`<= 15`).
- **Pros:**
  - Uniform refactoring recipe across Tier 1, Tier 2, and Tier 3.
- **Cons:**
  - Fragments small, self-contained 80–135 line components (`LivePreviewPane`, `SnapshotPreview`, `ActiveRotationCard`) into multiple tiny `.tsx` files with wide prop interfaces.

---

## 5. Verification

- Confirm baseline config in isolation first (`pnpm dlx react-doctor@latest . --no-cache --verbose --yes`):
  - With `shadcn/` ignored (D6.1 Option A): `488 → 433` files scanned, `138 → 117` issues (`11 → 10` errors, `127 → 107` warnings).
  - With desktop route-page override or `*.route.ts` split (D6.2 Option A/B): `117 → 91` issues (`only-export-components`: `39 → 7`).
- After Categories 1–5 + Part B (`duplicate-jsx-subtree`: `2 → 0`), re-run `pnpm dlx react-doctor@latest . --no-cache --verbose --yes` and confirm **`88 / 100 Great`** (`0` errors, `28` Part C Maintainability warnings) before starting any Part C wave.
- After each Part C wave:
  - Run `./kalaido.sh test:ts && ./kalaido.sh check:ts` (`biome format`, `biome lint --error-on-warnings`, `check:boundaries`, `check:nav`, `check:design`, `check:routes`, `pnpm -r typecheck`, and `desktop`/`mobile`/`web` production builds).
  - Spawn the LOC-budget subagent required by `apps/desktop/AGENTS.md` (`added + subtracted` LOC on the branch) and report to the user whenever `>= 250` LOC.
  - Re-run `pnpm dlx react-doctor@latest . --no-cache --verbose --yes` to verify target warnings clear (`88 → 89–92 / 100` after Tier 1; **`100 / 100`** with `0` issues if all 3 tiers are executed).
