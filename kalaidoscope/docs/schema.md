> **STALE** — code has changed since this document was generated.

# Kalaidoscope Database Schema — Generated Audit Snapshot

> **Generated:** 2026-09-10, from source at commit `6acd107`.
> This file is a generated audit snapshot — do not edit it. See `AGENTS.md` § "Generated audit docs". When code described here changes, a stale marker line is prepended above this block; nothing else in the file is ever modified by hand.

**Scope.** Every collection, field, index, access rule, and stored-JSON shape of the kalaidoscope PocketBase database, plus the migration mechanics and boot-time schema interactions. PocketBase's own system collections (`users`, `_superusers`, …) are covered only where the code touches them.

**Completeness anchor.** One migration file: `migrations/1748000000_init_schema.go`, defining 21 base collections and 1 SQL view (22 `tableDef` entries). No other migration exists.

---

## 1. Migration mechanics

- The single migration is **ensure-style and idempotent**: pass one creates any missing base collections empty (so relation fields can resolve targets), pass two sets fields, indexes, and rules on every collection.
- `ensureField` only **adds** fields that are missing by name — it never alters an existing field's definition and never removes fields. A field rename, type change, changed select values, or a field dropped from the definition does not propagate by re-running the migration.
- Indexes are (re-)added by name on every run. Rules are reassigned on every run. A view's query is reassigned on every run.
- The down migration deletes all collections in reverse definition order.
- **Access rules** are generated: every enabled operation gets `@request.auth.id != ''`; a disabled operation gets a `nil` rule (superuser/server-only). Flags per collection: `DisableWriteOperations` (create+update+delete), `DisableReadOperations` (list+view), and per-op `DisableCreate`/`DisableUpdate`/`DisableDelete`.
- Migrations run only via the `migrate` subcommand (`migratecmd` registered with `Automigrate: false`); a start with an out-of-date schema is not detected.

Every base collection also has PocketBase's implicit `id`. `created`/`updated` are `AutodateField`s where listed and keep PocketBase's own names; the migration's stated convention is that timestamps the application sets end in `_at`, relation fields end in `_id`. Date fields (`date`) store PocketBase's own `YYYY-MM-DD HH:MM:SS.sssZ` form. A single-value `select` is stored as plain text, which every status filter and partial index below relies on. A `text` field is capped at 5000 characters by PocketBase unless the definition sets a maximum; the three document-carrying fields (`fragment.content`, `lens.prompt`, `*_snapshot.output`) set 100,000,000. "Client" below means the authenticated `users` record.

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
| `type` | select(1), required | `email`, `note`, `chat` |
| `ingested_via` | select(1) | how the fragment entered: `import` (file batch), `app` (the add-fragment flow), `sync` (an external client on `POST /api/ingest`, the default when the body names nothing); defaulted to `app` by hook |
| `source` | text | human-readable attribution of the content (an email's sender and subject, a file's name, a chat's id); rendered into prompts, never parsed |
| `content` | text, required | max 100,000,000 chars |
| `occurred_at` | date | when the underlying event happened (an email's `Date` header); defaulted to now by hook when zero |
| `deleted_at` | date | soft delete; set by the delete-request hook (`ingestion.md`) |
| `created` | autodate | |

Indexes: `idx_fragment_occurred_at (occurred_at)`, `idx_fragment_deleted_at (deleted_at)`.

### 2.2 `ingest` — async file-ingestion jobs

| Field | Type | Notes |
|---|---|---|
| `file` | file | up to 50 files, 200 MiB each |
| `format` | select(1) | `zip`, `mbox`, `docx`, `text`; empty = inferred per file from its name |
| `fragment_limit` | number | stop after this many fragments; 0 = no limit |
| `extensions` | text | comma-separated zip member filter; empty = parser default |
| `skip_duplicates`, `organize_after` | bool | |
| `status` | select(1) | `pending`, `done`, `error`; the create hook forces `pending` |
| `ingested` | number | |
| `error` | text | |
| `created`, `updated` | autodate | |

No indexes. No pipeline state is stored on the row; the post-import chain is in-memory only (`organize.md`).

### 2.3 `colour` — tag definitions

| Field | Type | Notes |
|---|---|---|
| `name` | text, required | |
| `swatch` | number | palette slot `0..7`; assigned `count(colour) % 8` at creation by both writers (create handler, discover colours flow); never changed afterwards |
| `prompt` | text | |
| `thing_ids` | json | string array of map thing ids; written by discover only |
| `prompt_match_completed_up_to_fragment_id` | relation(1) → `fragment` | prompt-matching watermark: the newest fragment (in `created, id` order) judged against the current prompt; empty = nothing judged yet; reset by a prompt edit; no cascade, so a hard-deleted fragment clears it and the scan starts over |
| `last_provider_error_kind` | text | `auth` / `quota` / empty |
| `created_by_discover_run_id` | relation(1) → `discover_run` | empty = human-created |
| `created`, `updated` | autodate | |

No indexes.

### 2.4 `colour_fragment` — colour↔fragment links

| Field | Type | Notes |
|---|---|---|
| `colour_id` | relation(1) → `colour`, required, cascade | |
| `fragment_id` | relation(1) → `fragment`, required, cascade | |
| `match_type` | select(1), required | `manual_positive`, `manual_negative`, `thing`, `prompt`; a `manual_negative` row is an exclusion, not a membership |
| `created` | autodate | |

Indexes: `idx_colour_fragment_colour (colour_id)`, `idx_colour_fragment_fragment (fragment_id)`, `idx_colour_fragment_pair (colour_id, fragment_id)` **unique**.

### 2.5 `projection` / 2.6 `reflection` — synthesis entities

| Field | Type | Notes |
|---|---|---|
| `name` | text | |
| `status` | select(1), required | `proposed`, `active` |
| `current_context_spec` | json | the scope every generation resolves (§ 3); owned by the entity, not the lens; written by discover, refinement commits, and the colour-delete scrub |
| `window_spec_versions` | json | **reflection only**; append-only schedule history (§ 3): creation writes version 1, every schedule edit appends the next, only the version governing now is read |
| `current_lens_id` | relation(1) → `lens` | no cascade |
| `generate_with_model` | text | per-entity model override for future generations; empty = workspace role default |
| `pinned_by` | relation(≤999) → `users` | |
| `created_by_discover_run_id` | relation(1) → `discover_run` | empty = human-created |
| `description` | text | seeded by discover from its proposal's opening message; empty for human-created entities |
| `created`, `updated` | autodate | |

Indexes: `idx_projection_status (status)`; `idx_reflection_status (status)`.

### 2.7 `lens` — generation prompts (lenses)

| Field | Type | Notes |
|---|---|---|
| `prompt` | text | the standing instruction a refinement drafted; max 100,000,000 chars |
| `created_from_projection_refinement_id` | relation(1) → `projection_refinement` | no cascade |
| `created_from_reflection_refinement_id` | relation(1) → `reflection_refinement` | no cascade |
| `parent_lens_id` | relation(1) → `lens` | |
| `created` | autodate | |

Read **and** write disabled for clients. No indexes. A lens carries no context spec: the scope it is applied to is the owning entity's `current_context_spec`, and each snapshot records the spec it was generated with.

### 2.8 `projection_snapshot` / 2.9 `reflection_snapshot` — generated outputs

| Field | Type | Notes |
|---|---|---|
| `projection_id` / `reflection_id` | relation(1), required, cascade | |
| `status` | select(1), required | the row's lifecycle: `generating` (the claim row) → `pending_review` (a finished candidate awaiting the user) → `approved` \| `discarded`; server-side publication goes straight to `approved`; `approved` means promoted at some point, the current output being the highest `approval_sequence_number` per target (and window), and a superseded approval keeps its status while a superseded candidate becomes `discarded` |
| `context_spec` | json | the entity's `current_context_spec` at generation (§ 3) |
| `resolved_context` | json | `{fragmentIds, snapshotIds, expandedIds}` receipt (§ 3) |
| `window_start`, `window_end` | date | **reflection only**; the half-open window the snapshot covers; both empty for an unscheduled reflection |
| `lens_id` | relation(1) → `lens` | |
| `output` | text | the generated markdown as returned by the model; max 100,000,000 chars |
| `created_from_refinement_id` | relation(1) → the matching refinement collection | set on refinement commits |
| `generated_by_model` | text | |
| `generation_trigger` | select(1) | `generate_all` when generated as part of a "generate all" wave, else empty; propagates through refinement commits |
| `approval_sequence_number` | number | |
| `approved_at` | date | set on approval |
| `generated_at` | date | set when a generation completes; not set on the claim row |
| `created`, `updated` | autodate | a row is created as a `generating` claim and filled in place on completion, then approved or discarded later |

Indexes: `idx_projection_snapshot_projection (projection_id)`; `idx_projection_snapshot_approval_seq (projection_id, approval_sequence_number)` **unique where `status = 'approved'`**; `idx_reflection_snapshot_reflection (reflection_id)`; `idx_reflection_snapshot_approval_seq (reflection_id, window_start, window_end, approval_sequence_number)` **unique where `status = 'approved'`**.

The schedule version that produced a reflection window is not recorded on the snapshot; the bounds are the window's identity (`windows.md`).

### 2.10 `projection_refinement` / 2.11 `reflection_refinement` — refinement sessions

| Field | Type | Notes |
|---|---|---|
| `projection_id` / `reflection_id` | relation(1), cascade | |
| `projection_snapshot_id` / `reflection_snapshot_id` | relation(1), cascade | |
| `external_conversation_id` | text | client id |
| `created` | autodate | |

Indexes: `idx_projection_refinement_external (external_conversation_id)` **unique**, `idx_projection_refinement_projection (projection_id)`, `idx_projection_refinement_snapshot (projection_snapshot_id)`; `idx_reflection_refinement_external (external_conversation_id)` **unique**, `idx_reflection_refinement_reflection (reflection_id)`, `idx_reflection_refinement_snapshot (reflection_snapshot_id)`.

### 2.12 `chat_conversation` — free-chat sessions

`external_conversation_id` text (**unique** index `idx_chat_conversation_external`), `generate_with_model` text (per-conversation override), `created`. Server-written.

### 2.13 `chat_message` — messages for all three conversation kinds

| Field | Type | Notes |
|---|---|---|
| `chat_conversation_id` | relation(1) → `chat_conversation`, cascade | exactly one of the three is set |
| `projection_refinement_id` | relation(1) → `projection_refinement`, cascade | |
| `reflection_refinement_id` | relation(1) → `reflection_refinement`, cascade | |
| `content` | json | a full `UIMessage` (§ 3) |
| `generated_by_model` | text | assistant rows only |
| `created`, `updated` | autodate | a refinement's streaming assistant row is rewritten in place as parts accrue |

Indexes: `idx_chat_message_chat_conv (chat_conversation_id)`, `idx_chat_message_projection_refinement (projection_refinement_id)`, `idx_chat_message_reflection_refinement (reflection_refinement_id)`. Server-written.

### 2.14 `usage` — per-period token accounting

`period` text required (**unique** `idx_usage_period`; `YYYY-MM` UTC), `prompt_tokens`, `completion_tokens`, `total_tokens`, `cached_tokens` numbers, `created`, `updated`. Server-written.

### 2.15 `llm_queue_status` — live scheduler mirror (singleton)

`state` select(1) (`idle` / `active`), `running` json, `waiting` json, `held` json, `created`, `updated`. Server-written; reset at boot; excluded from the SQL echo log.

### 2.16 `kalaidoscope_config` — workspace config (singleton)

`model_set`, `provider`, `api_key`, `default_model` text; `role_models` json (role → model); `created`, `updated`. Create and delete disabled; update open to clients, with `model_set` superuser-only by hook (`models.md`). `api_key` is stored in plain text; an enrich hook removes it from every response that is not superuser-authenticated, so a client can write it but never read it back. The `Hidden` field flag is not used because it would also strip the field from a client's update request.

### 2.17 `view_stream` — SQL view

Read-only. One row per fragment with `deleted_at = ''`: `id`, `type`, `content`, `occurred_at`, `created`, `title` (the fragment's `fragment_annotation.title` via left join; null when unannotated), and `colour_ids` = JSON array of the ids of every colour the fragment is a member of (`colour_fragment` rows with `match_type != 'manual_negative'`); `'[]'` when none.

### 2.18 `reflection_window` — explicitly backfilled windows

`reflection_id` relation(1) required cascade; `window_start`, `window_end` date required; `created`. Indexes: `idx_reflection_window_reflection (reflection_id)`, `idx_reflection_window_bounds (reflection_id, window_start, window_end)` **unique**. Grid windows are never stored here.

### 2.19 `fragment_annotation` — per-fragment map markup

| Field | Type | Notes |
|---|---|---|
| `fragment_id` | relation(1) → `fragment`, required, cascade | **unique** `idx_fragment_annotation_fragment` |
| `title`, `summary` | text | |
| `things`, `decisions`, `questions`, `conclusions` | json | § 3 |
| `consolidated_at` | date | set by the consolidate pass that folded the row into the map, to the same instant as `kalaidoscope_map.consolidated_at` for that pass; empty until then; indexed `idx_fragment_annotation_consolidated_at` |
| `generated_from_map_version` | number | the `kalaidoscope_map.version` the annotation was grounded on (whose thing ids `things[].ref` cites); provenance only, not part of the key |
| `generated_by_model` | text | |
| `created` | autodate | |

Written once by an annotate worker and updated once by consolidate; there is no re-annotation.

### 2.20 `kalaidoscope_map` — the things document (singleton)

`body` json (§ 3), `version` number (bumped per consolidate call), `consolidated_at` date, `created`, `updated`. Server-written.

### 2.21 `map_run` — one row per consolidation call

`status` select (`running`, `done`, `error`) required; `error`, `generated_by_model` text; `pending_in`, `merges`, `admits`, `version_before`, `version_after` numbers; `created`, `updated`. Created as `running` before the model call; a process that dies mid-call leaves the row `running`. Never pruned.

### 2.22 `discover_run` — one row per discover run

`kind` select (`projections`, `reflections`, `colours`) required; `status` select (`running`, `done`, `error`) required; `error`, `generated_by_model`, `summary` text; `map_version`, `rounds`, `fragment_reads` numbers; `outputs` json (§ 3); `created`, `updated`.

## 3. Stored JSON shapes

| Where | Shape |
|---|---|
| `*.current_context_spec`, `*_snapshot.context_spec` | `{wholeScope?, fragmentIds?, fragmentTypes?, colourIds?, sourceProjectionIds?, sourceReflectionIds?}`; `wholeScope` is `"full"` or `"summaries"` (`context.md` § 1) |
| `*_snapshot.resolved_context` | `{fragmentIds?, snapshotIds?, expandedIds?}` — `expandedIds` is a rendering hint the snapshot path never reads (`context.md`) |
| `reflection.window_spec_versions` | `[{versionNumber, effectiveFrom, spec: {mode?, startTime, endTime?, period, duration}}]` |
| `chat_message.content` | `{id, role, parts: [{type, text?, data?}]}`; part types the backend writes or recognises: `text`, `context_spec`, `window`, `pinned_ids`, `tool-<tool name>` (`update_lens`, `suggest_name`, `apply_result` in refinement; `read_fragment`, `read_thing` in chat summaries mode), `data-refine_lint`, `data-refine_error`, `data-window_reapply`, `data-lens_seed` |
| `colour.thing_ids` | `["<thing id>", …]` |
| `kalaidoscope_map.body` | `{things: [{id, name, aliases[], kind, blurb, fragments, first_seen?, last_seen?, exemplar_ids[]}], relationships: [{from, to, kind}], narrative}` |
| `fragment_annotation.things` | `[{ref?, name?, kind?, note?}]` — a `ref` cites an existing thing, a `name`/`kind`/`note` proposes a new one; `decisions`/`questions`/`conclusions`: `[{text, refs[]}]` |
| `discover_run.outputs` | `[{kind, id, name, status?}]` |
| `kalaidoscope_config.role_models` | `{"<role>": "<model>"}` |
| `llm_queue_status.running` / `waiting` / `held` | `[{role, priority, model, started, tokens?, tokens_per_second?}]` / `{"<priority>": count}` / `{reason, until?}` or `null` (`llm-queue-quota.md`) |

## 4. Boot-time schema interactions

- `engine.SweepGenerationClaims` (on serve) deletes every `*_snapshot` row with `status = 'generating'`.
- `usage.Setup` (on serve) fails boot unless `usage` has a unique single-column index on `period`.
- `registerQueueStatus` (on serve) finds or creates the `llm_queue_status` singleton and writes an empty status; later scheduler changes are written to the same row, debounced by 300 ms.
- `resolveModelSet` (on serve, registered by the binary's main) finds or creates the `kalaidoscope_config` singleton; when `model_set` is empty it seeds it from `KALAIDO_MODEL_SET` (default `local`), otherwise the stored value wins and a differing environment value is logged and ignored.
- `seedSidecarUser` (on serve) upserts the `users` record `user@kalaido.local`, sets its password from `KALAIDO_USER_PASSWORD` or a random one, and prints an auth token to stdout. No `_superusers` record is ever created by the binary.
- `mapping.loadDocument` creates the `kalaidoscope_map` singleton (`version 0`) on first use, not at boot.
- Record hooks that touch schema values: `fragment` create defaults `occurred_at` to now and `ingested_via` to `app` (model-level, so programmatic saves too); `fragment` delete request sets `deleted_at` instead of deleting and answers `204` (reachable only by a superuser, since the client delete rule is disabled); `ingest` create forces `status = pending` and starts the batch; `kalaidoscope_config` update request rejects `403` when a non-superuser touches `model_set`, the model-level update validates provider/model/credential before the row is written, and the enrich hook hides `api_key` from non-superusers.

## 5. Cascade graph

Deleting → also deletes:

- `fragment` (hard delete only; the API soft-deletes) → `colour_fragment`, `fragment_annotation`; a `colour.prompt_match_completed_up_to_fragment_id` pointing at it is cleared, not cascaded.
- `colour` → `colour_fragment`.
- `projection` → `projection_snapshot` → `projection_refinement` (via `projection_snapshot_id`) → `chat_message`; also `projection_refinement` directly (via `projection_id`).
- `reflection` → `reflection_snapshot` → `reflection_refinement` (via `reflection_snapshot_id`) → `chat_message`; also `reflection_window` and `reflection_refinement` directly (via `reflection_id`).
- `chat_conversation` → `chat_message`.
- Nothing cascades to or from `lens`, `discover_run`, `map_run`; deleting a `discover_run` leaves `created_by_discover_run_id` empty on its entities (PocketBase clears the relation value).
