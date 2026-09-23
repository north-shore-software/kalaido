> **STALE** — code has changed since this document was generated.

# Kalaidoscope Database Schema — Generated Audit Snapshot

> **Generated:** 2026-09-17, from source at commit `895984c`.
> This file is a generated audit snapshot — do not edit it. See `AGENTS.md` § "Generated audit docs". When code described here changes, a stale marker line is prepended above this block; nothing else in the file is ever modified by hand.

**Scope.** Every collection, field, index, access rule, and stored-JSON shape of the kalaidoscope PocketBase database, plus the schema lifecycle (canonical definition, version state, deltas, backup/restore, failed-upgrade marker, console commands, status route) and the boot-time code that touches schema values. PocketBase's own system collections (`users`, `_superusers`, …) are covered only where the code touches them. Behaviour of the rows once written belongs to the domain docs named inline.

**Completeness anchor.** `schema.Canonical` (`schema/canonical.go`) holds 22 `TableDef` entries: 21 base collections and 1 SQL view. `schema.Version` (`schema/version.go`) is `4`. Three deltas are registered in `schema/deltas/` (`v0002_add_fragment_type_edit.go`, `v0003_add_chat_message_bookmark.go`, `v0004_add_entity_deleted_at.go`); the version-1 baseline is `schema/baseline/v1.go`. No `migrations/` directory exists.

---

## 1. Migration mechanics

The `schema` package owns the schema and its lifecycle. There is no PocketBase `migratecmd` and no `Automigrate`; the lifecycle runs inside PocketBase's bootstrap, so every command, serve hook and test sees a migrated database before any collection is read.

### 1.1 Definition: `Canonical`, `TableDef`, `ApplyTables`

- `Canonical` is the latest schema as a literal `[]TableDef`. A `TableDef` names one collection: `Name`, `Type` (`""`/`"base"` or `"view"`), `ViewQuery`, the rule flags, `Fields` (PocketBase `core.Field` values) and `Indexes` (`IndexDef{Name, Unique, Columns, Where}`).
- `ApplyTables` runs two passes: pass one saves every missing base collection **empty** so relation fields can resolve their targets by name; pass two calls `ApplyTable` for every entry in definition order (views included, last by placement). `ApplyTable` sets the type, sets the rules, resolves each `RelationField.CollectionId` from a collection name to its id (a name that does not resolve is left as written), adds every field that is **missing by name** (`ensureField` never rewrites an existing field), calls `AddIndex` for every index, and saves.
- **Access rules** are derived, never written per collection: an enabled operation gets the rule `@request.auth.id != ''`; a disabled one gets a `nil` rule (superuser-only, i.e. server-written). Flags: `DisableReadOperations` (list+view), `DisableWriteOperations` (create+update+delete), and per-op `DisableCreate`/`DisableUpdate`/`DisableDelete`, each OR-ed with `DisableWriteOperations`. A view gets only list/view rules.
- A flavour binary may register an `Extension{Name, Tables, After}` via `schema.Extend`; `applyCanonical` applies `Canonical`, then each extension's `Tables` and its `After` func, in registration order. The sidecar binary in this repository registers no extension. Extensions share the single `Version` counter (a delta with `Scope: ScopeCloud` runs after the core deltas of the same version).

### 1.2 Version state: `_kalaido_schema`

- The version lives in a plain SQL table, not a collection: `_kalaido_schema (id INTEGER PRIMARY KEY AUTOINCREMENT, version INTEGER NOT NULL, applied_at TEXT NOT NULL, source TEXT NOT NULL, binary_rev TEXT NOT NULL)`. One row per version ever applied; the current version is `MAX(version)` (`0` when empty). `source` is `bootstrap` or `delta`.
- `binary_rev` (`buildRev()`): the `-X …/schema.BuildRev=<sha>` ldflag if set; else Go's `vcs.revision` when `vcs.modified` is false; else `exe-` + the first 16 hex chars of the SHA-256 of the running executable; else `""`.
- A fresh database is stamped with **one** row at `Version` (`source = bootstrap`); it does not receive rows for 1..Version-1.

### 1.3 The runner (`schema.Install`, bound to `OnBootstrap` after PocketBase's own bootstrap)

Mode is read from `os.Args` at install time: `schema status` → inspect (report only, never create or upgrade); `schema retry` → clear the failed marker first; anything else → normal. Then, in order:

1. Read the failed marker (§ 1.5).
2. If `_kalaido_schema` does not exist: if a `fragment` collection exists the boot fails with `schema: this database predates schema versioning and cannot be upgraded; delete it and start again`; in inspect mode the status is recorded (version `0`) and nothing is created; otherwise `applyCanonical` runs, the state table is created, one `bootstrap` row is stamped at `Version`.
3. If the stored version is **greater** than `Version`: prints `KALAIDO_SCHEMA_NEWER={"version":N,"latest":M}` to stdout and fails the boot (`update Kalaido`). A binary never opens a newer database.
4. If inspect mode or already at `Version`: record status, done.
5. If a failed marker exists and its `binaryRev` equals this build's `buildRev()`: report it and fail with `ErrMigrationFailed` (`not retrying`). A marker from a different build (or an empty rev) is cleared and the upgrade proceeds.
6. `upgrade`: create one pre-migration backup (§ 1.5), then for each `v` from `current+1` to `Version` run every delta registered for `v` (sorted `ScopeCore` before `ScopeCloud`, registration order within a scope) and stamp a `delta` row for `v`. Each PocketBase save inside a delta is its own transaction; there is no per-delta or per-upgrade transaction. Any error → `fail` (§ 1.5).

`schema.Upgrade` exposes the normal-mode run for tests; `BootstrapFrom(app, baseline.Apply)` builds a version-1 database and stamps `1`/`bootstrap`.

### 1.4 Deltas (`schema/deltas/`, blank-imported by `server`)

- `RegisterDelta(Delta{Version, Scope, Name, Up})` panics on `Version < 2`, a nil `Up`, or an empty `Name`. Helpers: `Modify(app, name, fn)` (load, mutate, save; does **not** resolve relation targets by name), `AddCollection(def)` (= `ApplyTable`), `DropCollection(name)` (missing is not an error).
- Registered deltas and what they change:

| Version | Name | Change |
|---|---|---|
| 2 | `add_fragment_type_edit` | `fragment.type` select values become `email, note, chat, edit` |
| 3 | `add_chat_message_bookmark` | `chat_message` gains `bookmarked` (bool) and `fragment_id` (relation → `fragment`, max 1, no cascade) |
| 4 | `add_entity_deleted_at` | `projection` and `reflection` gain `deleted_at` (date) and index `idx_<name>_deleted_at (deleted_at)` |

- Invariants enforced by tests in the package: `parity_test.go` boots one database from `Canonical` and another from `baseline.V1` plus every delta and requires `Snapshot` (collections minus ids/timestamps, relation targets by name, indexes sorted) to be identical, and both to report `Version` with no failed marker; `delta_lint_test.go` fails any delta file whose AST references the identifier `Canonical`, and any delta whose version is outside `(1, Version]`.
- `./kalaido.sh schema:freeze` copies `canonical.go` into `baseline/v1.go`; the script refuses unless `Version` is `1`.

### 1.5 Backup, restore, and the failed marker

- **Backup**: `VACUUM INTO '<pb_data>/backups/pre-migration-v<from>-<unix seconds>.db'` (consistent, WAL included, taken with the database open). After each backup the directory is pruned to the newest 3 `pre-migration-v*.db` files by modification time.
- **Failure** (`fail`): builds a `Failure{from, to, delta, error, backup, restored, at, binaryRev}`; calls `app.ResetBootstrapState()` (closes every connection), then `Options.BeforeRestore` if set, then `restoreBackup`: removes `data.db-wal` and `data.db-shm`, copies the backup to `data.db.restoring`, renames it over `data.db`. `restored` is `true` only if that succeeded; errors from each step are appended to `error`. The marker is written to `<pb_data>/schema-migration-failed.json`, the failure is printed to stderr (`schema migration to v<to> failed in <delta>: … Database restored to v<from> … Update Kalaido to retry.` or `Restore FAILED; the database may be inconsistent`) and as `KALAIDO_MIGRATION_FAILED=<json>` on stdout, and the boot ends with `ErrMigrationFailed`.
- **Marker semantics** (§ 1.3 step 5): the same build never retries; a different build clears the marker and retries; `schema retry` clears it unconditionally.

### 1.6 Commands and the status surface

- `schema bootstrap --dir D` (create or upgrade, print status, exit), `schema status --dir D` (inspect only), `schema retry --dir D` (clear marker, then upgrade). All three print the status the runner recorded at bootstrap as indented JSON.
- `Status` JSON: `{version, latest, failed, history: [{version, appliedAt, source, binaryRev}]}`; `failed` is the marker object or `null`; `version` is `0` and `history` is `null` for a database with no state table.
- `GET /api/schema` returns `CurrentStatus` as `200` JSON (`500` on a read error); every HTTP response carries `X-Kalaido-Schema-Version: <Version>`. Neither registers auth middleware (`api.md` § 13). Nothing is enforced on requests.

Every base collection also has PocketBase's implicit `id`. `created`/`updated` are `AutodateField`s where listed and keep PocketBase's names; the definition's stated convention is that timestamps the application sets end in `_at`, relation fields end in `_id`. Date fields store PocketBase's `YYYY-MM-DD HH:MM:SS.sssZ` form; the empty string is the zero value every `= ''` filter below tests. A single-value `select` is stored as plain text, which every status filter and partial index relies on. A `text` field is capped at 5000 characters by PocketBase unless `Max` is set; the three document-carrying fields (`fragment.content`, `lens.prompt`, `*_snapshot.output`) set 100,000,000. "Client" below means the authenticated `users` record.

## 2. Collections

Rule summary (client access):

| Collection | List/View | Create | Update | Delete |
|---|---|---|---|---|
| `ingest` | ✓ | ✓ | — | — |
| `kalaidoscope_config` | ✓ | — | ✓ (hook-guarded) | — |
| `lens` | — | — | — | — |
| all others (including `view_stream`) | ✓ | — | — | — |

### 2.1 `fragment` — ingested content units

| Field | Type | Notes |
|---|---|---|
| `type` | select(1), required | `email`, `note`, `chat`, `edit`. `chat` is written by the bookmark save (`chat.SaveBookmarks`); `edit` by the candidate hand-edit (`engine.ApplyEdit`) with `source` = `edit to projection "<name>" (candidate <id>)` |
| `ingested_via` | select(1) | `import`, `app`, `sync`; defaulted to `app` by the create hook (§ 4) |
| `source` | text | free-text attribution (never parsed); the bookmark save writes `chat:<client conversation id>:<UIMessage id>` |
| `content` | text, required | max 100,000,000 chars |
| `occurred_at` | date | defaulted to now by the create hook when zero; the bookmark save sets it to the message row's `created` |
| `deleted_at` | date | soft delete; set by the delete-request hook (§ 4). Readers that filter `deleted_at = ''`: `view_stream`, context resolution, the annotate and consolidate passes, the colour worker, the colour preview sample, the organize fragment count, and the bookmark re-save check |
| `created` | autodate | |

Indexes: `idx_fragment_occurred_at (occurred_at)`, `idx_fragment_deleted_at (deleted_at)`.

No code path hard-deletes a fragment (`app.Delete` is never called on one).

### 2.2 `ingest` — async file-ingestion jobs

| Field | Type | Notes |
|---|---|---|
| `file` | file | up to 50 files, 200 MiB each |
| `format` | select(1) | `zip`, `mbox`, `docx`, `text`; empty = inferred per file from its name |
| `fragment_limit` | number | 0 = no limit |
| `extensions` | text | comma-separated zip member filter; empty = parser default |
| `skip_duplicates`, `organize_after` | bool | |
| `status` | select(1) | `pending`, `done`, `error`; the create hook forces `pending` (§ 4); the batch sets `done` or `error` |
| `ingested` | number | |
| `error` | text | set with `error` |
| `created`, `updated` | autodate | |

No indexes. No pipeline state beyond `status` is stored on the row (`organize.md` § 8).

### 2.3 `colour` — tag definitions

| Field | Type | Notes |
|---|---|---|
| `name` | text, required | |
| `swatch` | number | `CountRecords("colour") % 8` at creation by both writers (create handler, discover colours flow); never changed afterwards |
| `prompt` | text | |
| `thing_ids` | json | string array of map thing ids; written by the discover colours flow only |
| `prompt_match_completed_up_to_fragment_id` | relation(1) → `fragment` | prompt-matching watermark: the worker sets it to the id of the last fragment judged in a batch; `colour.Rematch` (prompt change, rematch route) clears it after deleting the colour's `prompt` rows; no cascade |
| `last_provider_error_kind` | text | the `ProviderError.Kind` of the worker's last durable failure; written only when it changes; cleared to `""` on the next success |
| `created_by_discover_run_id` | relation(1) → `discover_run` | empty = human-created |
| `created`, `updated` | autodate | |

No indexes. The delete handler hard-deletes the row (`tx.Delete`) after scrubbing its id from every `current_context_spec` (§ 3).

### 2.4 `colour_fragment` — colour↔fragment links

| Field | Type | Notes |
|---|---|---|
| `colour_id` | relation(1) → `colour`, required, cascade | |
| `fragment_id` | relation(1) → `fragment`, required, cascade | |
| `match_type` | select(1), required | `manual_positive`, `manual_negative`, `thing`, `prompt`; a `manual_negative` row is an exclusion (`colours.md` § 2) |
| `created` | autodate | |

Indexes: `idx_colour_fragment_colour (colour_id)`, `idx_colour_fragment_fragment (fragment_id)`, `idx_colour_fragment_pair (colour_id, fragment_id)` **unique**. Rows are hard-deleted by the colour package (`Rematch` deletes the colour's `prompt` rows, thing rematch deletes `thing` rows no longer wanted, `ClearManual` deletes a `manual_*` row).

### 2.5 `projection` / 2.6 `reflection` — synthesis entities

| Field | Type | Notes |
|---|---|---|
| `name` | text | |
| `status` | select(1), required | `proposed` (discover-created), `active` (handler-created, or promoted) |
| `current_context_spec` | json | § 3; written by discover, `CommitRefinement`, the hand edit (appends the new `edit` fragment id to `fragmentIds`), the colour-delete scrub (`colourIds`) and the entity soft-delete scrub (`sourceProjectionIds` / `sourceReflectionIds`) |
| `window_spec_versions` | json | **reflection only**; § 3; the create handler writes version 1 (`effectiveFrom` = the spec's `startTime` if earlier than now, else now); each `PATCH` with `windowSpec` appends the next version |
| `current_lens_id` | relation(1) → `lens` | no cascade; set by `CommitRefinement` |
| `generate_with_model` | text | per-entity override; set by `PATCH` (trimmed) |
| `pinned_by` | relation(≤999) → `users` | |
| `created_by_discover_run_id` | relation(1) → `discover_run` | empty = human-created |
| `description` | text | set at create (trimmed, only when non-empty) and by discover; no update path |
| `deleted_at` | date | soft delete (v4): `engine.SoftDelete` sets now, `engine.Restore` sets `""`; both no-ops when already in that state. The delete handler answers `409` while a `generating` claim younger than `GenerationClaimTTL` exists for the entity, and before stamping removes the entity's id from `sourceProjectionIds` / `sourceReflectionIds` in every `projection` and `reflection` `current_context_spec` (restore does not re-add it). Children are left in place. Readers of live entities use `engine.LiveFilter` (`deleted_at = ''`): `FindLive`, the status evaluator, discover's `list_existing`, the organize proposed counts; upstream-snapshot resolution filters `projection_id.deleted_at = ''` / `reflection_id.deleted_at = ''` |
| `created`, `updated` | autodate | |

Indexes: `idx_projection_status (status)`, `idx_projection_deleted_at (deleted_at)`; `idx_reflection_status (status)`, `idx_reflection_deleted_at (deleted_at)`. No code path hard-deletes either entity.

### 2.7 `lens` — generation prompts (lenses)

| Field | Type | Notes |
|---|---|---|
| `prompt` | text | max 100,000,000 chars |
| `created_from_projection_refinement_id` | relation(1) → `projection_refinement` | no cascade; set by a projection commit |
| `created_from_reflection_refinement_id` | relation(1) → `reflection_refinement` | no cascade; set by a reflection commit |
| `parent_lens_id` | relation(1) → `lens` | the entity's previous `current_lens_id`, when it had one |
| `created` | autodate | |

Read **and** write disabled for clients. No indexes. Both strategies name the same collection (`LensCollectionName() == "lens"`). Rows are only ever created (`CommitRefinement`, `refinement.md` § 5); a lens carries no context spec.

### 2.8 `projection_snapshot` / 2.9 `reflection_snapshot` — generated outputs

| Field | Type | Notes |
|---|---|---|
| `projection_id` / `reflection_id` | relation(1), required, cascade | |
| `status` | select(1), required | `generating` (the claim row: FK, status, and for reflections the window, nothing else), `pending_review`, `approved`, `discarded`. A claim older than `GenerationClaimTTL` (10 min) is deleted by the next claim attempt for the same target/window; a failed generation deletes its own unfilled claim; filling a claim, settling an approved row in place, or approving one candidate sets every other `pending_review` row for the same target/window to `discarded`; the boot sweep deletes every `generating` row (§ 4) |
| `context_spec` | json | § 3 |
| `resolved_context` | json | § 3 |
| `window_start`, `window_end` | date | **reflection only**; both empty for an unscheduled reflection |
| `lens_id` | relation(1) → `lens` | |
| `output` | text | max 100,000,000 chars |
| `created_from_refinement_id` | relation(1) → the matching refinement collection | set on commits; left empty by the hand edit |
| `generated_by_model` | text | |
| `generation_trigger` | select(1) | `generate_all` or empty; left empty by the hand edit |
| `approval_sequence_number` | number | set on approval |
| `approved_at` | date | set on approval |
| `generated_at` | date | set when a generation or commit fills the row; not set on the claim row |
| `created`, `updated` | autodate | |

Indexes: `idx_projection_snapshot_projection (projection_id)`; `idx_projection_snapshot_approval_seq (projection_id, approval_sequence_number)` **unique where `status = 'approved'`**; `idx_reflection_snapshot_reflection (reflection_id)`; `idx_reflection_snapshot_approval_seq (reflection_id, window_start, window_end, approval_sequence_number)` **unique where `status = 'approved'`**.

The schedule version that produced a reflection window is not recorded on the snapshot (`windows.md` § 4).

### 2.10 `projection_refinement` / 2.11 `reflection_refinement` — refinement sessions

| Field | Type | Notes |
|---|---|---|
| `projection_id` / `reflection_id` | relation(1), cascade | |
| `projection_snapshot_id` / `reflection_snapshot_id` | relation(1), cascade | the projection create handler sets it from `snapshotId` when given; the reflection create handler never sets it |
| `external_conversation_id` | text | client id |
| `created` | autodate | |

Indexes: `idx_projection_refinement_external (external_conversation_id)` **unique**, `idx_projection_refinement_projection (projection_id)`, `idx_projection_refinement_snapshot (projection_snapshot_id)`; `idx_reflection_refinement_external (external_conversation_id)` **unique**, `idx_reflection_refinement_reflection (reflection_id)`, `idx_reflection_refinement_snapshot (reflection_snapshot_id)`.

### 2.12 `chat_conversation` — free-chat sessions

`external_conversation_id` text (**unique** index `idx_chat_conversation_external`), `generate_with_model` text, `created`. Created by `FindOrCreateConversation` on the first chat turn (a unique-index failure falls back to the existing row). `generate_with_model` is read by the chat turn, the brief, and the token estimate, and has no writer in this binary (clients cannot write the collection).

### 2.13 `chat_message` — messages for all three conversation kinds

| Field | Type | Notes |
|---|---|---|
| `chat_conversation_id` | relation(1) → `chat_conversation`, cascade | `PersistMessage` sets exactly one of the three from the owning record's collection |
| `projection_refinement_id` | relation(1) → `projection_refinement`, cascade | |
| `reflection_refinement_id` | relation(1) → `reflection_refinement`, cascade | |
| `content` | json | a full `UIMessage` (§ 3); the message's own `id` lives inside it, so lookups by message id scan the conversation's rows |
| `generated_by_model` | text | the model passed by the persister; `""` for user and system rows |
| `bookmarked` | bool | (v3) set by `PATCH …/messages/{mid}/bookmark`, plain-chat rows only, `422` for a `system` row |
| `fragment_id` | relation(1) → `fragment`, no cascade | (v3) stamped by the bookmark save with the fragment the row became; a stamped row whose fragment is missing or soft-deleted is re-saved as a new fragment and re-stamped |
| `created`, `updated` | autodate | a refinement's streaming assistant row is rewritten in place (`RewriteMessage`) |

Indexes: `idx_chat_message_chat_conv (chat_conversation_id)`, `idx_chat_message_projection_refinement (projection_refinement_id)`, `idx_chat_message_reflection_refinement (reflection_refinement_id)`. The bookmark save selects `chat_conversation_id = {:cid} && bookmarked = true`.

### 2.14 `usage` — per-period token accounting

`period` text required (**unique** `idx_usage_period`; `YYYY-MM` in UTC), `prompt_tokens`, `completion_tokens`, `total_tokens`, `cached_tokens` numbers, `created`, `updated`. `usage.Record` upserts the current period inside a transaction, adding each counter, and retries once (`llm-queue-quota.md` § 5).

### 2.15 `llm_queue_status` — live scheduler mirror (singleton)

`state` select(1) (`idle`, `active`), `running`, `waiting`, `held` json, `created`, `updated`. The first row found is reused; one is created if none exists. `state` is `active` when `running` or `waiting` is non-empty. Reset to an empty status at boot; later writes are debounced 300 ms and drop out-of-order versions; excluded from the SQL write echo log.

### 2.16 `kalaidoscope_config` — workspace config (singleton)

`model_set`, `provider`, `api_key`, `default_model` text; `role_models` json; `created`, `updated`. Create and delete disabled; update open to clients, with `model_set` superuser-only by hook (§ 4). `api_key` is stored in plain text; the enrich hook hides it from every response without superuser auth (`Record.Hide`), so a client can write it but never read it back. The `Hidden` field flag is not used. `role_models` is decoded as `map[string]string`; empty values are skipped and an unparseable value is logged and ignored (`models.md` § 3).

### 2.17 `view_stream` — SQL view

Read-only. One row per fragment with `deleted_at = ''`: `id`, `type`, `content`, `occurred_at`, `created`, `title` (`fragment_annotation.title` via left join; null when unannotated), and `colour_ids` = `json_group_array` of the `colour_id`s of the fragment's `colour_fragment` rows with `match_type != 'manual_negative'`, `'[]'` when none.

### 2.18 `reflection_window` — explicitly backfilled windows

`reflection_id` relation(1) required cascade; `window_start`, `window_end` date required; `created`. Indexes: `idx_reflection_window_reflection (reflection_id)`, `idx_reflection_window_bounds (reflection_id, window_start, window_end)` **unique**. Written only by `MaterializeBackfill`; a save that fails is accepted when a row with the same bounds already exists (the unique index makes re-running a no-op). Grid windows are never stored here (`windows.md` § 6.1).

### 2.19 `fragment_annotation` — per-fragment map markup

| Field | Type | Notes |
|---|---|---|
| `fragment_id` | relation(1) → `fragment`, required, cascade | **unique** `idx_fragment_annotation_fragment` |
| `title`, `summary` | text | |
| `things`, `decisions`, `questions`, `conclusions` | json | § 3; each written as raw JSON by the annotate worker |
| `consolidated_at` | date | set by the consolidate pass on every row it read (selected by `consolidated_at = ''`), to the same instant as `kalaidoscope_map.consolidated_at`; indexed `idx_fragment_annotation_consolidated_at` |
| `generated_from_map_version` | number | the `kalaidoscope_map.version` the annotation was grounded on |
| `generated_by_model` | text | |
| `created` | autodate | |

Written once by an annotate worker and updated once by consolidate (`map.md` § 2, § 3.3).

### 2.20 `kalaidoscope_map` — the things document (singleton)

`body` json (§ 3), `version` number, `consolidated_at` date, `created`, `updated`. `loadDocument` takes the first row (`1=1`, limit 1) and creates one with `version = 0` when none exists; consolidate saves the body and sets `version` to `version + 1` and `consolidated_at`.

### 2.21 `map_run` — one row per consolidation call

`status` select (`running`, `done`, `error`) required; `error`, `generated_by_model` text; `pending_in`, `merges`, `admits`, `version_before`, `version_after` numbers; `created`, `updated`. Created as `running` before the model call; a process that dies mid-call leaves the row `running`. Never pruned.

### 2.22 `discover_run` — one row per discover run

`kind` select (`projections`, `reflections`, `colours`) required; `status` select (`running`, `done`, `error`) required; `error`, `generated_by_model`, `summary` text; `map_version`, `rounds`, `fragment_reads` numbers; `outputs` json (§ 3); `created`, `updated`. `newRun` writes `kind`, `status = running`, `map_version`, `generated_by_model`, `rounds = 0`, `fragment_reads = 0`, `outputs = []`; progress saves rewrite `rounds`, `fragment_reads`, `outputs`; the finish sets `done` or `error` (+ `error`), and `summary` holds the model's closing text (`discover.md` § 1).

## 3. Stored JSON shapes

| Where | Shape |
|---|---|
| `*.current_context_spec`, `*_snapshot.context_spec` | `api.ContextSpec`: `{wholeScope?, fragmentIds?, fragmentTypes?, colourIds?, sourceProjectionIds?, sourceReflectionIds?}`; `wholeScope` is `"full"` or `"summaries"`; every key `omitempty` (`context.md` § 1). The colour-delete scrub removes an id from `colourIds`, and the entity soft-delete scrub from `sourceProjectionIds` / `sourceReflectionIds`, of every `projection` and `reflection` row matching `current_context_spec ~ {:id}` (soft-deleted rows included) |
| `*_snapshot.resolved_context` | `llmcontext.PinnedIDs`: `{fragmentIds?, snapshotIds?, expandedIds?}` — `expandedIds` is a rendering hint that `IsEmpty`/`Diff` ignore (`context.md` § 5) |
| `reflection.window_spec_versions` | `[api.WindowSpecVersion{versionNumber, effectiveFrom, spec: api.WindowSpec{mode?, startTime, endTime?, period, duration}}]` (`windows.md` § 2) |
| `chat_message.content` | `api.UIMessage{id, role, parts: [{type, text?, data?}]}`. Part types the backend writes: `text`; `context_spec` (data = `ContextSpec`), `window` (data = `api.Window{id, start, end}`), `pinned_ids` (data = `PinnedIDs`) on `system` rows; `tool-<name>` with data `{toolCallId, toolName, input}` (`update_lens`, `suggest_name` from refinement tool calls; `apply_result` synthesised by the apply leg; `update_lens`/`apply_result` seeded on a reflection session's first turn) or `{toolCallId, toolName, input, output, state: "output-available"}` (`read_fragment`, `read_thing` in chat summaries mode); `data-refine_lint`, `data-refine_error`, `data-window_reapply`, `data-lens_seed` (data `{}`). The `bookmarked`/`fragment_id` state is on the row, not in `content` |
| `colour.thing_ids` | `["<thing id>", …]` |
| `kalaidoscope_map.body` | `mapdoc.Document`: `{things: [{id, name, aliases[], kind, blurb, fragments, first_seen?, last_seen?, exemplar_ids[]}], relationships: [{from, to, kind}], narrative}` |
| `fragment_annotation.things` | `[prompts.ThingCitation{ref?, name?, kind?, note?}]`; `decisions`/`questions`/`conclusions`: `[prompts.Assertion{text, refs[]}]` |
| `discover_run.outputs` | `[discover.Output{kind, id, name, status?}]`; `kind` is `colour`, `projection` or `reflection`; `status` is `proposed` for the latter two and absent for colours |
| `kalaidoscope_config.role_models` | `{"<role>": "<model>"}` |
| `llm_queue_status.running` / `waiting` / `held` | `[llmq.TaskInfo{role, priority, model, started, tokens?, tokens_per_second?}]` (`[]` when none) / `{"<priority>": count}` (`{}` when none) / `llmq.Held{reason, until?}` or `null` (`llm-queue-quota.md` § 2.6) |

## 4. Boot-time schema interactions

- `schema.Install` (on bootstrap, after PocketBase's own) runs the lifecycle in § 1.3 before any serve hook; `registerWriteEcho` (on bootstrap, non-dev only) installs the SQL write log, skipping `llm_queue_status` and every `_`-prefixed table.
- `engine.SweepGenerationClaims` (on serve, in `server.NewWithSchema`) deletes every `projection_snapshot`/`reflection_snapshot` row with `status = 'generating'`.
- `usage.Setup` (on serve) fails boot unless `usage` has a single-column unique index on `period`.
- `registerQueueStatus` (on serve) writes an empty status to the `llm_queue_status` singleton (creating it if absent) and subscribes to scheduler changes.
- `resolveModelSet` (on serve, from `cmd/sidecar`) finds or creates the `kalaidoscope_config` singleton; when `model_set` is empty it seeds it from `KALAIDO_MODEL_SET` (default `local`; an unparseable value is fatal); otherwise the stored value wins, an unparseable stored value is fatal, and a differing environment value is logged and ignored. `config.LoadAtBoot` (on serve) publishes the stored provider config when `provider` is set.
- `seedSidecarUser` (on serve, from `cmd/sidecar`) upserts the `users` record `user@kalaido.local`, sets its password from `KALAIDO_USER_PASSWORD` or a random one, and prints `KALAIDO_USER_TOKEN=<jwt>` to stdout. `se.InstallerFunc` is set to nil; no `_superusers` record is ever created by the binary.
- `mapping.loadDocument` creates the `kalaidoscope_map` singleton (`version 0`) on first use, not at boot.
- Record hooks that touch schema values: `fragment` `OnRecordCreate` defaults `occurred_at` to now and `ingested_via` to `app` (model-level, so programmatic saves too); `fragment` `OnRecordAfterCreateSuccess` only signals workers (`ingestion.md` § 7); `fragment` `OnRecordDeleteRequest` sets `deleted_at` (if unset) instead of deleting and answers `204` — reachable only with superuser auth, since the client delete rule is `nil`; `ingest` `OnRecordCreate` forces `status = pending` and starts the batch; `kalaidoscope_config` `OnRecordUpdateRequest` rejects `403` when a non-superuser body contains `model_set`, `OnRecordUpdate` (model-level) rejects `400` when a provider is set without a model and validates a credentialed provider's models before the row is written, and `OnRecordEnrich` hides `api_key` from non-superusers.

## 5. Cascade graph

Deleting → also deletes:

- `fragment` (hard delete only; no code path performs one) → `colour_fragment`, `fragment_annotation`; `colour.prompt_match_completed_up_to_fragment_id` and `chat_message.fragment_id` pointing at it are cleared, not cascaded.
- `colour` (hard-deleted by its delete handler) → `colour_fragment`.
- `projection` (hard delete only; the API soft-deletes) → `projection_snapshot` → `projection_refinement` (via `projection_snapshot_id`) → `chat_message`; also `projection_refinement` directly (via `projection_id`).
- `reflection` (hard delete only; the API soft-deletes) → `reflection_snapshot` → `reflection_refinement` (via `reflection_snapshot_id`) → `chat_message`; also `reflection_window` and `reflection_refinement` directly (via `reflection_id`).
- `chat_conversation` → `chat_message`.
- Nothing cascades to or from `lens`, `discover_run`, `map_run`, `users`; deleting a `discover_run` leaves `created_by_discover_run_id` empty on its entities, and deleting a `users` record clears it from `pinned_by` (PocketBase clears the relation value).
