# Implementation Plan: Onboarding Rework, BYOK, Restore, and State Machine Fixes

**Target**: Frontend / React UI
**Context**: Replaces current onboarding with a 3-choice flow, implements frontend support for Bring Your Own Key (BYOK) LLM providers in local workspaces, supports restoring a workspace from backup, and fixes startup state machine jank. 

**Source Documents / Specs**:
- `kalaido/.agents/wishlist/2026-08-14-rework-onboarding-initial-choices.md`
- `kalaido/.agents/wishlist/2026-08-14-workspace-export-import.md`
- `kalaido/.agents/wishlist/2026-08-14-byok-llm-provider-for-local-workspaces.md`
- `kalaido/.agents/bugs/2026-08-13-startup-state-machine-jank.md`
- `kalaido/.agents/plans/onboarding/required-screens.md` (UX Brief)
- `kalaido/.agents/plans/onboarding/onboarding-state-diagram.md` (Flow Diagram)
- `kalaido/.agents/plans/onboarding/wireframes/Onboarding Wireframes.dc.html` (Design Mockups)

**Note**: The Go backend for BYOK is complete. Backup creation (export) and fragments-only merge are out of scope for this plan.

---

## Phase 1: Fix Startup State Machine Jank & Error Boundaries

**Goal**: Prevent unrecoverable states and handle routing exceptions gracefully.

1. **Root Error Boundary**
   - Create `RootErrorBoundary` component (e.g., in `src/components/error-boundary.tsx`).
   - Wrap the main application tree in `app-router.tsx`.
   - The fallback UI must provide recovery actions: **Retry**, **Switch Kalaidoscope** (if valid scopes exist in settings snapshot), and **Reset App Settings**. This catches the `throw "wtf"` in `KalaidoscopeContainer` and any render crashes.

2. **BootError Component Revamp**
   - Refactor `BootError.tsx` to handle `AppStage.bootstrap_error` and `AppStage.kalaidoscope_load_error`.
   - **UI**: Friendly message, collapsed "Copy error details" (stack trace/raw error).
   - **Actions for `bootstrap_error`**: **Retry** (reload settings) and **Reset App Settings**.
   - **Actions for `kalaidoscope_load_error`**: **Retry** (restart sidecar), **Switch Kalaidoscope** (standalone presentation of `NavKalaidoscopeSwitcher` logic), and **Reset App Settings**.

3. **Empty State Routing Hook**
   - Update `loadStoredState()` (`use-app-state.ts`). Currently, it only routes to `no_kalaidoscopes_available` when the workspace list is empty. Modify it to also route there if workspaces exist but none is marked as `lastOpenedKalaidoscopeId`.

---

## Phase 2: Rework Onboarding Initial Choices (Navigation & Screens)

**Goal**: Build the 3-choice landing screen and associated routing, replacing the existing empty-state fallback.

1. **Onboarding Landing Screen (`OnboardingLanding`)**
   - **Wireframe Reference**: `1b` ("One dominant primary + two quiet secondaries").
   - Displayed during `no_kalaidoscopes_available` state.
   - Renders 3 cards: **Log in to Cloud**, **Create New Workspace**, **Restore Workspace**.

2. **Flow 1: Log in to Cloud**
   - **Login Screen**: 
     - **Wireframe Reference**: `2c` ("Dedicated login screen — inline credential error, text preserved").
     - Dedicated view wrapping `AuthForm` + `OAuthButtons`. Skipped if user is already logged in. Includes a top-left "Back" button to Landing.
   - **Cloud Workspaces List**: Displayed after login.
     - **Wireframe Reference**: `2d` ("Cloud workspaces list — loading skeleton") and `2e` ("Cloud workspaces list — loaded, with offline error banner").
     - Calls `listCloudKalaidoscopes()`.
     - Merges results into `appState.availableKalaidoscopes` (upsert by ID).
     - Renders a list of workspaces (click to open) and a **"+ Create New Workspace"** secondary button.
     - Top-left "Back" button to Landing.

3. **Flow 2: Create New Workspace (`KalaidoscopeSetup` refactor)**
   - **Wireframe Reference**: `2a` ("Workspace Setup — name, icon, storage mode").
   - Update the existing component to include a top-left "Back" button.
   - **Inline Auth Gate**: 
     - **Wireframe Reference**: `2b` ("Inline sign-in gate — form values above stay put").
     - If the user selects "Cloud Storage" while signed out, do not bounce them. Render the `AuthForm` inline, replacing the setup form temporarily. On success, resume the workspace creation flow.

---

## Phase 3: BYOK LLM Provider Setup (Create Workspace)

**Goal**: Expose provider selection (Ollama vs Gemini) during local workspace creation.

1. **Provider Selection UI in `KalaidoscopeSetup`**
   - **Wireframe Reference**: `2f` ("Local storage needs a model / BYOK").
   - For **Local Storage** only, add a provider toggle: **Local Ollama** (default) vs **Google Gemini (BYOK)**.
   - If Gemini is selected:
     - Show **API Key** input.
     - Show **Model Selection** (default model for all roles).
     - Add an **Advanced** disclosure triangle for per-role model assignments (chat, refinement, projection/reflection, lens distillation, colour scoring).

2. **Live Preflight Validation**
   - When user submits the form with Gemini selected, call the backend `POST /api/llm/validate` endpoint with the entered key and models.
   - If validation fails, display inline error (auth/quota) and keep the form open. Do not proceed.

3. **Workspace Creation Sequence Update**
   - Because config lives in the workspace's DB, the frontend must orchestrate creation carefully:
     1. Create directory and spawn the sidecar process.
     2. Send `PATCH /api/collections/kalaidoscope_config/records/<id>` with the provider, API key, and models.
     3. If the PATCH fails (or preflight failed), kill sidecar, delete directory, and show error.
     4. On success, register in `availableKalaidoscopes` and open it.

---

## Phase 4: Workspace Restore (Mode A Import) - UI & Stubbed Logic

**Goal**: Implement the frontend UI flow for "Restore Workspace" from the onboarding landing screen, stubbing out the actual file extraction and restoration logic.

1. **File Selection Trigger**
   - Triggered from Landing screen Card 3.
   - Use `openFilePicker` to open the native OS file dialog accepting `.zip` archives.

2. **Import Logic Stub**
   - Create a placeholder function (e.g., `restoreWorkspaceFromArchive(filePath)`) to encapsulate the complex file extraction, `pb_data` validation, and copying operations.
   - For now, this function should just simulate a brief delay and return mock data to allow testing the frontend UI flows.

3. **Frontend Modals & Prompts (UI Only)**
   - **Duplicate Workspace Warning Modal**: Implement the UI component *(Note: Wireframe pending per designer notes; follow copy in `required-screens.md`)*. Connect it to the stubbed logic to verify its presentation (e.g., mock a collision scenario).
   - **BYOK Post-Restore Prompt**: Implement the blocking UI prompt ("Enter new API Key for Gemini, or switch to Ollama") for workspaces restored without an API key. Connect it to the stubbed logic to verify its presentation.
   - **Completion**: Once the stub resolves successfully, mock the registration in `availableKalaidoscopes` and trigger the navigation to open the dummy workspace.

---

## Phase 5: Per-Workspace Settings & UI Badges
 out of scope. 