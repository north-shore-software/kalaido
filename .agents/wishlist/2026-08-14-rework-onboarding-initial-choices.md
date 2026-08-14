---
title: "Re-work onboarding flow with initial entry choices (Login, Create, Import)"
status: "specified"
author: "human"
created: "2026-08-14"
expanded: "2026-08-14"
---

## Summary
Re-work the onboarding experience to begin with a clean 3-choice landing screen ("Log in to Cloud", "Create New Workspace", and "Import Workspace from File"). This streamlines first-run and returning-user experiences by cleanly separating authentication, creation, and archive restoration.

## Motivation / Use Case
Returning users with cloud workspaces or users with exported workspace backup files currently have to navigate through the workspace creation screen first. Adding an explicit choice screen at entry gives every user a direct path tailored to their intent.

## Desired Working End State

1. **Initial Onboarding Landing Screen**:
   - Replaces the first-run / empty state landing view when no workspace is active.
   - Displays a clean header and three distinct action cards/buttons:
     1. **Log in to Cloud**: For returning users with existing cloud accounts/workspaces.
     2. **Create New Workspace**: For starting a fresh local or cloud workspace.
     3. **Import Workspace from File**: For restoring an exported workspace file.

2. **Flow 1: Log in to Cloud**:
   - **Login Screen**: Clicking "Log in to Cloud" opens a dedicated login page (email/password or SSO) without unrelated options.
   - **Cloud Workspaces List**: Upon successful login, the view automatically transitions to a list of the user's available cloud workspaces.
     - Clicking any listed workspace opens it immediately and enters the application.
     - The list view includes a secondary **"Create New Workspace"** option.
   - Subsequent workspace switching or creation in regular app usage uses the standard `TitleBar` scope dropdown.

3. **Flow 2: Create New Workspace**:
   - Clicking "Create New Workspace" opens the existing workspace setup view (`KalaidoscopeSetup`) featuring workspace name input, icon picker, and local vs. cloud storage options.
   - Upon completion, the new workspace is created and opened immediately.

4. **Flow 3: Import Workspace from File**:
   - Clicking "Import Workspace from File" triggers a file picker or import view accepting a `.zip` archive file containing a PocketBase workspace directory.
   - The application extracts and performs a one-off copy of the workspace into the local application-managed workspace storage directory alongside other local workspaces.
   - Registers the imported workspace in `availableKalaidoscopes` and opens it immediately.

5. **Flow Navigation**:
   - Every sub-screen (Login, Cloud Workspaces List, Workspace Setup, and Import) includes a top-left **"Back"** button that returns the user to the 3-choice Onboarding Landing screen.

6. **Workspace Export Companion**:
   - Includes a companion workspace Export function (accessible from workspace settings/scope menu) that packages a local workspace into a downloadable `.zip` archive file for backup and cross-device import.

## Verified Technical Constraints
- `Splash.tsx` and boot routes in `features/boot` manage entry stages.
- `useCloudSession()` provides auth state and session info via `authClient`.
- Local workspace management in `local-scopes.ts` handles workspace directory registration.
- Zip extraction/compression can utilize standard browser/Tauri file APIs without changing backend PocketBase schemas.
- No database schema migrations required.

## Acceptance Criteria
- [ ] First-run / empty state displays the 3-choice Onboarding Landing screen ("Log in to Cloud", "Create New Workspace", "Import Workspace from File").
- [ ] Clicking "Log in to Cloud" shows a dedicated login screen, followed by a list of available cloud workspaces upon successful login.
- [ ] Selecting a cloud workspace opens it and enters the app.
- [ ] Clicking "Create New Workspace" navigates to the existing `KalaidoscopeSetup` flow.
- [ ] Clicking "Import Workspace from File" accepts a workspace `.zip` archive, copies/extracts it into local workspace storage, and opens it.
- [ ] All onboarding sub-screens include a working top-left "Back" button returning to the landing screen.
- [ ] A workspace export utility is provided to generate compatible workspace `.zip` archives.
