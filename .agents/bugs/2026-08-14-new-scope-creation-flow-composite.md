---
title: "Composite Bug Report: New Scope / Kaleidoscope Creation Flow"
status: "open"
author: "human"
created: "2026-08-14"
updated: "2026-08-14"
---

## Description
This composite bug report covers three core UX and technical issues in the New Scope / Kaleidoscope Creation flow (`/kalaidoscope/setup`):
1. **Incorrect Default Scope Type after Sign In**: Coming from sign-in or being logged in defaults to "Local" storage instead of "Cloud". Furthermore, users with zero cloud workspaces upon signing in should be routed directly to workspace creation with "Cloud" pre-selected.
2. **Missing User Identity Context**: Creating a new cloud scope while logged in does not display who (which user/account) you are currently signed in as.
3. **Missing Local Ollama Status & Warnings (Rust-based Check)**: Selecting "Local Ollama" on local scope setup lacks live Ollama reachability checks. Because the PocketBase sidecar server is not yet running during workspace setup, Ollama and API key validity must be checked via a Rust Tauri IPC command. When inactive, the UI must show a download link (`https://ollama.com/download`) and a non-blocking warning that AI features require Ollama.

## Steps to Reproduce

### 1. Default Option after Sign In
1. On initial onboarding (`/onboarding`), click "Log in to Cloud".
2. Complete sign-in:
   - If the account has zero cloud workspaces, observe redirection to `/onboarding/cloud` instead of directly opening `/kalaidoscope/setup` with "Cloud" pre-selected.
   - If clicking "Create New Workspace" while logged in, observe that "Local" storage is selected by default instead of "Cloud".

### 2. Logged-In User Identity
1. Log into a Kalaido Cloud account.
2. Navigate to create a new workspace (`/kalaidoscope/setup`).
3. Select "Cloud" storage.
4. Observe the lack of any read-only account/user identity context showing who you are signed in as.

### 3. Local Ollama Status & Warning
1. Go to the workspace creation page (`/kalaidoscope/setup`).
2. Keep "Local" selected and choose "Local Ollama" as the model provider.
3. Observe that no immediate Ollama reachability check occurs, no "Ollama running" tick indicator appears when active, no download link appears when offline, and no non-blocking AI availability warning is shown.

## Verified Codebase Constraints

- **Sidecar Lifecycle Constraint**: During initial workspace setup (`/kalaidoscope/setup`), the workspace's PocketBase sidecar backend is not running yet. HTTP checks to `http://127.0.0.1:8090/api/ollama/status` fail. Status checks for Ollama (`http://127.0.0.1:11434`) and provider API key validation must be handled via a Rust Tauri command in `src-tauri` (e.g. `check_ollama_status` / `validate_llm_key`).
- **Navigation State & Direct Routing**:
  - `useAppNavigate` supports `opts.state` during route transitions (`go(transition, { state: ... })`).
  - `CloudWorkspaces.tsx` can check if `workspaces.length === 0` after loading and automatically redirect to `kalaidoscope-setup` with `{ defaultStorage: "cloud" }`.
  - `OnboardingLanding.tsx` can pass `{ defaultStorage: "cloud" }` when the user is signed in.
- **User Session Context**: `useCloudSession()` provides `{ user, signedIn }` where `user` contains `email` and optional `name`.
- **System Browser Integration**: `openSystemBrowser(url)` in `app/src/api/app/os-integrations.ts` invokes Tauri plugin opener to launch `https://ollama.com/download` in the OS default browser.
- **Form Validation & Non-blocking Creation**: Form submission enablement (`canCreate` in `KalaidoscopeSetup.tsx`) depends strictly on name and location validity. Unreachable Ollama status MUST NOT block workspace creation.

## Desired Working End State

### 1. Default Scope Type Selection
- **Zero Cloud Workspaces Redirect**: When a user completes sign-in and lands on `CloudWorkspaces`, if zero cloud workspaces are found (`workspaces.length === 0`), the app automatically navigates to `/kalaidoscope/setup` with `{ defaultStorage: "cloud" }`.
- **Logged-In Landing Behavior**: Clicking "Create New Workspace" from `OnboardingLanding` while signed in navigates to `/kalaidoscope/setup` with `{ defaultStorage: "cloud" }`.
- **Pre-selection Handling**: `KalaidoscopeSetup` reads `location.state?.defaultStorage`. If set to `"cloud"` (or if `signedIn === true` and no explicit state override exists), initial `storage` state is `"cloud"`. Otherwise, it defaults to `"local_file"`.
- Users retain full ability to toggle manually between "Local" and "Cloud".

### 2. Read-Only User Identity Display for Cloud Scopes
- When "Cloud" storage option is selected and the user is logged in (`signedIn === true`), a compact read-only user identity badge appears directly beneath the "Cloud" card inside the Storage section.
- Text reads: "Signed in as **{user.name || user.email}** ({user.email})".
- **Scope Limit**: No sign-out button is rendered inside the creation form/panel (sign-out remains available on the main landing/settings pages).

### 3. Local Ollama Status, Rust IPC Check, Download Link & Warning
- **Rust Tauri Command**: Add Rust command(s) in `src-tauri` to check local Ollama reachability at `http://127.0.0.1:11434` (and optional API key validation). Expose to React via Tauri IPC in `app/src/api/app/`.
- **Immediate Status Check**: When "Local Ollama" is selected, React immediately invokes the Rust check command.
- **Provider Box UI (Option A)**:
  - **When Ollama is Running**: Shows a green tick / checkmark indicator with message: *"Ollama running"* (or *"Ollama detected"*).
  - **When Ollama is Not Running**: Shows a warning message: *"Ollama not running — AI won't be available until it is"*, along with a download link below (*"Download and set up Ollama"*).
- **System Browser Launch**: Clicking the download link opens `https://ollama.com/download` directly in the system's default browser via `openSystemBrowser`.
- **Non-blocking Creation**: Unreachable Ollama does NOT disable the "Create Kalaidoscope" button.

## Acceptance / Success Criteria

1. **Auto-redirect on Zero Cloud Workspaces**: Signing in with an account having 0 cloud workspaces automatically forwards to `/kalaidoscope/setup` with "Cloud" preselected.
2. **Logged-In Pre-selection**: Clicking "Create New Workspace" while signed in preselects "Cloud" as storage.
3. **Read-Only Account Context**: Selecting "Cloud" while signed in displays a compact badge ("Signed in as ...") under the Cloud storage card, with no sign-out action on the creation panel.
4. **Rust-Powered Ollama Check**: Selecting "Local Ollama" invokes the Rust Tauri IPC command to test `127.0.0.1:11434` directly without requiring PocketBase to be running.
5. **Active Ollama Indicator**: Shows a green tick "Ollama running" indicator when active.
6. **Inactive Ollama Guidance**: Shows "Ollama not running — AI won't be available until it is" and a download link to `https://ollama.com/download` opening in the default browser when offline.
7. **Non-blocking Creation**: Scope creation remains allowed even if Ollama is not running.
8. **Compilation & Validation**: Rust code builds cleanly (`cargo check`), and TypeScript type checking (`tsc --noEmit`), route checks, and tests pass.

## Edge Cases & Scope Limits

- **Offline / Server Errors during Ollama Check**: Rust command handles timeout/error gracefully and returns `reachable: false`, causing UI to show the setup warning and download link without crashing.
- **Signed-Out Cloud Selection**: If a signed-out user toggles to "Cloud", the user identity badge is hidden, and submitting form opens the sign-in gate modal (`snap.gateOpen = true`).
- **Sign-Out Scope**: Sign-out button is excluded from the setup form panel by design; users sign out via Onboarding Landing or Settings.

## Relevant Code Locations
- `app/src-tauri/src/lib.rs` & `kalaidoscope.rs` (or new Rust module): Rust command for checking Ollama status / LLM validation.
- `app/src/api/app/llm-validate.ts` & `_invoke.ts`: Invoking Rust Tauri command from React.
- `app/src/features/create-kalaidoscope/pages/KalaidoscopeSetup.tsx`: Scope setup page state, default selection, and user identity badge.
- `app/src/features/create-kalaidoscope/components/provider-fields.tsx`: Provider selection, Ollama check UI, tick/warning rendering.
- `app/src/features/onboarding/pages/CloudWorkspaces.tsx`: Auto-forward on zero workspaces and passing `defaultStorage: "cloud"`.
- `app/src/features/onboarding/pages/OnboardingLanding.tsx`: Passing `defaultStorage: "cloud"` when clicking "Create New Workspace" while logged in.
