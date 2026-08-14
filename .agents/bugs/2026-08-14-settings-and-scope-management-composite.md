---
title: "Composite Bug Report: Settings & Scope Management"
status: "expanded"
author: "human"
created: "2026-08-14"
---

## Description
This composite bug report covers issues identified across Settings and Scope Management:
1. **Missing Scope Actions on 'Manage Kaleidoscopes' Page**: The "Manage Kaleidoscopes" page lacks actions to remove/delete scopes or perform other scope management tasks.
2. **Misplaced 'Local AI' Settings Tab**: The "Local AI" tab in global settings is misplaced now that AI provider configuration is managed per scope. Local AI settings must be inlined directly into individual "Manage Kaleidoscope" scope items, and the global tab removed.
3. **Cannot Add Account Scopes from Settings Sign-In**: When signing in from settings, there is no option or automated flow to sync or add the signed-in account's cloud scopes to the local scope selection.
4. **Outdated Content on Connections Page**: The "Connections" page contains outdated/deprecated controls (e.g., Export stub) alongside active integrations.
5. **Gemini Model Selector & Advanced Settings Toggle**: The Gemini "model select" box is currently a plain text box instead of a dropdown. Model selection and per-role models should be hidden behind an "Advanced" section toggle, showing only the API key input by default.

---

## Verified Codebase Constraints
* **Scope Storage & State**: Local and cloud scopes are stored in `availableKalaidoscopes` in persistent settings (`kalaido-settings.json`) and held in `appState.availableKalaidoscopes` via Valtio proxy.
* **Scope Sidecar Lifecycle**: Deleting local scopes uses `deleteLocalKalaidoscope(dataDir)` via Tauri IPC in `src/api/app/local-scopes.ts`.
* **Cloud Registry API**: Cloud scopes owned by an account are retrieved using `listCloudKalaidoscopes()` against the auth gateway (`src/api/cloud/user.ts`).
* **Settings Routing**: Settings section routes are defined in `src/features/settings/pages/Settings.tsx` (`/settings/:section?`).
* **Provider Fields**: Provider configuration UI lives in `src/features/create-kalaidoscope/components/provider-fields.tsx` and uses `GEMINI_SUGGESTED_MODELS` from `src/api/kalaidoscope/llm-config.ts`.

---

## Target Working End State

### Sub-Issue 1: Scope Management Actions on 'Manage Kaleidoscopes' Page
* **Inlined Scope Information & Actions**: Each scope item on `/settings/kalaidoscopes` displays:
  * **Inline Display Name Editing**: Clickable text / input field to rename the scope in place.
  * **AI Provider Overview**: Badge or indicator showing current provider (e.g., `Local: Ollama`, `Local: Gemini`, or `Cloud: Kalaido Cloud`).
  * **API Key Management**: An inline field to view/update the API key for local scopes configured with an API-key provider (e.g., Gemini).
  * **Ollama Status Integration**: For scopes using Local Ollama, render Ollama connection status, active model, and download/reachability alerts on that row.
  * **Backup Action**: A `[Backup]` button that triggers an export/backup zip file for that scope.
  * **Remove / Delete Action**: A `[Remove]` or `[Delete]` button that triggers a confirmation dialog.
* **Delete Confirmation Dialog**:
  * Features a prominent warning message.
  * Includes a checkbox: *"Also delete scope files from disk"* (default: **unchecked**).
  * If checked on a local scope, calls `deleteLocalKalaidoscope` to clean up disk storage. If unchecked (or on cloud scopes), removes the scope entry from `availableKalaidoscopes` without deleting remote/disk data.
* **Active Scope Deletion Handling**:
  * Switching active scopes directly from this page is **disabled** (must be done via the top-left sidebar switcher).
  * If the currently active scope is deleted, navigate the user to the initial Onboarding screen (which lists all remaining known scopes) upon exiting Settings or on next app launch.

### Sub-Issue 2: Inlined Local AI Settings
* **Global Navigation Clean-up**: Remove the "Local AI" sidebar tab (`/settings/local-ai`) and route from the global Settings navigation.
* **Inlined Configuration**: All Local AI configurations (Ollama status checks, recommended model download cards, active model radio list, and quality warnings) are embedded into each individual scope item row/card on the "Manage Kaleidoscopes" page.

### Sub-Issue 3: Cloud Account Scopes Management
* **Automatic Sync on Sign-In**: When a user signs in via `/settings/cloud-account`, automatically invoke `listCloudKalaidoscopes()` and merge all discovered account cloud workspaces into `availableKalaidoscopes` so they immediately appear in the local scope switcher.
* **"Account Workspaces" Section**: Below the signed-in user card on `/settings/cloud-account`, render an **Account Workspaces** list displaying all cloud scopes owned by the account.
* **Workspace Action Controls**:
  * **`[Add to App Menu]` / `[Remove from App Menu]`**: Toggles whether the cloud scope appears in `availableKalaidoscopes` / top-left scope switcher dropdown.
  * **`[Delete Scope]`**: Permanently deletes the cloud workspace from both the cloud server and local app menu (requires a confirmation dialog).
  * Removing a cloud scope from "Manage Kaleidoscopes" removes it from `availableKalaidoscopes` but leaves it visible in "Account Workspaces" on the Cloud Account page for easy re-adding.

### Sub-Issue 4: Cleaned Up Connections Page
* **Retained Features**:
  * **Import**: Retained as an active, functional connection row (`/connections` -> `/import`).
  * **Live Sync**: Retained as a "Coming Soon" stub row.
* **Removed Features**:
  * **Export**: Permanently removed from the Connections page (`Connections.tsx`).

### Sub-Issue 5: Gemini Provider Configuration & Advanced Layout
* **Default Simple Form**: When Gemini provider is selected, display **only** the API Key input field by default.
* **Advanced Section Toggle**: Place default model selection and task/role model overrides inside an expandable **"Advanced"** section toggle (`Collapsible`).
* **Dropdown Model Selector**: Replace the plain text `<Input list="...">` for Model selection with a proper `<Select>` dropdown menu featuring preset suggested Gemini models (`gemini-2.5-flash`, `gemini-2.5-pro`, `gemini-2.0-flash-lite`, etc.) with support for custom model name input.

---

## Acceptance Criteria
1. **Manage Kaleidoscopes**:
   - Scope rows allow inline renaming, API key updates, backup exports, and scope deletion.
   - Deleting a scope displays a confirmation modal with an unchecked *"Also delete files from disk"* checkbox.
   - Deleting the active scope routes the user to Onboarding screen upon leaving Settings.
2. **Local AI Inlining**:
   - The global "Local AI" tab is gone from the `/settings` navigation sidebar.
   - Scope cards in "Manage Kaleidoscopes" display Ollama status and model selectors inline.
3. **Cloud Account Sync**:
   - Signing in automatically adds cloud workspaces to the local scope dropdown.
   - The Cloud Account page lists all account workspaces with `[Add/Remove from App]` and `[Delete Scope]` buttons.
4. **Connections Page**:
   - "Export" card is deleted. "Import" and "Live Sync" remain.
5. **Gemini Config**:
   - Gemini settings show only API Key by default. Model select is converted to a dropdown and hidden inside an "Advanced" collapsible toggle.

---

## Edge Cases & Scope Limits
* **Offline Cloud Sync**: If `listCloudKalaidoscopes()` fails during sign-in due to network errors, display an inline warning with a `[Retry]` button on the Cloud Account page without blocking authentication.
* **Deleting Active Cloud Scope**: Deleting a cloud scope that is currently open removes it from `availableKalaidoscopes` and routes to Onboarding upon exiting settings.
