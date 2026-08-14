---
title: "Re-work onboarding flow with initial entry choices (Log in, Create, Restore)"
status: "specified"
author: "human"
created: "2026-08-14"
expanded: "2026-08-14"
---

## Summary
Re-work the onboarding experience to begin with a clean 3-choice landing screen: **Log in to Cloud**, **Create New Workspace**, and **Restore Workspace** (from a backup file). This streamlines first-run and returning-user experiences by cleanly separating authentication, creation, and archive restoration.

## Motivation / Use Case
Returning users with cloud workspaces or users with backup files currently have to navigate through the workspace creation screen first. Adding an explicit choice screen at entry gives every user a direct path tailored to their intent.

## Terminology (important — resolves a naming collision)
This feature introduces two new terms that must stay distinct from an existing feature:
- **Import / Export** (unchanged meaning) — the existing per-workspace "Connections" page (`features/connections`), scoped to an already-open workspace. Content-level only: bringing fragments/projections *into* the scope (Import, ships today) or sending them *out* (Export, currently a "coming soon" stub — this spec doesn't change its meaning, just confirms it as content-level, not whole-workspace).
- **Backup / Restore** (new) — whole-workspace archive file operations. "Restore" replaces the wishlist's original "Import Workspace from File" wording specifically to avoid colliding with the Connections page's "Import." Backup/Restore are treated as second-class / less prominent than Import/Export — see the Backup section below for where Backup lives.

## Desired Working End State

1. **Initial Onboarding Landing Screen**
   - Replaces the first-run / empty-state landing view whenever there is no currently-resumable workspace (see Acceptance Criteria for the exact trigger condition — this is broader than "zero workspaces known").
   - Displays a clean header and three distinct action cards: **Log in to Cloud**, **Create New Workspace**, **Restore Workspace**.

2. **Flow 1: Log in to Cloud**
   - Opens a dedicated login screen reusing the existing `AuthForm` + `OAuthButtons` components (email/password and OAuth), without unrelated options.
   - If the user already has a valid cloud session, this screen is skipped entirely — go straight to the workspace list below.
   - On successful login (or when already signed in), fetch the user's cloud workspaces (`listCloudKalaidoscopes()`) and **merge all of them** into this device's local workspace registry (`availableKalaidoscopes`), upserting by id — not just the one the user eventually clicks. This is what makes "click to open" work per the existing switch mechanism, and it means the user's full cloud workspace set becomes visible in the TitleBar switcher immediately after logging in, whether or not they open one right away.
   - This merge only happens as a result of this explicit login action — it is not a passive background sync that runs on every app boot.
   - The view then shows the (now-merged) list of the user's cloud workspaces. Clicking any one opens it immediately.
   - The list includes a secondary **"Create New Workspace"** option — the same component as Flow 2, already past the sign-in gate since the user is authenticated here.
   - Subsequent workspace switching or creation during regular app usage continues to use the standard `TitleBar` scope dropdown.

3. **Flow 2: Create New Workspace**
   - Opens the existing `KalaidoscopeSetup` view (name, icon picker, local vs. cloud storage), unchanged in shape, reachable both directly from the landing screen and as the secondary option inside Flow 1's workspace list.
   - The cloud storage option remains available regardless of entry point. If the user picks cloud storage while signed out, sign-in gates **inline**, reusing the same `AuthForm` but framed contextually ("sign in to store this workspace in the cloud") rather than bouncing to a separate screen or Settings. On successful inline sign-in, the flow continues in place and finishes creating the workspace — it does not redirect into Flow 1's workspace list.
   - Upon completion, the new workspace is created and opened immediately.

4. **Flow 3: Restore Workspace**
   - Distinct label from the existing "Import" feature (see Terminology) — this operates on a whole-workspace backup file, before any workspace is open.
   - Opens a native file picker (same pattern as the existing `openFilePicker`) accepting a `.zip` archive containing a PocketBase workspace directory.
   - Extracts/copies the archive into the local application-managed workspace storage directory, alongside other local workspaces.
   - **Collision handling**: if the archive's workspace id already matches one already known locally, show a confirmation naming the existing workspace by name, in case the user didn't intend to restore a duplicate. On confirmation, proceed by assigning the restored workspace a new, unique id (never overwrites the existing local workspace).
   - Registers the (possibly re-identified) workspace in `availableKalaidoscopes` and opens it immediately.

5. **Flow Navigation**
   - Every sub-screen (Login, Cloud Workspaces List, Workspace Setup, Restore) includes a top-left **"Back"** button returning to the 3-choice Onboarding Landing screen.

6. **Backup (companion to Restore)**
   - Second-class relative to the Connections page's Import/Export — lives in **Settings → Manage Kalaidoscopes**, as a new overflow (kebab) menu on each `KalaidoscopeRow`. This menu does not exist today (the row currently renders only a name and an "active" pill); this feature introduces it, and "Back up…" is likely its only entry for now.
   - Only shown for `local_file`-type workspaces — hidden/disabled for `cloud` (already durably stored server-side) and `local_net` (a remote instance this app doesn't own the files for).
   - Produces the same `.zip` workspace archive format Restore reads. Since this is a Tauri desktop app, "export" here means a native save-location dialog, not a browser download — no such save-dialog wrapper exists yet (only an open-file-picker one does).

## Error Handling
No novel patterns needed — failed login, an invalid/corrupt Restore archive, or a cloud workspace failing to open (e.g. offline) all show an inline error message and leave the user on the current screen with any entered state intact, consistent with the existing pattern in `KalaidoscopeSetup`.

## Verified Technical Constraints
- `listCloudKalaidoscopes()` already exists and is fully wired to a real backend endpoint (`api/cloud/user.ts`), but is currently unused anywhere in the app — Flow 1's workspace list requires no new backend work.
- `AuthForm` + `OAuthButtons` (`features/settings/components`) already implement email/password and OAuth sign-in/sign-up — reusable directly for both the dedicated login screen and Flow 2's inline sign-in gate.
- `KalaidoscopeSetup` already supports local vs. cloud storage selection and already shows a passive "sign in via Settings" message when cloud is picked while signed out — this becomes the inline gate described in Flow 2 instead.
- `openFilePicker` (native Tauri dialog, `api/app/os-integrations.ts`) exists for file selection; there is no equivalent native save-dialog wrapper yet for Backup's "choose where to save" step.
- `switchLocalKalaidoscope` requires a workspace to already be present in `appState.availableKalaidoscopes` — Flow 1's eager merge-on-login satisfies this by construction.
- `no_kalaidoscopes_available` is the existing `appStage` that already serves as this feature's hook point for the landing screen, but `loadStoredState()` currently only routes there when `availableKalaidoscopes` is empty. It needs to also cover the case where workspaces exist but none is marked `lastOpenedKalaidoscopeId` (today that case falls through to a `bootstrap_error` dead end) — newly reachable once Flow 1 can populate multiple workspaces without the user opening any of them.
- `features/import` (Connections page) is unrelated content-ingestion and is unaffected by this work — kept intentionally distinct in naming (see Terminology).
- Zip extraction/compression can use standard Tauri file APIs. No database schema migrations required.

## Acceptance Criteria
- [ ] The onboarding landing screen (3 choices: Log in to Cloud / Create New Workspace / Restore Workspace) appears whenever there is no currently-resumable workspace — i.e. no `lastOpenedKalaidoscopeId`, whether because `availableKalaidoscopes` is empty *or* because it's non-empty but nothing is marked last-opened.
- [ ] "Log in to Cloud" shows a dedicated login screen (skipped if already signed in), then merges the user's full cloud workspace list into local storage and shows it; selecting one opens it immediately.
- [ ] The Cloud Workspaces List includes a working secondary "Create New Workspace" option.
- [ ] "Create New Workspace" opens `KalaidoscopeSetup` with both local and cloud storage available from any entry point; choosing cloud while signed out gates inline (not via redirect) and resumes creation on success.
- [ ] "Restore Workspace" accepts a `.zip` archive, copies/extracts it into local workspace storage, and opens it; if its id collides with an existing local workspace, the user is warned by name and, on confirmation, it's restored under a new unique id rather than overwriting.
- [ ] All onboarding sub-screens include a working top-left "Back" button returning to the landing screen.
- [ ] Settings → Manage Kalaidoscopes gains a per-row overflow menu with a "Back up…" action, shown only for `local_file` workspaces, producing a `.zip` archive compatible with Restore via a native save-location dialog.
- [ ] Failed login, invalid Restore archives, and offline cloud-open attempts all surface an inline error without losing entered state.
- [ ] The existing Connections page's Import/Export naming and behavior (content-level, scoped to an open workspace) is unchanged by this work.
