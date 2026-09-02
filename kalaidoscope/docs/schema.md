# Kalaidoscope Database Schema — Generated Audit Snapshot

> **Generated:** 2026-09-02, from source at commit `3998ebd`.
> This file is a generated audit snapshot — do not edit it. See `AGENTS.md` § "Generated audit docs". When code described here changes, a stale marker line is prepended above this block; nothing else in the file is ever modified by hand.

**Scope.** Every collection, field, index, access rule, and stored-JSON shape of the kalaidoscope PocketBase database, plus the migration mechanics and boot-time schema interactions. PocketBase's own system collections (`users`, `_superusers`, …) are covered only where the code touches them.

**Completeness anchor.** One migration file: `migrations/1748000000_init_schema.go`, defining 21 base collections and 1 SQL view (22 `tableDef` entries). No other migration exists.

---

## 1. Migration mechanics

- The single migration is **ensure-style and idempotent**: pass one creates any missing base collections empty (so relation fields can resolve targets), pass two sets fields, indexes, and rules on every collection.
- `ensureField` only **adds** fields that are missing by name — it never alters an existing field's definition and never removes fields. A field rename, type change, or changed select values does not propagate by re-running the migration.
- Indexes are (re-)added by name on every run. Rules are reassigned on every run.
- The down migration deletes all collections in reverse definition order.
- **Access rules** are generated: every enabled operation gets `@request.auth.id != ''`; a disabled operation gets a `nil` rule (superuser/server-only). Flags per collection: `DisableWriteOperations` (create+update+delete), `DisableReadOperations` (list+view), and per-op `DisableCreate`/`DisableUpdate`/`DisableDelete`.
- Migrations run only via the `migrate` subcommand (`Automigrate: false`); a start with an out-of-date schema is not detected.

Every base collection also has PocketBase's implicit `id`. `created`/`updated` are `AutodateField`s where listed. "Client" below means the authenticated `users` record.

## 2. Collections

Rule summary (client access):

| Collection | List/View | Create | Update | Delete |
|---|---|---|---|---|
| `fragment`, `ingest`, `chat_conversation`, `chat_message` | ✓ | ✓ | ✓ | ✓ |
| `kalaidoscope_config` | ✓ | — | ✓ (hook-guarded) | — |
| `lens` | — | — | — | — |
| all others | ✓ | — | — | — |

### 2.1 `fragment` — ingested content units

| Field | Type | Notes |
|---|---|---|
| `type` | select(1), required | `email`, `note`, `whatsapp`, `sms`, `chat` |
| `origin` | select(1) | `import`, `app`, `sync`; defaulted to `app` by hook |
| `source` | text | |
| `content` | text, required | max 100,000,000 chars |
| `source_time` | date | defaulted to now by hook when zero |
| `deleted_at` | date | soft delete; set by the delete-request hook (`ingestion.md` § 7) |
| `created` | autodate | |

Indexes: `idx_fragment_source_time (source_time)`, `idx_fragment_deleted_at (deleted_at)`.

### 2.2 `ingest` — async file-ingestion jobs

| Field | Type | Notes |
|---|---|---|
| `file` | file | up to 50 files, 200 MiB each |
| `format`, `extensions` | text | |
| `limit` | number | |
| `skip_duplicates`, `organize_after` | bool | |
| `status` | text | `pending`, `done`, `error` (server-written) |
| `ingested` | number | |
| `error`, `pipeline`, `pipeline_error` | text | `pipeline`: `mapping`, `organizing`, `done`, `error` |
| `created`, `updated` | autodate | |

### 2.3 `colour` — tag definitions

| Field | Type | Notes |
|---|---|---|
| `name` | text, required | |
| `colour_value` | text | never read by the server |
| `prompt` | text | |
| `thing_ids` | json | string array; written by discover only |
| `prompt_matched_through` | text | fragment id watermark |
| `last_provider_error_kind` | text | `auth` / `quota` / empty |
| `origin_run_id` | relation(1) → `discover_run` | |
| `created`, `updated` | autodate | |

### 2.4 `colour_fragment` — colour↔fragment links

| Field | Type | Notes |
|---|---|---|
| `colour_id` | relation(1) → `colour`, required, cascade | |
| `fragment_id` | relation(1) → `fragment`, required, cascade | |
| `match_type` | select(1), required | `manual_positive`, `manual_negative`, `thing`, `prompt` |
| `model` | text | model of a `prompt` row |
| `created` | autodate | |

Indexes: `idx_colour_fragment_colour (colour_id)`, `idx_colour_fragment_fragment (fragment_id)`, `idx_colour_fragment_pair (colour_id, fragment_id)` **unique**.

### 2.5 `projection` / 2.6 `reflection` — synthesis entities

| Field | Type | Notes |
|---|---|---|
| `name` | text | |
| `status` | select(1), required | `proposed`, `active` |
| `current_context_spec` | json | § 3 |
| `window_spec_versions` | json | **reflection only**; § 3 |
| `current_lens_id` | relation(1) → `lens` | no cascade |
| `model` | text | per-entity override |
| `pinned_by` | relation(∞) → `users` | |
| `origin_run_id` | relation(1) → `discover_run` | |
| `brief` | text | discover's proposed opening message |
| `created`, `updated` | autodate | |

No indexes.

### 2.7 `lens` — generation prompts (lenses)

| Field | Type | Notes |
|---|---|---|
| `context_spec` | json | § 3 |
| `prompt` | json | a JSON string |
| `created_from_proj_refinement_id` | relation(1) → `refine_proj_snapshot_conversation` | no cascade |
| `created_from_refl_refinement_id` | relation(1) → `refine_refl_snapshot_conversation` | no cascade |
| `parent_lens_id` | relation(1) → `lens` | |
| `created` | autodate | |

Read **and** write disabled for clients. No `model`, `iterations`, or `converged` fields exist.

### 2.8 `projection_snapshot` / 2.9 `reflection_snapshot` — generated outputs

| Field | Type | Notes |
|---|---|---|
| `projection_id` / `reflection_id` | relation(1), required, cascade | |
| `status` | text | `generating`, `pending`, `approved`, `discarded` (free text field) |
| `context_spec` | json | the lens's spec at generation |
| `resolved_context` | json | `{fragmentIds, snapshotIds}` receipt |
| `lens_id` | relation(1) → `lens` | |
| `output` | json | a JSON string |
| `created_from_refinement_id` | relation(1) → the matching refinement collection | |
| `model` | text | |
| `chain_origin` | text | `generate_all` or empty |
| `approval_sequence_number` | number | |
| `approval_timestamp`, `generation_timestamp` | date | |
| `window_spec`, `resolved_window` | json | **reflection only** |
| `window_key` | text | **reflection only** |
| `window_spec_version_number` | number | **reflection only** |
| `created`, `updated` | autodate | |

Indexes: `idx_projection_snapshot_projection (projection_id)`; `idx_projection_snapshot_approval_seq (projection_id, approval_sequence_number)` **unique where `status = 'approved'`**; `idx_reflection_snapshot_reflection (reflection_id)`; `idx_reflection_snapshot_approval_seq (reflection_id, window_key, approval_sequence_number)` **unique where `status = 'approved'`**.

### 2.10 `refine_proj_snapshot_conversation` / 2.11 `refine_refl_snapshot_conversation` — refinement sessions

| Field | Type | Notes |
|---|---|---|
| `projection_id` / `reflection_id` | relation(1), cascade | |
| `projection_snapshot_id` / `reflection_snapshot_id` | relation(1), cascade | reflections: never written |
| `external_conversation_id` | text | client id |
| `created` | autodate | |

Indexes: `idx_refine_proj_external (external_conversation_id)` **unique**, `idx_refine_proj_projection`, `idx_refine_proj_snapshot`; and the `refl` equivalents.

### 2.12 `chat_conversation` — free-chat sessions

`external_conversation_id` text (**unique** index `idx_chat_conversation_external`), `model` text (per-conversation override), `created`. Fully client-writable.

### 2.13 `chat_message` — messages for all three conversation kinds

| Field | Type | Notes |
|---|---|---|
| `chat_conversation_id` | relation(1) → `chat_conversation`, cascade | exactly one of the three is set |
| `refine_proj_conversation_id` | relation(1) → `refine_proj_snapshot_conversation`, cascade | |
| `refine_refl_conversation_id` | relation(1) → `refine_refl_snapshot_conversation`, cascade | |
| `content` | json | a full `UIMessage` (§ 3) |
| `model` | text | assistant rows only |
| `created`, `updated` | autodate | |

Indexes on each relation column. Fully client-writable.

### 2.14 `usage` — per-period token accounting

`period` text required (**unique** `idx_usage_period`; `YYYY-MM` UTC), `prompt_tokens`, `completion_tokens`, `total_tokens`, `cached_tokens` numbers, `created`, `updated`. Server-written.

### 2.15 `llm_queue_status` — live scheduler mirror (singleton)

`state` text (`idle` / `active`), `running` json, `waiting` json, `created`, `updated`. Server-written; reset at boot; excluded from the SQL echo log.

### 2.16 `kalaidoscope_config` — workspace config (singleton)

`model_set`, `provider`, `api_key`, `default_model` text; `role_models` json (role → model); `created`, `updated`. Create and delete disabled; update open to clients, with `model_set` superuser-only by hook (`models.md` § 3). The API key is stored in plain text and is client-readable.

### 2.17 `view_stream` — SQL view

Read-only. One row per fragment with `deleted_at = ''`: `id`, `type`, `content`, `source_time`, `created`, and `colours` = JSON array of the 0–7 index (`row_number() over (order by created) − 1) mod 8` of each colour the fragment is a member of (`match_type != 'manual_negative'`).

### 2.18 `reflection_window` — explicitly backfilled windows

`reflection_id` relation(1) required cascade; `window_key`, `start`, `end` text required; `window_spec_version_number` number; `created`. Indexes: `idx_reflection_window_reflection`, `idx_reflection_window_key (reflection_id, window_key)` **unique**. Grid windows are never stored here.

### 2.19 `fragment_annotation` — per-fragment map markup

| Field | Type | Notes |
|---|---|---|
| `fragment_id` | relation(1) → `fragment`, required, cascade | **unique** `idx_fragment_annotation_fragment` |
| `annotation` | json | legacy; never read |
| `title`, `summary` | text | |
| `things`, `decisions`, `questions`, `conclusions` | json | § 3 |
| `grounded_count` | number | things shown to the model |
| `folded` | bool | consumed by a consolidation; indexed `idx_fragment_annotation_folded` |
| `model` | text | |
| `created` | autodate | |

### 2.20 `kalaidoscope_map` — the things document (singleton)

`body` json (§ 3), `version` number, `consolidated_at` date, `fragments`, `annotated` numbers, `created`, `updated`. Server-written.

### 2.21 `map_run` — one row per consolidation call

`status` select (`running`, `done`, `error`) required; `error`, `model` text; `pending_in`, `merges`, `admits`, `version_before`, `version_after` numbers; `created`, `updated`.

### 2.22 `discover_run` — one row per discover run

`kind` select (`projections`, `reflections`, `colours`) required; `status` select (`running`, `done`, `error`) required; `error`, `model`, `summary` text; `map_version`, `rounds`, `fragment_reads` numbers; `outputs` json (§ 3); `created`, `updated`.

## 3. Stored JSON shapes

| Where | Shape |
|---|---|
| `*.current_context_spec`, `lens.context_spec`, `*_snapshot.context_spec` | `{wholeScope?, summaries?, fragmentIds?, fragmentTypes?, colourIds?, sourceProjectionIds?, sourceReflectionIds?}` (`context.md` § 1) |
| `*_snapshot.resolved_context` | `{fragmentIds?, snapshotIds?}` |
| `reflection.window_spec_versions` | `[{versionNumber, effectiveFrom, spec: {mode?, startTime, endTime?, period, duration}}]` |
| `reflection_snapshot.window_spec` | one `spec` as above; `resolved_window` = `{start, end}` |
| `lens.prompt`, `*_snapshot.output` | a JSON-encoded string |
| `chat_message.content` | `{id, role, parts: [{type, text?, data?}]}`; part types in use: `text`, `context_spec`, `window`, `pinned_ids`, `tool-update_lens`, `tool-suggest_name`, `tool-apply_result`, `tool-read_fragment`, `tool-read_thing`, `data-refine_lint`, `data-refine_error`, `data-window_reapply`, `data-lens_seed` |
| `colour.thing_ids` | `["t_…", …]` |
| `kalaidoscope_map.body` | `{things: [{id, name, aliases[], kind, blurb, fragments, first_seen?, last_seen?, exemplar_ids[]}], relationships: [{from, to, kind}], narrative}` |
| `fragment_annotation.things` | `[{ref} \| {name, kind, note}]`; `decisions`/`questions`/`conclusions`: `[{text, refs[]}]` |
| `discover_run.outputs` | `[{kind, id, name, status?}]` |
| `kalaidoscope_config.role_models` | `{"<role>": "<model>"}` |
| `llm_queue_status.running` / `waiting` | `[{role, priority, model, started, tokens?, tokens_per_second?}]` / `{"<priority>": count}` |

## 4. Boot-time schema interactions

- `usage.Setup` fails boot unless `usage` has a unique single-column index on `period`.
- `resolveModelSet` creates the `kalaidoscope_config` singleton if absent and seeds `model_set`.
- `registerQueueStatus` finds or creates the `llm_queue_status` singleton and resets it.
- `mapping.loadDocument` creates the `kalaidoscope_map` singleton (`version 0`) on first use, not at boot.
- `SweepGenerationClaims` deletes every `*_snapshot` row with `status = 'generating'`.
- `seedSidecarUser` upserts the `users` record `user@kalaido.local`.

## 5. Cascade graph

Deleting → also deletes:

- `fragment` (hard delete only; the API soft-deletes) → `colour_fragment`, `fragment_annotation`.
- `colour` → `colour_fragment`.
- `projection` → `projection_snapshot` → `refine_proj_snapshot_conversation` (via `projection_snapshot_id`) → `chat_message`; also `refine_proj_snapshot_conversation` directly (via `projection_id`).
- `reflection` → `reflection_snapshot`, `reflection_window`, `refine_refl_snapshot_conversation` → `chat_message`.
- `chat_conversation` → `chat_message`.
- Nothing cascades to or from `lens`, `discover_run`, `map_run`; deleting a `discover_run` leaves `origin_run_id` dangling on its entities (PocketBase clears the relation value).
