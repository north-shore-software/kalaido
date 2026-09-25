# Kalaidoscope Database Schema — Generated Audit Snapshot

> **Generated:** 2026-09-25, from source at commit `1c94d69`.
> This file is a generated audit snapshot — do not edit it. See `AGENTS.md` § "Generated audit docs". When code described here changes, a stale marker line is prepended above this block; nothing else in the file is ever modified by hand.

**Scope.** Every collection, field, index, access rule, and stored-JSON shape of the kalaidoscope PocketBase database, plus the schema lifecycle (canonical definition, version state, deltas, backup/restore, failed-upgrade marker, console commands, status route) and the boot-time code that touches schema values. PocketBase's own system collections (`users`, `_superusers`, …) are covered only where the code touches them. Behaviour of the rows once written belongs to the domain docs named inline: `ingestion.md`, `map.md`, `colours.md`, `discover.md`, `lifecycle-projection.md`, `lifecycle-reflection.md`, `windows.md`, `refinement.md`, `context.md`, `explore.md`, `reconcile.md`, `models.md`, `llm-queue-quota.md`; the boot order itself is `boot-and-workers.md`.

**Completeness anchor.** `schema.Canonical` (`schema/canonical.go`) holds 22 `TableDef` entries: 21 base collections and 1 SQL view, and `schema/constants.go` declares exactly 21 `Collection` constants (one per base collection; `constants_test.go` enforces the match). `schema.Version` (`schema/version.go`) is `5`. Four deltas are registered in `schema/deltas/` (`v0002_add_fragment_type_edit.go`, `v0003_add_chat_message_bookmark.go`, `v0004_add_entity_deleted_at.go`, `v0005_add_snapshot_outputs_and_edits.go`); the version-1 baseline is `schema/baseline/v1.go`. No `migrations/` directory exists.

---

## 1. Migration mechanics

The `schema` package owns the schema and its lifecycle. There is no PocketBase `migratecmd` and no `Automigrate`; the lifecycle runs inside PocketBase's bootstrap (`schema.Install` binds to `OnBootstrap` after PocketBase's own handler), so every command, serve hook and test sees a migrated database before any collection is read.

### 1.1 Definition: `Canonical`, `TableDef`, `ApplyTables`

- `Canonical` is the latest schema as a literal `[]TableDef`. A `TableDef` names one collection: `Name`, `Type` (`""`/`"base"` or `"view"`), `ViewQuery`, the rule flags, `Fields` (PocketBase `core.Field` values) and `Indexes` (`IndexDef{Name, Unique, Columns, Where}`).
- `ApplyTables` runs two passes: pass one saves every missing base collection **empty** (views skipped) so relation fields can resolve their targets by name; pass two calls `ApplyTable` for every entry in definition order (the view is last by placement). `ApplyTable` loads the collection by name or creates a base one, sets the type and rules, resolves each `RelationField.CollectionId` from a collection name to its id (a name that does not resolve is left as written), adds every field that is **missing by name** (`ensureField` never rewrites an existing field), calls `AddIndex` for every index, and saves.
- **Access rules** are derived, never written per collection: an enabled operation gets the rule `@request.auth.id != ''`; a disabled one gets a `nil` rule (superuser-only, i.e. server-written). Flags: `DisableReadOperations` (list+view), `DisableWriteOperations` (create+update+delete), and per-op `DisableCreate`/`DisableUpdate`/`DisableDelete`, each OR-ed with `DisableWriteOperations`. A view gets only list/view rules. A `TableDef` whose `Type` is neither empty, `base` nor `view` gets no type and no rules set.
- A flavour binary may register an `Extension{Name, Tables, After}` via `schema.Extend`; `applyCanonical` applies `Canonical`, then each extension's `Tables` (via `ApplyTables`) and its `After` func, in registration order. The sidecar binary in this repository registers no extension. Extensions share the single `Version` counter (a delta with `Scope: ScopeCloud` runs after the `ScopeCore` deltas of the same version).

### 1.2 Version state: `_kalaido_schema`

- The version lives in a plain SQL table, not a collection: `_kalaido_schema (id INTEGER PRIMARY KEY AUTOINCREMENT, version INTEGER NOT NULL, applied_at TEXT NOT NULL, source TEXT NOT NULL, binary_rev TEXT NOT NULL)`. One row per version ever applied; the current version is `COALESCE(MAX(version), 0)`. `source` is `bootstrap` or `delta`; `applied_at` is `types.NowDateTime().String()`.
- `binary_rev` (`buildRev()`): the `-X …/schema.BuildRev=<sha>` ldflag if set; else Go's `vcs.revision` when `vcs.modified` is not `"true"`; else `exe-` + the first 16 hex chars of the SHA-256 of the running executable; else `""` (when the executable cannot be located, opened or read).
- A fresh database is stamped with **one** row at `Version` (`source = bootstrap`); it does not receive rows for 1..Version-1.

### 1.3 The runner (`schema.Install`, bound to `OnBootstrap` after PocketBase's own bootstrap)

Mode is read from `os.Args` at install time (`modeFromArgs`: `args[1] == "schema"` and `args[2]`): `schema status` → inspect (report only, never create or upgrade); `schema retry` → clear the failed marker first; anything else → normal. Then, in order:

1. In retry mode, remove the failed marker (a missing marker is not an error). Read the failed marker (§ 1.5); an unreadable marker fails the boot.
2. If `_kalaido_schema` does not exist: if a `fragment` collection exists the boot fails with `schema: this database predates schema versioning and cannot be upgraded; delete it and start again`; in inspect mode the status is recorded (version `0`) and nothing is created; otherwise `applyCanonical` runs, the state table is created, one `bootstrap` row is stamped at `Version`, and the status is recorded.
3. If the stored version is **greater** than `Version`: prints `KALAIDO_SCHEMA_NEWER={"version":N,"latest":M}` to stdout and fails the boot (`… this build supports up to vM; update Kalaido`). A binary never opens a newer database.
4. If inspect mode or already at `Version`: record status, done.
5. If a failed marker exists and its `binaryRev` is non-empty and equals this build's `buildRev()`: report it (§ 1.5) and fail with `ErrMigrationFailed` (`the previous attempt by this build failed (vF -> vT, <delta>); not retrying`). A marker from a different build, or with an empty rev, is cleared and the upgrade proceeds.
6. `upgrade`: create one pre-migration backup (§ 1.5), then for each `v` from `current+1` to `Version` run every delta registered for `v` (stable-sorted `ScopeCore` before `ScopeCloud`, registration order within a scope) and stamp a `delta` row for `v`. Each PocketBase save inside a delta is its own transaction; there is no per-delta or per-upgrade transaction. A delta error → `fail` with the delta's name; a stamp error → `fail` with delta name `stamp`.

`schema.Upgrade` exposes the normal-mode run for tests; `BootstrapFrom(app, baseline.Apply)` builds a version-1 database and stamps `1`/`bootstrap`. `latestVersion` is a package variable initialised to `Version` so tests can stage an upgrade.

### 1.4 Deltas (`schema/deltas/`, blank-imported by `server`)

- `RegisterDelta(Delta{Version, Scope, Name, Up})` panics on `Version < 2`, a nil `Up`, or an empty `Name`. Helpers: `Modify(app, name, fn)` (load by name, mutate, save; does **not** resolve relation targets by name — the v3 delta looks the `fragment` collection id up itself), `AddCollection(def)` (= `ApplyTable`), `DropCollection(name)` (missing is not an error).
- Registered deltas and what they change:

| Version | Name | Change |
|---|---|---|
| 2 | `add_fragment_type_edit` | `fragment.type` select values become `email, note, chat, edit`; errors if `type` is not a select field |
| 3 | `add_chat_message_bookmark` | `chat_message` gains `bookmarked` (bool) and `fragment_id` (relation → `fragment`, max 1, no cascade) |
| 4 | `add_entity_deleted_at` | `projection` and `reflection` gain `deleted_at` (date) and index `idx_<name>_deleted_at (deleted_at)` |
| 5 | `add_snapshot_outputs_and_edits` | `projection_snapshot` and `reflection_snapshot` gain `output_raw` (text, max 100,000,000), `output_draft` (text, max 100,000,000) and `edits` (json); then a raw `UPDATE <table> SET output_draft = output WHERE status = 'pending_review' AND (output_draft IS NULL OR output_draft = '')` on each table (existing pending candidates get their output as the draft; approved, discarded and generating rows are left with an empty draft) |

- Invariants enforced by tests in the package: `parity_test.go` boots one database from `Canonical` and another from `baseline.V1` plus every delta and requires `Snapshot` (collections minus ids/timestamps, relation targets by name, indexes sorted, collections sorted by name) to be identical, and both to report `Version` with no failed marker; `delta_lint_test.go` fails any `.go` file under `deltas/` whose AST references the identifier `Canonical`, and any registered delta whose version is outside `(1, Version]`; `constants_test.go` requires the `Collection` constants and the base entries of `Canonical` to be the same set.
- `./kalaido.sh schema:freeze` copies `canonical.go` (from `const longTextMax` on) into `baseline/v1.go`; the script refuses unless `Version` is `1`.

### 1.5 Backup, restore, and the failed marker

- **Backup**: `VACUUM INTO '<pb_data>/backups/pre-migration-v<from>-<unix seconds>.db'` (an existing file of that name is removed first; the path is single-quote-escaped by hand). After each backup the directory is pruned to the newest 3 `pre-migration-v*.db` files by modification time; prune errors are ignored.
- **Failure** (`fail`): builds a `Failure{from, to, delta, error, backup, restored, at, binaryRev}`; calls `app.ResetBootstrapState()` (closes every connection), then `Options.BeforeRestore` if set, then `restoreBackup`: removes `data.db-wal` and `data.db-shm`, copies the backup to `data.db.restoring` (fsynced), renames it over `data.db`. `restored` is `true` only if that succeeded; errors from closing, restoring and marker-writing are appended to `error` (`; closing database: …`, `; restore: …`, `; writing marker: …`). The marker is written to `<pb_data>/schema-migration-failed.json` (indented JSON, mode `0644`), the failure is printed to stderr (`schema migration to v<to> failed in <delta>: <error>. Database restored to v<from> (backup: <path>). Update Kalaido to retry.` or `… Restore FAILED; the database may be inconsistent …`) and as `KALAIDO_MIGRATION_FAILED=<json>` on stdout, and the boot ends with `ErrMigrationFailed`.
- **Marker semantics** (§ 1.3 steps 1 and 5): the same build never retries; a different build clears the marker and retries; `schema retry` clears it unconditionally.

### 1.6 Commands and the status surface

- `schema bootstrap --dir D` (create or upgrade, print status, exit), `schema status --dir D` (inspect only), `schema retry --dir D` (clear marker, then upgrade). All three print `lastStatus` — the status the runner recorded at bootstrap — as indented JSON; `bootstrap` differs from a plain start only in exiting after printing.
- `Status` JSON: `{version, latest, failed, history: [{version, appliedAt, source, binaryRev}]}`; `failed` is the marker object or `null`; `version` is `0` and `history` is `null` for a database with no state table. `CurrentStatus` reads the marker file on every call.
- `GET /api/schema` returns `CurrentStatus` as `200` JSON (`500` "schema status" on a read error); every HTTP response carries `X-Kalaido-Schema-Version: <Version>` from a router-wide `BindFunc`. Neither registers auth middleware (`api.md` § 13). Nothing is enforced on requests.

Every base collection also has PocketBase's implicit `id`. `created`/`updated` are `AutodateField`s where listed (`created` on create; `updated` on create and update) and keep PocketBase's names; the definition's stated convention is that timestamps the application sets end in `_at`, relation fields end in `_id`. Date fields store PocketBase's `YYYY-MM-DD HH:MM:SS.sssZ` form; the empty string is the zero value every `= ''` filter below tests (`schema.NotDeleted()` is the literal `deleted_at = ''`, and `engine.LiveFilter` the same string). A single-value `select` is stored as plain text, which every status filter and partial index relies on. A `text` field is capped at 5000 characters by PocketBase unless `Max` is set; the document-carrying fields (`fragment.content`, `lens.prompt`, `*_snapshot.output`, `*_snapshot.output_raw`, `*_snapshot.output_draft`) set `longTextMax` = 100,000,000. "Client" below means the authenticated `users` record.

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
| `type` | select(1), required | `email`, `note`, `chat`, `edit`. Import parsers supply their own; the sync route defaults to `note`; `chat` is written by the bookmark save (`explore.SaveBookmarks`); `edit` (`prompts.EditFragmentKind`) by the candidate hand edit (`projections.ApplyEdit`), and only when the hand-edit fragment flag is on (see `content`) |
| `ingested_via` | select(1) | `import` (batch writer), `sync` (sync route default when `ingestedVia` is empty), `app` (bookmark save, hand edit, and the create-hook default when empty, § 4). The value is not validated against the list by any handler; PocketBase's select validation applies |
| `source` | text | free-text attribution (never parsed); the bookmark save writes `explore:<client conversation id>:<UIMessage id>`, the hand edit `edit to projection "<name>" (candidate <snapshot id>)` |
| `content` | text, required | max 100,000,000 chars; the batch writer and sync route trim and drop empty content, and with `skip_duplicates`/`skipDuplicates` drop content whose SHA-256 matches any existing fragment (soft-deleted included) or an earlier one in the same run. The hand edit writes `prompts.EditFragmentContent(oldText, newText)` — but only when `KALAIDO_HAND_EDIT_CREATE_FRAGMENT` (legacy alias `KALAIDO_CREATE_EDIT_FRAGMENTS`; default off) is set, which `server.NewWithSchemaWithOptions` records in `app.Store()` under `projections.StoreKeyHandEditCreateFragment`; with the flag off a hand edit writes no fragment at all |
| `occurred_at` | date | defaulted to now by the create hook when zero; the batch writer sets the parser's source time, the sync route an RFC3339 `occurredAt` (an unparseable value is silently left empty), the bookmark save the message row's `created`, the hand edit now |
| `deleted_at` | date | soft delete; set by the delete-request hook (§ 4). Readers that filter `deleted_at = ''`: `view_stream`, `sourcedata.FindLiveFragments`/`FragmentDates`/`PendingAnnotationFragments` (whole-scope resolution, annotation pending set, annotation-row dates), pinned-fragment resolution, the colour worker's watermark page and the colour status's unjudged count, the colour preview sample (newest 20), the aggregate status fragment count, and the bookmark re-save check. Readers that do not: the batch writer's dedupe preload (`FindAllRecords`), id-based loads (`FindFragmentsByIDs`, `FindRecordsByIds`), and `fragment_annotation` rows of a soft-deleted fragment (§ 2.19) |
| `created` | autodate | |

Indexes: `idx_fragment_occurred_at (occurred_at)`, `idx_fragment_deleted_at (deleted_at)`.

No code path hard-deletes a fragment (`Delete` is never called on one). The batch writer saves fragments in transactions of 100 (`importBatch`); the sync route, bookmark save and hand edit save one at a time (`ingestion.md` § 6, `explore.md` § 7, `lifecycle-projection.md` § 4.4).

### 2.2 `ingest` — async file-ingestion jobs

| Field | Type | Notes |
|---|---|---|
| `file` | file | up to 50 files, 200 MiB (`200 << 20` bytes) each |
| `format` | select(1) | `zip`, `mbox`, `docx`, `text`; empty = inferred per file from its name |
| `fragment_limit` | number | 0 = no limit |
| `extensions` | text | comma-separated zip member filter (each entry trimmed, lower-cased); empty = parser default (`.txt`, `.md`, `.docx`) |
| `skip_duplicates`, `organize_after` | bool | `organize_after` starts the post-import pipeline once the batch is done (`ingestion.md` § 8) |
| `status` | select(1) | `pending`, `done`, `error`; the create hook forces `pending` (§ 4); the batch goroutine sets `done`, or `error` on failure; the boot sweep sets `error` with `error = server restarted while processing` on every `pending` row |
| `ingested` | number | fragments written across all files, set when the batch ends |
| `error` | text | set with `error` |
| `created`, `updated` | autodate | |

No indexes. No pipeline state beyond `status` is stored on the row. The imports status axis reads `status = 'pending'` (count) and the newest `status = 'error'` row's `error` (`ingestion.md` § 9).

### 2.3 `colour` — tag definitions

| Field | Type | Notes |
|---|---|---|
| `name` | text, required | trimmed; the create route rejects `400` when empty; `PATCH` ignores an empty `name` |
| `swatch` | number | `CountRecords("colour") % 8` at creation by both writers (`colour.Create`, discover colours flow); never changed afterwards |
| `prompt` | text | trimmed on create and update; the worker only drains colours with `prompt != ''` |
| `thing_ids` | json | string array of canonical map thing ids; written by the discover colours flow only (resolved from the model's references); `colour.Create` never sets it |
| `prompt_match_completed_up_to_fragment_id` | relation(1) → `fragment` | prompt-matching watermark: the worker sets it to the id of the last fragment of each page (200) it judged; `Worker.Rematch` (prompt change, rematch route) clears it to `""` after deleting the colour's `prompt` rows; no cascade; a watermark whose fragment no longer exists makes the drain start over |
| `last_provider_error_kind` | text | the `ProviderError.Kind` (`auth` or `quota` only) of the worker's last durable failure; written only when it changes; cleared to `""` on the next successful judgement (`colours.md` § 4.2) |
| `created_by_discover_run_id` | relation(1) → `discover_run` | set by the discover colours flow; empty = human-created |
| `created`, `updated` | autodate | |

No indexes. `colour.Delete` hard-deletes the row (`tx.Delete`) in a transaction after scrubbing its id from every `current_context_spec` (§ 3).

### 2.4 `colour_fragment` — colour↔fragment links

| Field | Type | Notes |
|---|---|---|
| `colour_id` | relation(1) → `colour`, required, cascade | |
| `fragment_id` | relation(1) → `fragment`, required, cascade | |
| `match_type` | select(1), required | `manual_positive`, `manual_negative`, `thing`, `prompt` (`schema.Match*` constants); a `manual_negative` row is an exclusion that every membership reader skips (`match_type != 'manual_negative'`) (`colours.md` § 2) |
| `created` | autodate | |

Indexes: `idx_colour_fragment_colour (colour_id)`, `idx_colour_fragment_fragment (fragment_id)`, `idx_colour_fragment_pair (colour_id, fragment_id)` **unique** — one row per pair. Writers: `SetManual` inserts or rewrites the existing row's `match_type` in place (negatives are applied before positives, so a fragment named in both ends `manual_positive`); `SetPromptMatch` (create-time seeding from `fragmentIds`; a failed seed is logged and skipped) and the worker insert `prompt` rows only where no row exists; thing rematch inserts `thing` rows only where no row exists. Hard deletes: `Rematch` deletes the colour's `prompt` rows, thing rematch deletes `thing` rows no longer cited, `ClearManual` deletes a `manual_*` row (and leaves any other type alone) then re-derives a `thing` row via `MatchPair`.

### 2.5 `projection` / 2.6 `reflection` — synthesis entities

| Field | Type | Notes |
|---|---|---|
| `name` | text | set at create and by `PATCH`; the refinement apply leg (`MaterializeCandidateIfNew`, projections only) writes the turn's `suggest_name` argument when it creates a new candidate and the current name is empty or starts with `Untitled`; otherwise `suggest_name` lives on the transcript only |
| `status` | select(1), required | `proposed` (discover-created), `active` (handler-created; `CommitRefinement` sets `active` on every commit) |
| `current_context_spec` | json | § 3; written by discover (`insertProposed`), `CommitRefinement`, the hand edit (appends the new `edit` fragment id to `fragmentIds`, projections only, and only when the hand-edit fragment flag is on), the colour-delete scrub (`colourIds`) and the entity soft-delete scrub (`sourceProjectionIds` / `sourceReflectionIds`) |
| `window_spec_versions` | json | **reflection only**; § 3; `reflections.Create` writes version 1 (`effectiveFrom` = the spec's `startTime` when it parses as RFC3339 and is earlier than now, else now; an absent spec is stored as an empty `WindowSpec`); each `PATCH` with `windowSpec` appends the next version effective now, inheriting the governing version's `startTime` when the new spec has none (`Validate` rejects a bad spec with `400`); the discover reflections flow writes version 1 effective from the rhythm's onset (`windows.md` § 2) |
| `current_lens_id` | relation(1) → `lens` | no cascade; set only by `CommitRefinement` |
| `generate_with_model` | text | per-entity override; set by `PATCH` (trimmed; empty clears); read by snapshot generation, the wave's dedup guard, the projection commit and the refinement chat (`lifecycle-projection.md` § 5) |
| `pinned_by` | relation(≤999) → `users` | toggled by `PATCH … {pinned}` for the calling user; a `pinned` flag on a request without an authenticated user is silently ignored |
| `created_by_discover_run_id` | relation(1) → `discover_run` | set by discover; empty = human-created |
| `description` | text | set at create (trimmed, only when non-empty) and by discover (the proposal's `message`); no update path |
| `created`, `updated` | autodate | |
| `deleted_at` | date | soft delete (v4): `engine.SoftDelete` sets now, `engine.Restore` sets `""`; both no-ops when already in that state. The delete route answers `404` for a missing row, `204` without writing for an already-deleted row, `409` while a `generating` claim younger than `GenerationClaimTTL` exists for the entity (any window), and otherwise, in one transaction, removes the entity's id from `sourceProjectionIds` / `sourceReflectionIds` in every `projection` and `reflection` `current_context_spec` (soft-deleted rows included; restore does not re-add it) and stamps the row. Children are left in place. Readers of live entities use `engine.LiveFilter` (`deleted_at = ''`): `engine.FindLive` (every handler, refinement create and generation path), the reconcile evaluator (`status = 'active' && deleted_at = ''`), discover's `list_existing`, the discover proposal counts (`status = proposed, deleted_at = ''`), `refinement.Parent`; upstream-snapshot resolution filters `projection_id.deleted_at = ''` / `reflection_id.deleted_at = ''` and hydration drops a snapshot whose parent is deleted. The scrub, the restore route, `MaterializeCandidateIfNew`'s new-candidate branch and the backfill pass read the row without the filter |

Indexes: `idx_projection_status (status)`, `idx_projection_deleted_at (deleted_at)`; `idx_reflection_status (status)`, `idx_reflection_deleted_at (deleted_at)`. No code path hard-deletes either entity.

### 2.7 `lens` — generation prompts (lenses)

| Field | Type | Notes |
|---|---|---|
| `prompt` | text | max 100,000,000 chars; the compiled lens text (the `data-lens` part of the newest `update_lens` turn, or the legacy `tool-update_lens` `{lens}` input) |
| `created_from_projection_refinement_id` | relation(1) → `projection_refinement` | no cascade; set by every projection lens writer (`Strategy.RefinementForeignKeyCol`) |
| `created_from_reflection_refinement_id` | relation(1) → `reflection_refinement` | no cascade; set by a reflection commit |
| `parent_lens_id` | relation(1) → `lens` | the entity's previous `current_lens_id`, when it had one; set by `CommitRefinement` only; nothing reads back through the chain |
| `created` | autodate | |

Read **and** write disabled for clients. No indexes. Both strategies name the same collection (`LensCollectionName() == "lens"`). Rows are only ever created, never updated or deleted, by three writers: `CommitRefinement` (inside the commit transaction, with `parent_lens_id`), and the projection apply leg's `MaterializeCandidateIfNew` on each preview — on an existing `pending_review` candidate a lens row is saved outside any transaction and the candidate's `lens_id` re-pointed at it (a failed lens save is silently skipped and `lens_id` left as it was); for a fresh candidate the lens row is saved in the same transaction as the new snapshot. A preview lens is not the entity's `current_lens_id` until committed. A lens carries no context spec. Readers: `resolveActiveLens` (generation and the wave's currency check), `SeedLensTurn` (session seeding, both entity types), and the refinement chat's standing-lens fallback (`refinement.md` § 6).

### 2.8 `projection_snapshot` / 2.9 `reflection_snapshot` — generated outputs

| Field | Type | Notes |
|---|---|---|
| `projection_id` / `reflection_id` | relation(1), required, cascade | |
| `status` | select(1), required | `generating` (the claim row: FK, `status`, and for reflections `window_start`/`window_end`; nothing else), `pending_review`, `approved`, `discarded`. `ClaimGeneration` runs in one transaction: an existing `generating` row for the same target/window younger than `GenerationClaimTTL` (10 min) → `ErrGenerationInFlight`; older ones are deleted and a new claim inserted. A failed generation deletes its own claim while it still reads `generating` (`releaseClaim`). Filling a claim (`completeClaimedSnapshot`), settling an approved row in place, or approving one candidate sets every other `pending_review` row for the same target/window to `discarded`. `ApproveSnapshot` is a no-op when `approval_sequence_number > 0`; refuses (`ErrNotApprovable`, `422`) a `generating` or `discarded` row; when `output` is blank it refuses if `output_draft` contains an edit marker (`<<<edit:`) and otherwise copies the trimmed `output_draft` into `output`; a row still blank after that is refused. The boot sweep deletes every `generating` row (§ 4) |
| `context_spec` | json | § 3; the entity's `current_context_spec` at generation; the projection commit and the apply leg rewrite it on the candidate they promote/refresh; the hand edit appends the edit fragment id (flag on) |
| `resolved_context` | json | § 3; rewritten in place, with `context_spec`, `generated_by_model` and `generated_at`, when a regeneration reproduces the approved output (`settleApprovedInPlace`, only under a wave trigger or a fold-in `FoldIn: true` request, and only when the approved row's `lens_id` is the current lens); also rewritten by the commit, the apply leg and the hand edit (flag on: appends the fragment id to `fragmentIds` and `expandedIds`) |
| `window_start`, `window_end` | date | **reflection only**; `SetSnapshotWindow` from the `api.Window` bounds; both empty for an unscheduled reflection's rows. The reflection window filter for a nil window is `window_start = ''`; the series reader selects `window_start != '' && (status = 'approved' || status = 'generating')` |
| `lens_id` | relation(1) → `lens` | the entity's `current_lens_id` at generation; the commit re-points a promoted pending candidate at the new lens; the apply leg re-points an existing candidate at each preview's lens (§ 2.7) |
| `output` | text | max 100,000,000 chars; the published text: the trimmed model output (approved generations), the minimal-diff merge, or the draft promoted at approval. A `pending_review` row's `output` is `""` — the claim fill, the commit-appended row, the apply-leg candidate and the hand edit all write `""` — and `output_draft` is the text under review |
| `output_raw` | text | (v5) max 100,000,000 chars; the model's untouched output for the row: the first (pre-minimisation) generation, or the apply leg's preview text; copied unchanged by the hand edit; empty on rows written before v5 |
| `output_draft` | text | (v5) max 100,000,000 chars; the reviewable text. Generation writes the approved anchor with `<<<edit:<id>>>>` markers where blocks changed (`DiffAndMarkBlocks`), or the raw output when there is no same-lens approved anchor; an approved generation writes the final output. The hand edit, `ProposeRefineEdit`, `ReviseProposalEdit`, `UpdateSnapshotEditStatus` and the apply leg rewrite it in place; the v5 delta backfills it from `output` on `pending_review` rows |
| `edits` | json | (v5) § 3; the edit ledger of the draft; `applySnapshotSpec` writes `[]` when the spec carries none and the row has none. Read by `CandidateEngaged` (a `manual` or `refinement` edit engages the candidate), the approve gate (via markers in the draft), and the refinement transcript |
| `created_from_refinement_id` | relation(1) → the matching refinement collection | set by the commit-appended projection row and by the apply leg's new candidate; left empty by generation, by a commit that promotes an existing candidate, and by the hand edit |
| `generated_by_model` | text | the resolved snapshot-role model; the apply leg writes the apply model; the settle-in-place rewrites it |
| `generation_trigger` | select(1) | `generate_all` or empty; taken from the `SnapshotSpec` or else from the context (`llmcontext.GenerationTriggerFromContext`); a projection commit inherits it from a still-`pending_review` source candidate; a fold-in (`WithSettleUnchanged`) does not set it; left empty by the hand edit and the apply leg |
| `approval_sequence_number` | number | set on approval to the target/window's current maximum + 1 (1 when none) |
| `approved_at` | date | set on approval |
| `generated_at` | date | set whenever `applySnapshotSpec` runs (claim fill, `AppendSnapshot` for commits and apply-leg candidates) and by the settle-in-place; not set on the claim row, and not touched by the hand edit or by the apply leg's refresh of an existing candidate |
| `created`, `updated` | autodate | `created` is the claim's insertion time; the wave's dedup guard (`SnapshotIsCurrent`) reads the newest `pending_review`/`approved` row by `created DESC, approval_sequence_number DESC, rowid DESC` |

Indexes: `idx_projection_snapshot_projection (projection_id)`; `idx_projection_snapshot_approval_seq (projection_id, approval_sequence_number)` **unique where `status = 'approved'`**; `idx_reflection_snapshot_reflection (reflection_id)`; `idx_reflection_snapshot_approval_seq (reflection_id, window_start, window_end, approval_sequence_number)` **unique where `status = 'approved'`**.

The reflection commit writes no snapshot (`Strategy.CommitRefinementSnapshot` returns `""`). The projection commit, when the refinement's `projection_snapshot_id` names a `pending_review` row, promotes that row in place (`output` = its `output_draft`, else its `output`, else the transcript output; `lens_id`, `context_spec`, `resolved_context` rewritten; then `ApproveSnapshot`) and otherwise appends a `pending_review` row (`output` `""`, `output_draft` = `output_raw` = the transcript output) and approves it in the same transaction (`lifecycle-projection.md` § 3, `lifecycle-reflection.md` § 4). The schedule version that produced a reflection window is not recorded on the snapshot (`windows.md` § 4). Rows are never hard-deleted except claim rows (`releaseClaim`, `ClaimGeneration`'s TTL takeover, the boot sweep).

### 2.10 `projection_refinement` / 2.11 `reflection_refinement` — refinement sessions

| Field | Type | Notes |
|---|---|---|
| `projection_id` / `reflection_id` | relation(1), cascade | set by both create handlers after `FindLive` succeeds (a missing or soft-deleted parent fails the create with `500`); `refinement.parentID` falls back to the snapshot's parent for a row with an empty parent column |
| `projection_snapshot_id` / `reflection_snapshot_id` | relation(1), cascade | the projection create handler sets it from `snapshotId` when given (the snapshot must exist; `500` otherwise); the projection apply leg sets it to the candidate it creates when the session had none or its candidate is no longer `pending_review` (`MaterializeCandidateIfNew`); a fold-in generate (`FoldIn: true, Preview: true`) re-points the newest refinement of the previous approved snapshot at the new candidate when that refinement has drafted no lens (`CarryOpenRefinementToCandidate`); the reflection create handler never sets it |
| `external_conversation_id` | text | the request's `clientId` (`400` when empty) |
| `created` | autodate | |

Indexes: `idx_projection_refinement_external (external_conversation_id)` **unique**, `idx_projection_refinement_projection (projection_id)`, `idx_projection_refinement_snapshot (projection_snapshot_id)`; `idx_reflection_refinement_external (external_conversation_id)` **unique**, `idx_reflection_refinement_reflection (reflection_id)`, `idx_reflection_refinement_snapshot (reflection_snapshot_id)`. A second create with the same `clientId` fails the save on the unique index and is reported as `500` ("failed to create refinement"). The create transaction also seeds `chat_message` rows (§ 2.13) (`refinement.md` § 2). `CandidateEngaged` treats any `projection_refinement` row pointing at a candidate as engagement; the hand-edit and triage notices are persisted onto the newest refinement matching `projection_id = … && projection_snapshot_id = …` (none: silently nothing).

### 2.12 `chat_conversation` — explore sessions

`external_conversation_id` text (**unique** index `idx_chat_conversation_external`), `generate_with_model` text, `created`. Created by `explore.FindOrCreateConversation` on the first explore turn whose request `id` is non-empty (a save that fails, e.g. on the unique index, falls back to re-reading the existing row). `generate_with_model` is read on every explore turn, by the brief and by the token estimate, and has no writer in this binary (clients cannot write the collection) (`explore.md` § 2).

### 2.13 `chat_message` — messages for all three conversation kinds

| Field | Type | Notes |
|---|---|---|
| `chat_conversation_id` | relation(1) → `chat_conversation`, cascade | `chat.PersistMessage` sets exactly one of the three from the owning record's collection name |
| `projection_refinement_id` | relation(1) → `projection_refinement`, cascade | |
| `reflection_refinement_id` | relation(1) → `reflection_refinement`, cascade | |
| `content` | json | a full `UIMessage` (§ 3); the message's own `id` lives inside it, so lookups by message id (`explore.FindMessage`) scan the conversation's rows |
| `generated_by_model` | text | the model passed by the persister: the resolved assistant model for model-driven assistant rows; `""` for user and system rows, for the seeded assistant turn, and for the fabricated window-reapply and regenerate-confirm turns |
| `bookmarked` | bool | (v3) set by `PATCH /api/explore/conversations/{cid}/messages/{mid}/bookmark` (`{bookmarked}`), explore rows only; `404` for a message with no row yet, `422` for a `system` row |
| `fragment_id` | relation(1) → `fragment`, no cascade | (v3) stamped by the bookmark save with the fragment the row became; a stamped row whose fragment is missing or has `deleted_at` set is re-saved as a new fragment and re-stamped |
| `created`, `updated` | autodate | an assistant turn's row is created on its first write and rewritten in place as parts accrue (`chat.TurnWriter` → `RewriteMessage`); `LoadMessages` orders by `created` |

Indexes: `idx_chat_message_chat_conv (chat_conversation_id)`, `idx_chat_message_projection_refinement (projection_refinement_id)`, `idx_chat_message_reflection_refinement (reflection_refinement_id)`. The bookmark save selects `chat_conversation_id = {:cid} && bookmarked = true` and skips `system` rows and rows whose text is empty. Rows are never deleted or moved by code (a carried-over refinement keeps its messages; only the refinement row's snapshot pointer changes); a row whose `content` fails to decode is skipped by `LoadMessages`.

### 2.14 `usage` — per-period token accounting

`period` text required (**unique** `idx_usage_period`; `quota.PeriodKey(now)` = UTC `YYYY-MM`), `prompt_tokens`, `completion_tokens`, `total_tokens`, `cached_tokens` numbers, `created`, `updated`. `usage.Record` (skipped when the usage is nil or `TotalTokens == 0`) upserts the current period inside a transaction, adding each counter, and retries once; a persistent failure is logged, not returned (`llm-queue-quota.md` § 5).

### 2.15 `llm_queue_status` — live scheduler mirror (singleton)

`state` select(1) (`idle`, `active`), `running`, `waiting`, `held` json, `created`, `updated`. `writeQueueStatus` reuses the first row found and creates one if none exists. `state` is `active` when `running` or `waiting` is non-empty. Reset to an empty status at `OnServe`; later scheduler transitions are debounced 300 ms into one write, a snapshot with a `Version` not above the last accepted one is dropped, and `OnTerminate` stops the mirror (a flush that fires after stop writes nothing). Excluded from the SQL write echo log (§ 4) (`llm-queue-quota.md` § 2.6).

### 2.16 `kalaidoscope_config` — workspace config (singleton)

`model_set`, `provider`, `api_key`, `default_model` text; `role_models` json; `created`, `updated`. Create and delete disabled; update open to clients, with `model_set` superuser-only by hook (§ 4). `api_key` is stored in plain text; the enrich hook hides it from every response without superuser auth (`Record.Hide`), so a client can write it but never read it back. The `Hidden` field flag is not used. `config.Read` decodes `role_models` as `map[string]string`, skips a raw value of `""` or `"null"`, skips empty values, and logs and ignores an unparseable value; `provider` empty means "unconfigured" (`models.md` § 3).

### 2.17 `view_stream` — SQL view

Read-only. One row per fragment with `deleted_at = ''`: `id`, `type`, `content`, `occurred_at`, `created`, `title` (`fragment_annotation.title` via left join; null when unannotated), and `colour_ids` = `json_group_array` of the `colour_id`s of the fragment's `colour_fragment` rows with `match_type != 'manual_negative'`, `'[]'` when none.

### 2.18 `reflection_window` — explicitly backfilled windows

`reflection_id` relation(1) required cascade; `window_start`, `window_end` date required; `created`. Indexes: `idx_reflection_window_reflection (reflection_id)`, `idx_reflection_window_bounds (reflection_id, window_start, window_end)` **unique**. Written only by `reflections.MaterializeBackfill` (one row per grid window between `from` and the governing version's lower bound; `400` `ErrBackfillOutOfRange` when `from` is not before that bound); a save that fails is accepted when a row with the same bounds already exists, so re-running the same range is a no-op. Grid windows are never stored here; the series reader joins these rows to the grid by bounds and marks them `Backfilled` (`windows.md` § 6.1).

### 2.19 `fragment_annotation` — per-fragment map markup

| Field | Type | Notes |
|---|---|---|
| `fragment_id` | relation(1) → `fragment`, required, cascade | **unique** `idx_fragment_annotation_fragment`; a fragment is pending annotation while no row exists for it (the row's existence is the done-marker) |
| `title`, `summary` | text | |
| `things`, `decisions`, `questions`, `conclusions` | json | § 3; each written as raw JSON by the annotate worker exactly as parsed from the model |
| `consolidated_at` | date | set by the consolidate pass on every row it read (selected by `consolidated_at = ''`), to the same instant as `kalaidoscope_map.consolidated_at`, in the same transaction as the map save; indexed `idx_fragment_annotation_consolidated_at` |
| `generated_from_map_version` | number | the `kalaidoscope_map.version` the annotation was grounded on |
| `generated_by_model` | text | the resolved annotate-role model |
| `created` | autodate | |

Written once by an annotate worker and updated once by consolidate; there is no re-annotation. A soft-deleted fragment's row stays and is still read by `LoadAnnotationRows` (with an empty date, since dates come from live fragments only) and counted by the map status's `annotated`/`unconsolidated` (`map.md` § 2, § 3.3).

### 2.20 `kalaidoscope_map` — the things document (singleton)

`body` json (§ 3), `version` number, `consolidated_at` date, `created`, `updated`. `sourcedata.FindMapRecord` takes the first row (`1=1`, limit 1); `mapping.loadDocument` creates one with `version = 0` and an empty body when none exists (on first use, not at boot); consolidate saves the body and sets `version` to `version + 1` and `consolidated_at`, in one transaction with the annotation rows' `consolidated_at`.

### 2.21 `map_run` — one row per consolidation call

`status` select (`running`, `done`, `error`) required; `error`, `generated_by_model` text; `pending_in`, `merges`, `admits`, `version_before`, `version_after` numbers; `created`, `updated`. Created as `running` with `generated_by_model`, `pending_in` (rows with `consolidated_at = ''`) and `version_before` before the model call; a model, parse or save failure sets `error` + `error`; success sets `done`, `admits`, `merges`, `version_after` (a failed final save is logged). A process that dies mid-call leaves the row `running`, which the map status reports as `interrupted` when no consolidation is in flight. Never pruned (`map.md` § 3.3).

### 2.22 `discover_run` — one row per discover run

`kind` select (`projections`, `reflections`, `colours`) required; `status` select (`running`, `done`, `error`) required; `error`, `generated_by_model`, `summary` text; `map_version`, `rounds`, `fragment_reads` numbers; `outputs` json (§ 3); `created`, `updated`. `newRun` writes `kind`, `status = running`, `map_version`, `generated_by_model`, `rounds = 0`, `fragment_reads = 0`, `outputs = []`; `saveProgress` rewrites `rounds`, `fragment_reads`, `outputs` (a save failure is logged); `finishRun` sets `done`, or `error` + `error`, then saves progress; `summary` is set on the record by the `finish` tool (the model's last reply, else the tool's `summary` argument) and lands with that save. The discover status reads the newest run per kind (`interrupted` when `running` and not the worker's current kind) and the newest `done` run's `map_version` (`discover.md` § 8).

## 3. Stored JSON shapes

All JSON fields are written through `pbutil.JSONObject` (a marshal failure stores `{}` and logs) or `json.Marshal` directly.

| Where | Shape |
|---|---|
| `*.current_context_spec`, `*_snapshot.context_spec` | `api.ContextSpec`: `{wholeScope?, fragmentIds?, fragmentTypes?, colourIds?, sourceProjectionIds?, sourceReflectionIds?}`; `wholeScope` is `"full"` or `"summaries"`; every key `omitempty` (`context.md` § 1). `engine.ScrubContextSpecs` selects every `projection` and `reflection` row matching `current_context_spec ~ {:id}` (soft-deleted rows included), removes the id from `colourIds` (colour delete) or `sourceProjectionIds` / `sourceReflectionIds` (entity soft-delete), and saves only rows whose id count changed; a row whose spec fails to decode is skipped |
| `*_snapshot.resolved_context` | `llmcontext.PinnedIDs`: `{fragmentIds?, snapshotIds?, expandedIds?}` — `expandedIds` is a rendering hint that `IsEmpty`/`Diff`/`DiffPinnedIDs` ignore (`context.md` § 5) |
| `*_snapshot.edits` | `[api.SnapshotEdit{id, sequence, type, status, contentBefore, contentAfter, blockIndex, fragmentId?, inlinedText?, anchorPrev?, anchorNext?, supersededBy?, undoable?, undoReason?, createdAt, updatedAt?}]`. `type` is `regeneration` (machine diff against the approved anchor), `refinement` (a `refine_candidate` proposal) or `manual` (hand edit); `status` is `proposed`, `approved`, `rejected` or `superseded`. `id` is a 15-char random string that also appears in `output_draft` as the marker `<<<edit:<id>>>>` while the edit is `proposed`. A hand edit is written directly as `approved` with `fragmentId` (empty when the flag is off); triage (`PATCH …/edits/{eid}` with `status` `approved`/`rejected`) inlines `contentAfter`/`contentBefore` over the marker and records `inlinedText`, `anchorPrev`/`anchorNext` (block text, or the sentinels `^START^`/`^END^`), `blockIndex`, `undoable: true`; `status: proposed` undoes an undoable edit (marker restored, anchors cleared); `recomputeUndoable` sets `undoable: false` + `undoReason: "another edit was made on top"` on resolved edits whose inlined text or anchors no longer appear; a revised proposal marks the old one `superseded` with `supersededBy`; a regeneration through the apply leg marks every prior edit `superseded` (`undoReason: "regenerated"`) except an `approved` edit whose `inlinedText` the new draft still contains verbatim, which is kept and re-anchored by `blockIndex` |
| `reflection.window_spec_versions` | `[api.WindowSpecVersion{versionNumber, effectiveFrom, spec: api.WindowSpec{mode?, startTime, endTime?, period, duration}}]`; `effectiveFrom` is RFC3339 UTC; `startTime`, `period` and `duration` are always present (empty strings for an unscheduled reflection) (`windows.md` § 2) |
| `chat_message.content` | `api.UIMessage{id, role, parts: [{type, text?, data?}]}`. Client-sent parts are stored as received. **System rows**: `context_spec` (data = `ContextSpec`), `window` (data = `api.Window{id, start, end}`), `pinned_ids` (data = `PinnedIDs`, appended by `chat.ResolveContextSpecs` to every incoming system message carrying a `context_spec` or `window` part, and written by the refinement seeding); client-sent confirmations the backend recognises: `data-regenerate_confirm`, `data-regenerate_cancel`, `data-context_confirm`, `data-context_cancel`, `data-refine_target` (`{passage, editId?}`); server-written notices (each with `text` = the rendered notice and `data`): `data-hand_edit` (`{editId, sequence, before, after}`), `data-edit_triage` (`{editId, sequence, status}`), `data-refine_proposal_result` (`{ok, sequence?, error?}`), `data-regenerate_superseded` (`{sequences, kept?}`). **Assistant rows**: `text`; `tool-<name>` with data `{toolCallId, toolName, input}` for the model's `update_lens` (`{directive}`), `regenerate_from_lens`, `suggest_name` (`{name}`), `refine_candidate` (`{target, replacement}`), `update_context` (`{whole_scope?, pin_fragment_ids?, unpin_fragment_ids?, pin_fragment_types?, unpin_fragment_types?, reason}`) calls; fabricated `tool-apply_result` (`{output}`) from every apply leg; the seeded first turn of a session (both entity types) carries `data-lens_seed` (`{}`), `tool-update_lens` with legacy input `{lens}` and — reflections with a window that has approved output — `tool-apply_result`; the window re-apply replays the newest lens part (`data-lens` or `tool-update_lens`) under `data-window_reapply` (`{start, end}`); the regenerate-confirm turn carries an empty `data-regenerate_confirm` part; `data-lens` (`{lens}`, the compiled lens), `data-refine_lint` (`{match}`), `data-refine_result` (`{ok, editId, sequence}` or `{ok: false, error}`), `data-context_confirmation` (`{spec, reason?}`), `data-regenerate_confirmation` (`{affectedEdits: [SnapshotEdit]}`), `data-refine_error` (`{kind, message}`); explore summaries mode: `tool-read_fragment` / `tool-read_thing` as `{toolCallId, toolName, input, output, state: "output-available"}`. The `bookmarked`/`fragment_id` state is on the row, not in `content` |
| `colour.thing_ids` | `["<thing id>", …]` |
| `kalaidoscope_map.body` | `mapdoc.Document`: `{things: [{id, name, aliases[], kind, blurb, fragments, first_seen?, last_seen?, exemplar_ids[]}], relationships: [{from, to, kind}], narrative}`; `kind` is normalised to one of `person`, `organisation`, `place`, `project`, `topic`, `other`; server-minted ids are `t_` + 8 lower-case unpadded base32 chars |
| `fragment_annotation.things` | `[prompts.ThingCitation{ref?, name?, kind?, note?}]`; `decisions`/`questions`/`conclusions`: `[prompts.Assertion{text, refs[]}]` |
| `discover_run.outputs` | `[discover.Output{kind, id, name, status?}]`; `kind` is `colour`, `projection` or `reflection`; `status` is `proposed` for the latter two and absent for colours |
| `kalaidoscope_config.role_models` | `{"<role>": "<model>"}` |
| `llm_queue_status.running` / `waiting` / `held` | `[queue.TaskInfo{role, priority, model, started, tokens?, tokens_per_second?}]` (`[]` when none) / `{"<priority>": count}` with keys `interactive`, `background`, `idle` (`{}` when none) / `queue.Held{reason, until?}` with `reason` one of `backoff`, `idle_blocked`, `idle_quiet`, `capacity`, `rate_spacing`, or `null` (`llm-queue-quota.md` § 2.6) |

## 4. Boot-time schema interactions

Boot order and the workers themselves are `boot-and-workers.md` § 1; listed here is only what touches schema values.

- `schema.Install` (on bootstrap, after PocketBase's own) runs the lifecycle in § 1.3 before any command or serve hook; `schema.RegisterCommand` adds the `schema` console command. `registerWriteEcho` (on bootstrap, after `Next`; skipped when `app.IsDev()`) installs an `ExecLogFunc` on both DB builders that logs every `INSERT INTO`/`UPDATE`/`DELETE FROM` statement (truncated to 500 runes) at debug level, or at error level with the error, skipping `llm_queue_status` and every `_`-prefixed table; DDL and reads are not logged.
- The first `OnServe` handler in `server.NewWithSchemaWithOptions` sets `se.InstallerFunc = nil` (no browser-opened superuser installer; no `_superusers` record is ever created by the binary), then `engine.SweepGenerationClaims` deletes every `projection_snapshot`/`reflection_snapshot` row with `status = 'generating'` (a lookup error skips that collection; a delete error is logged), and `ingest.SweepPending` sets every `ingest` row with `status = 'pending'` to `error` / `server restarted while processing`.
- `usage.Setup` (on serve) fails boot unless `usage` has a single-column unique index on `period`.
- `registerQueueStatus` (on serve) writes an empty status to the `llm_queue_status` singleton (creating it if absent) and subscribes to scheduler changes; on terminate it unsubscribes and stops.
- `resolveScopeModelSet` (on serve, from `cmd/sidecar`) reads the first `kalaidoscope_config` row or builds a new record; when `model_set` is empty it seeds it from `KALAIDO_MODEL_SET` (default `local`) and saves (a failed save is logged and the set is used for this run only); otherwise the stored value wins, an unparseable stored value calls `os.Exit(1)`, and a differing environment value is logged and ignored. A missing config collection is logged and the default set used. `config.LoadAtBoot` (on serve) publishes the stored provider config when `provider` is non-empty.
- `createLocalAppUser` (on serve, from `cmd/sidecar`) upserts the `users` record `user@kalaido.local`, sets its password from `KALAIDO_USER_PASSWORD` or a random one on every start, and prints `KALAIDO_USER_TOKEN=<jwt>` to stdout; a missing `users` collection or a failed save/token is logged and boot continues.
- `mapping.loadDocument` creates the `kalaidoscope_map` singleton (`version 0`) on first use, not at boot. The boot kicks (`workers.Manager.BootKicks`: colour signal, map kick if pending, reconcile wave request) read rows but write none directly.
- Record hooks that touch schema values: `fragment` `OnRecordCreate` defaults `occurred_at` to now and `ingested_via` to `app` (model-level, so programmatic saves too); `fragment` `OnRecordAfterCreateSuccess` only signals workers (`ingestion.md` § 7); `fragment` `OnRecordDeleteRequest` sets `deleted_at` (if unset) and saves instead of deleting, answering `204` — reachable only with superuser auth, since the client delete rule is `nil`; `ingest` `OnRecordCreate` reads the uploads and config, forces `status = pending`, and starts the batch goroutine after the save (`api.md` § 12); `kalaidoscope_config` `OnRecordUpdateRequest` rejects `403` when a non-superuser body contains `model_set`, `OnRecordUpdate` (model-level) rejects `400` (`model_required` on `default_model`) when `provider` is set and no model is named, live-validates the changed models of a credentialed provider when `api_key` is non-empty (`400` keyed on `api_key`, code `provider_<kind>` or `provider_validation_failed`) before the row is written, and after the write publishes the config and reconfigures the scheduler; `OnRecordEnrich` hides `api_key` from non-superusers (`models.md` § 3).

## 5. Cascade graph

Deleting → also deletes (PocketBase `CascadeDelete` on the relation):

- `fragment` (hard delete only; no code path performs one) → `colour_fragment`, `fragment_annotation`; `colour.prompt_match_completed_up_to_fragment_id` and `chat_message.fragment_id` pointing at it are cleared, not cascaded. A fragment id recorded inside `*_snapshot.edits[].fragmentId` or any context spec is plain JSON and is never touched.
- `colour` (hard-deleted by `colour.Delete`) → `colour_fragment`.
- `projection` (hard delete only; the API soft-deletes) → `projection_snapshot` → `projection_refinement` (via `projection_snapshot_id`) → `chat_message`; also `projection_refinement` directly (via `projection_id`).
- `reflection` (hard delete only; the API soft-deletes) → `reflection_snapshot` → `reflection_refinement` (via `reflection_snapshot_id`) → `chat_message`; also `reflection_window` and `reflection_refinement` directly (via `reflection_id`).
- `chat_conversation` → `chat_message`.
- Nothing cascades to or from `lens`, `discover_run`, `map_run`, `usage`, `ingest`, `kalaidoscope_map`, `llm_queue_status`, `kalaidoscope_config`, `users`; deleting a `discover_run` leaves `created_by_discover_run_id` empty on its colours and entities, deleting a `lens` clears `current_lens_id`, `lens_id` and `parent_lens_id` references, and deleting a `users` record clears it from `pinned_by` (PocketBase clears the relation value). Deleting a `projection_refinement`/`reflection_refinement` cascades to its `chat_message` rows and clears `lens.created_from_*_refinement_id` and `*_snapshot.created_from_refinement_id`. Deleting a `projection_snapshot` (a claim release or the boot sweep) cascades to any `projection_refinement` bound to it and on to that refinement's `chat_message` rows.
