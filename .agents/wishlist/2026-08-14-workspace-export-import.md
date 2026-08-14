---
title: "Support export and import of a workspace"
status: "specified"
author: "human"
created: "2026-08-14"
expanded: "2026-08-14"
---

## Summary
Support exporting and importing a workspace via the **Connections** page (`/connections`). Exports support either full workspace backups or fragments-only exports. Imports inject data cleanly through PocketBase APIs, supporting full workspace restoration (with editable workspace name) or fragment merges into an existing workspace.

## Motivation / Use Case
Enables users to back up, migrate, share, or restore complete workspace data and files across machines, or selectively export and merge fragment datasets into existing workspaces without database corruption or orphan files.

## Desired Working End State

1. **Connections Page Location**:
   - Located on the **Connections** page (`/connections`) in the left navigation sidebar.
   - Both **Export** and **Import** are promoted to active, available connection features.

2. **Workspace Export Options**:
   - User clicks **Export** on the Connections page and selects an export scope:
     - **Full Workspace Export**: Uses PocketBase's backup endpoint (`/api/backups/create`) to generate a transactionally consistent backup archive of `data.db`, workspace settings, fragments, reflections, projections, and uploaded media.
     - **Fragments-Only Export**: Exports an archive containing strictly fragments and their associated media files, omitting reflections, projections, and workspace configurations—ideal for sharing datasets between workspaces.
   - Prompts the user for a save location on their computer and writes out the `.zip` archive file.

3. **Workspace Import & PocketBase API Injection**:
   - User selects a workspace `.zip` archive file via file picker.
   - All data ingestion occurs cleanly through **PocketBase APIs** (creating records and uploading files via PocketBase collection endpoints) rather than raw SQLite/file copying, guaranteeing data validation and proper relation integrity.
   - The user is presented with two explicit import modes:

     **Mode A: Import as New Workspace (Full Restore)**
     - Restores workspace data and files.
     - Provides an editable **Workspace Name** field, pre-filled with the archive's workspace name, allowing the user to rename it before creation.
     - Registers the new workspace in local scopes and opens it immediately upon completion.

     **Mode B: Merge Fragments into Current Workspace (Fragment Merge)**
     - Extracts and injects **fragments and their associated media/files only** into the currently active workspace using PocketBase APIs.
     - Deliberately excludes projections and reflections from the import to prevent ID/state conflicts in the destination workspace.
     - Displays a summary of imported fragments upon completion.

4. **Onboarding Integration**:
   - The "Import Workspace from File" option on the main Onboarding Landing page executes Mode A (Full Restore as a New Workspace).

## Verified Technical Constraints
- PocketBase provides a native backup endpoint (`/api/backups`) for full database/file archives.
- PocketBase SDK/REST client APIs support record creation and file attachments for programmatic fragment ingestion.
- Connections page (`Connections.tsx`) already contains UI row structures for `Import` and `Export`.
- Local scope registration (`local-scopes.ts`) handles directory creation and registration for imported workspaces.
- No database schema migrations required.

## Acceptance Criteria
- [ ] Connections page displays active **Export** and **Import** connection options.
- [ ] Export offers choices for "Full Workspace Export" and "Fragments-Only Export".
- [ ] Full export uses PocketBase backup APIs to generate a consistent `.zip` archive.
- [ ] Fragment-only export packages fragments and media files without projections, reflections, or system settings.
- [ ] Importing a workspace archive presents the choice between "Import as New Workspace" and "Merge Fragments into Current Workspace".
- [ ] Importing injects records and files via PocketBase client APIs rather than raw file overwrites.
- [ ] "Import as New Workspace" allows editing the workspace name before creating and opening it.
- [ ] "Merge Fragments into Current Workspace" imports fragments and media only, leaving existing projections/reflections untouched.
- [ ] Importing from the Onboarding landing screen successfully creates and opens a new workspace from an archive file.
