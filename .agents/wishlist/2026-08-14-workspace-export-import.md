---
title: "Support export and import of a workspace"
status: "specified"
author: "human"
created: "2026-08-14"
expanded: "2026-08-14"
---

## Summary
Support exporting and importing a workspace ("kalaidoscope") from the **Manage Kalaidoscopes** section of Settings. Exports support either full workspace backups (local workspaces only) or fragments-only exports (any workspace type). Imports offer full workspace restoration (as a new workspace, with an editable name) or a fragments-only merge into the currently active workspace.

## Motivation / Use Case
Enables users to back up, migrate, share, or restore complete local workspace data and files across machines, or selectively export and merge fragment datasets between workspaces (local or cloud) without database corruption, orphan files, or leaking provider credentials.

## Desired Working End State

1. **Location**:
   - Lives in the **Manage Kalaidoscopes** section of Settings (today a read-only list of workspaces — this adds the first actions to it).
   - Each listed workspace row gets an **Export** action.
   - The section also gets a single, row-independent **Import Workspace** action.
   - (Not on the Connections page — that page is being reworked to be strictly about ingesting fragments into a workspace, and is not the right home for whole-workspace operations.)

2. **Export**, per workspace row:
   - **Full Workspace Export** — offered only for `local_file` workspaces (cloud/`local_net` workspaces have no local `pb_data` to back up). Uses PocketBase's native backup endpoint (`/api/backups/create`) to produce a transactionally consistent archive of that workspace's entire local database and files — whatever collections exist, without the spec hardcoding a list that will drift as the schema evolves. **Exception**: before archiving, any stored LLM provider API key (per the BYOK wishlist item, once it ships) is stripped from the exported config.
   - **Fragments-Only Export** — offered for any workspace type (local or cloud), since it reads via PocketBase's normal record-read APIs rather than a filesystem backup. Contains only `fragment` records (content + type/source/source_time metadata). Explicitly excludes colour tags (`colour`/`colour_fragment`), reflections, projections, chat history, lenses, usage data, and all workspace/provider settings.
   - Either export prompts for a save location and writes a `.zip` archive.

3. **Import**, from the section-level action:
   - User selects a workspace `.zip` archive via file picker, then chooses a mode:

     **Mode A: Import as New Workspace (Full Restore)** — `local_file` only
     - Extracts the archive and copies it directly into a new workspace's data directory (mirroring how PocketBase's own backup/restore works), then starts a new sidecar against it. This is a raw copy, not API replay — it's what preserves original record IDs, which is required for reflections/projections to keep working (see Verified Technical Constraints).
     - Presents an editable **Workspace Name** field, pre-filled from the archive. No collision check against existing workspace names (the app doesn't enforce name uniqueness anywhere today).
     - If the restored workspace's provider config points at a BYOK provider (e.g. Gemini) whose key was stripped at export time, prompts the user post-restore to either enter a new API key or switch the workspace to Ollama.
     - Registers the new workspace and opens it immediately.
     - This is also the flow invoked by the onboarding landing screen's "Import Workspace from File" option (from the separate `rework-onboarding-initial-choices` wishlist item — that item's own, differently-described Export section and Import behavior are superseded by this spec; its landing screen simply triggers this Mode A flow).

     **Mode B: Merge Fragments into Current Workspace** — any workspace type
     - Extracts fragments from a fragments-only (or full) archive and creates them as new records in the currently active workspace via PocketBase's create-record API (fresh IDs are assigned; this mode never tries to preserve original IDs).
     - **Deduplicates**: before creating a fragment, skips it if the destination workspace already has a fragment with exactly matching content and metadata (type, source, source_time — system fields like id/created/deleted_at are not compared).
     - Deliberately excludes reflections, projections, and colour tags. (Reflections/projections reference fragments via opaque IDs embedded in a JSON field, not a real PocketBase relation — there's no schema-level integrity protecting that link, so importing them here without preserving exact original IDs would leave them silently pointing at the wrong or nonexistent fragments.)
     - Displays a completion summary: fragments imported vs. skipped as duplicates.

## Verified Technical Constraints
- A "workspace" (kalaidoscope) of type `local_file` is a separate PocketBase sidecar process with its own `pb_data` directory; `cloud`/`local_net` workspaces have no local files at all — Full Export/Mode A restore only apply to `local_file`.
- PocketBase's backup endpoint (`/api/backups/create`) captures the entire `pb_data` directory unconditionally, with no per-collection selectivity; no code currently calls it.
- Fragment → reflection/projection references live inside JSON fields (`context_spec` / `resolved_context`), not real PocketBase relations — no FK, no cascade protection. This is the concrete reason Mode A must be an ID-preserving raw copy, and Mode B cannot safely include reflections/projections.
- `colour_fragment` is a real, cascade-deleted relation between `fragment` and `colour` — deliberately left out of fragments-only scope per product decision, not a technical necessity.
- No file/media field exists on `fragment`; the schema's only file field is `ingest.file`, used for transient document-ingestion uploads, unrelated to fragments.
- No uniqueness constraint exists on workspace display names anywhere in the app today.
- Settings is currently entirely global; "Manage Kalaidoscopes" (`kalaidoscopes-section.tsx`) lists all workspaces read-only with no per-row actions today — this feature adds the first ones.
- BYOK API key storage doesn't exist yet (tracked separately in `2026-08-14-byok-llm-provider-for-local-workspaces.md`); this spec anticipates it so a plaintext key can't silently leak through a full export once BYOK ships.
- No database schema migrations required.

## Acceptance Criteria
- [ ] "Manage Kalaidoscopes" in Settings shows an Export action per workspace row (Full Workspace Export only for `local_file` rows; Fragments-Only Export for any row) and a section-level Import Workspace action.
- [ ] Full Workspace Export produces a `.zip` via PocketBase's backup endpoint, with any stored LLM provider API key stripped before archiving.
- [ ] Fragments-Only Export produces a `.zip` containing only fragment content and metadata, for any workspace type.
- [ ] Import presents the choice between "Import as New Workspace" (`local_file` only) and "Merge Fragments into Current Workspace" (any workspace type).
- [ ] Import as New Workspace performs a raw copy restore preserving original record IDs, offers an editable workspace name pre-filled from the archive (no collision check), and opens the new workspace immediately.
- [ ] If the restored workspace is configured for a BYOK provider whose key was stripped, the user is prompted after restore to enter a new key or switch to Ollama.
- [ ] Merge Fragments into Current Workspace creates fragment records via PocketBase's API, skips any fragment whose content and metadata exactly match an existing fragment in the destination, and shows an imported/skipped count on completion.
- [ ] Merge explicitly does not import reflections, projections, or colour tags.
- [ ] Onboarding's "Import Workspace from File" entry point invokes this spec's Mode A flow; the onboarding-rework item's own conflicting §4/§6 are considered superseded by this spec.
