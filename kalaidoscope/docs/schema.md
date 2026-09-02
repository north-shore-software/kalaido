> **STALE** — code has changed since this document was generated.

# Kalaidoscope Database Schema — Generated Audit Snapshot

> **Generated:** 2026-08-18, from source at commit `f272f1c`.
> This file is a generated audit snapshot — do not edit it. See `AGENTS.md` § "Generated audit docs". When code described here changes, a stale marker line is prepended above this block; nothing else in the file is ever modified by hand.

**Scope.** Every collection, field, index, access rule, and stored-JSON shape of the kalaidoscope PocketBase database, plus the migration mechanics and boot-time schema interactions. PocketBase's own system collections (`users`, `_superusers`, …) are covered only where the code touches them.

**Completeness anchor.** One migration file: `migrations/1748000000_init_schema.go`, defining 16 base collections and 1 SQL view. No other migration exists.

---

## 1. Migration mechanics

- The single migration is **ensure-style and idempotent**: pass one creates any missing base collections empty (so relation fields can resolve targets), pass two sets fields, indexes, and rules on every collection.
- `ensureField` only **adds** fields that are missing by name — it never alters an existing field's definition and never removes fields. A field rename or type change therefore does not propagate by re-running the migration.
- Indexes are (re-)added by name on every run. Rules are reassigned on every run.
- The down migration deletes all collections in reverse definition order.
- **Access rules** are generated: every enabled operation gets `@request.auth.id != ''`; a disabled operation gets a `nil` rule (superuser/server-only). Flags per collection: `DisableWriteOperations` (create+update+delete), `DisableReadOperations` (list+view), and per-op `DisableCreate`/`DisableUpdate`/`DisableDelete`.

---

## 2. Collections

Field-type notation: `text`, `number`, `bool`, `date`, `json`, `select(...)`, `file`, `rel(target)` (single-select relation unless noted), `autodate` columns are listed once as *timestamps*. "Cascade" on a relation means deleting the target deletes this row.

### 2.1 `fragment` — ingested content units

Authed API access: full CRUD (HTTP delete intercepted → soft delete; see `api.md` § 12).

| Field | Type | Notes |
|---|---|---|
| `type` | select(`email`, `note`, `whatsapp`, `sms`, `chat`), required | `chat` marks output captured from a chat rather than ingested; otherwise ordinary. The select constrains **all** writes — any other value fails the record save. |
| `source` | text | Source label. |
| `content` | text, required | Max 100,000,000 characters. |
| `source_time` | date | Event time; defaulted to now by hook when unset. |
| `deleted_at` | date | Soft-delete tombstone; empty = live. All context resolution filters on it. |
| `created` | autodate | |

Indexes: `source_time`, `deleted_at` (both non-unique).

### 2.2 `ingest` — async file-ingestion jobs

Authed API access: full CRUD (creation triggers the batch pipeline, `api.md` § 2).

| Field | Type | Notes |
|---|---|---|
| `file` | file | Up to 50 uploads, 200 MiB each. |
| `format` | text | `zip` \| `mbox` \| `docx` \| `text`; empty = inferred per file. |
| `limit` | number | Fragment budget across all files; 0 = unlimited. |
| `extensions` | text | CSV zip-entry filter. |
| `skip_duplicates` | bool | |
| `status` | text | `pending` → `done` \| `error` (server-written). |
| `ingested` | number | Total fragments written (server-written). |
| `error` | text | First failing file's error (server-written). |
| timestamps | autodate | `created`, `updated`. |

No custom indexes.

### 2.3 `colour` — tag definitions

Authed API access: read-only.

| Field | Type | Notes |
|---|---|---|
| `name` | text, required | |
| `colour_value` | text | Display value; never written by any current server code path. |
| `criteria` | text | The LLM matching prompt. |
| `last_provider_error_kind` | text | `auth`/`quota` recorded by the background evaluation worker (which has no request to fail); cleared on next success. |
| timestamps | autodate | `created`, `updated`. |

### 2.4 `colour_fragment` — colour↔fragment links

Authed API access: read-only.

| Field | Type | Notes |
|---|---|---|
| `colour_id` | rel(colour), required, cascade | |
| `fragment_id` | rel(fragment), required, cascade | |
| `match_type` | select(`manual_positive`, `manual_negative`, `llm_matched_backfill`, `llm_matched_tag_on_input`), required | One link per pair holds the *current* classification; manual tagging overwrites whatever was there. |
| `model` | text | Model that decided an `llm_matched_*` row; empty for manual or pre-provenance rows. |
| `created` | autodate | |

Indexes: `colour_id`, `fragment_id`, and **unique** `(colour_id, fragment_id)`.

### 2.5 `projection` / 2.6 `reflection` — synthesis entities

Authed API access: read-only (all writes go through the custom routes).

| Field | Type | Notes |
|---|---|---|
| `name` | text | |
| `current_context_spec` | json | `ContextSpec` (§ 3). Written only by refinement commits with `updateLensAndContext: true`. |
| `window_spec_versions` | json | **Reflection only.** Append-only `WindowSpecVersion[]` (§ 3); seeded with an empty version 1 at create. |
| `current_lens_id` | rel(lens) | The active lens; installed by lens distillation. |
| `model` | text | Per-entity model override; empty = workspace role default. |
| `pinned_by` | rel(users), multi | User ids that pinned this entity. |
| `last_provider_error_kind` | text | As `colour`: durable marker from the background lens-distillation worker. |
| timestamps | autodate | `created`, `updated`. |

No custom indexes.

### 2.7 `lens` — distilled generation prompts

API access: **fully hidden** — read and write both disabled for non-superusers.

| Field | Type | Notes |
|---|---|---|
| `context_spec` | json | The spec the lens was distilled against. |
| `prompt` | json | JSON-encoded string: the lens prompt text. |
| `created_from_proj_refinement_id` | rel(refine_proj_snapshot_conversation) | Provenance; at most one of the two is set. |
| `created_from_refl_refinement_id` | rel(refine_refl_snapshot_conversation) | |
| `parent_lens_id` | rel(lens) | Audit lineage only — distillation never reads the previous lens. |
| `model` | text | Model that generated this lens; empty = pre-provenance. |
| `iterations` | number | Distillation candidates executed before settling. |
| `converged` | bool | True = loop reproduced the approved snapshot; false = budget ran out, best-scored candidate kept. |
| `created` | autodate | |

No custom indexes. No cascade: lenses survive deletion of the entity and conversations that produced them (their relation fields then dangle).

### 2.8 `projection_snapshot` / 2.9 `reflection_snapshot` — generated outputs

Authed API access: read-only.

| Field | Type | Notes |
|---|---|---|
| `projection_id` / `reflection_id` | rel(parent), required, cascade | |
| `status` | text | `pending` \| `approved` (written by the engine; no select constraint). |
| `context_spec` | json | Spec used for this generation (`ContextSpec`, § 3). |
| `resolved_context` | json | `PinnedIDs` receipt (§ 3): exactly which fragments/snapshots went in; what staleness diffs against. |
| `lens_id` | rel(lens) | Empty on a commit that requested re-distillation, until the worker back-fills it. |
| `output` | json | JSON-encoded string: the generated text. |
| `created_from_refinement_id` | rel(refine conversation) | Set when committed from a refinement. |
| `lens_distill_requested` | bool | Immutable fact about the commit; worker worklist = `requested && lens_id = ''`, so a crash loses nothing. |
| `model` | text | Generating model; empty for empty-lens generations and pre-provenance rows. |
| `chain_origin` | text | Non-empty when generated inside a speculative reconcile wave; propagates through refinement commits of still-pending chain candidates. |
| `approval_sequence_number` | number | 0 = unapproved. |
| `approval_timestamp`, `generation_timestamp` | date | |
| `window_spec`, `resolved_window` (`{start, end}`), `window_key`, `window_spec_version_number` | json / text / number | **Reflection snapshot only.** Set only for windowed generations; `window_key` = `"{start}_{end}"` RFC3339. |
| timestamps | autodate | `created`, `updated`. |

Indexes: parent id (non-unique), plus partial **unique** approval index `WHERE status = 'approved'`: `(projection_id, approval_sequence_number)` / `(reflection_id, window_key, approval_sequence_number)` — sequences count per window for reflections.

### 2.10 `refine_proj_snapshot_conversation` / 2.11 `refine_refl_snapshot_conversation` — refinement sessions

Authed API access: read-only (created via the custom routes).

| Field | Type | Notes |
|---|---|---|
| `projection_id` / `reflection_id` | rel(parent), cascade | Optional (a session can be anchored via its snapshot instead). |
| `projection_snapshot_id` / `reflection_snapshot_id` | rel(snapshot), cascade | Optional source snapshot. |
| `external_conversation_id` | text | Client-minted id; how `POST /api/chat` dispatch recognizes the session. |
| `created` | autodate | |

Indexes: **unique** `external_conversation_id`; parent id; snapshot id.

### 2.12 `chat_conversation` — free-chat sessions

Authed API access: full CRUD.

| Field | Type | Notes |
|---|---|---|
| `external_conversation_id` | text | Client-minted; **unique** index. |
| `model` | text | Per-conversation model override; re-read every turn. |
| `created` | autodate | |

### 2.13 `chat_message` — messages for all three conversation kinds

Authed API access: full CRUD.

| Field | Type | Notes |
|---|---|---|
| `chat_conversation_id` | rel(chat_conversation), cascade | Exactly one of the three relation fields is set per row (by convention; not schema-enforced). |
| `refine_proj_conversation_id` | rel(refine_proj_snapshot_conversation), cascade | |
| `refine_refl_conversation_id` | rel(refine_refl_snapshot_conversation), cascade | |
| `content` | json | The whole `UIMessage` (§ 3). |
| `model` | text | Model that generated an assistant row; empty otherwise. |
| timestamps | autodate | `created`, `updated`. |

Indexes: one per relation field (non-unique). Message ordering is by `created`.

### 2.14 `usage` — per-period token accounting

Authed API access: read-only.

| Field | Type | Notes |
|---|---|---|
| `period` | text, required | `YYYY-MM` key; **unique** index (boot-asserted, § 4). |
| `prompt_tokens`, `completion_tokens`, `total_tokens` | number | Monotonic accumulators, updated transactionally with one retry. |
| timestamps | autodate | `created`, `updated`. |

### 2.15 `llm_queue_status` — live scheduler mirror (singleton)

Authed API access: read-only. Describes the running process, not workspace data: reset to empty at boot, updated by a debounced (300 ms) mirror of the scheduler so the UI can watch the queue over PocketBase realtime.

| Field | Type | Notes |
|---|---|---|
| `state` | text | `idle` \| `active`. |
| `running` | json | `TaskInfo[]` (§ 3). |
| `waiting` | json | Map of priority name → queued count. |
| timestamps | autodate | `created`, `updated`. |

### 2.16 `kalaidoscope_config` — workspace config (singleton)

Authed API access: read + update only (no create/delete); `model_set` superuser-only and provider changes live-validated via hooks (`api.md` § 12).

| Field | Type | Notes |
|---|---|---|
| `model_set` | text | Which artifact-stamping model set this scope was initialized as. Seeded once at first boot from `KALAIDO_MODEL_SET` (default `local`); thereafter the stored value wins and a disagreeing env var is warned about and ignored. |
| `provider` | text | Empty = unconfigured → env-seeded model-set mode. One provider at a time; not namespaced. |
| `api_key` | text | Stored as-is (plaintext) in the database. |
| `default_model` | text | |
| `role_models` | json | Map role → model; unreadable JSON is logged and ignored (fallback to `default_model`). |
| timestamps | autodate | `created`, `updated`. |

### 2.17 `view_stream` — SQL view

Authed API access: read-only (list/view). Query: all **non-deleted** fragments (`id`, `type`, `content`, `source_time`, `created`) joined with `colours` — a JSON array of palette indices, where each colour's index is its creation-order row number mod 8. A fragment's array lists the palette slots of every colour linked to it via `colour_fragment`, **regardless of `match_type`** (manual-negative links included).

---

## 3. Stored JSON shapes

All camelCase except `TaskInfo`.

| Shape | Stored in | Fields |
|---|---|---|
| `ContextSpec` | `*.current_context_spec`, `*_snapshot.context_spec`, `lens.context_spec` | `wholeScope` (bool), `fragmentIds`, `fragmentTypes`, `colourIds`, `sourceProjectionIds`, `sourceReflectionIds` (string arrays; all optional/omitted when empty) |
| `WindowSpecVersion[]` | `reflection.window_spec_versions` | Each: `versionNumber` (int), `effectiveFrom` (RFC3339, UTC), `spec` = `WindowSpec` |
| `WindowSpec` | inside versions; `reflection_snapshot.window_spec` | `mode`, `startTime`, `endTime`, `period`, `duration` (strings; the engine reads only `period` — a Go duration — and `startTime`) |
| `PinnedIDs` | `*_snapshot.resolved_context` | `fragmentIds`, `snapshotIds` (string arrays) |
| resolved window | `reflection_snapshot.resolved_window` | `{start, end}` (RFC3339 strings) |
| JSON-encoded string | `lens.prompt`, `*_snapshot.output` | A bare JSON string value |
| `UIMessage` | `chat_message.content` | `id`, `role`, `parts: [{type, text?, data?}]` — part types in use: `text`, `context_spec`, `pinned_ids`, `window_spec`, `tool-<toolName>` |
| `TaskInfo[]` | `llm_queue_status.running` | Each (**snake_case where multi-word**): `role`, `priority`, `model`, `started`, `tokens?`, `tokens_per_second?` |
| waiting map | `llm_queue_status.waiting` | `{<priority name>: <count>}` |
| `role_models` | `kalaidoscope_config.role_models` | `{<role>: <model>}` |

---

## 4. Boot-time schema interactions

- **`usage.period` unique-index assertion**: the server refuses to boot if the unique index is missing (guards the first-write-of-a-new-period race).
- **`llm_queue_status`** is wiped to a single empty row at boot.
- **`kalaidoscope_config`** singleton row is created at first boot when absent (seeding `model_set`); a corrupt stored `model_set` is a fatal boot error.
- **`users`**: the built-in auth collection; a `user@kalaido.local` record is seeded at boot and its JWT printed to stdout (`api.md` § 13).

---

## 5. Cascade graph

Deleting a record removes, transitively, everything below it:

- `colour` → its `colour_fragment` links.
- `fragment` → its `colour_fragment` links. (Fragment HTTP deletes are soft; a genuine hard delete happens only server-side or via superuser.)
- `projection` → its `projection_snapshot`s and `refine_proj_snapshot_conversation`s → their `chat_message`s.
- `reflection` → its `reflection_snapshot`s and `refine_refl_snapshot_conversation`s → their `chat_message`s.
- `projection_snapshot` / `reflection_snapshot` → refinement conversations anchored to them → their `chat_message`s.
- `chat_conversation` → its `chat_message`s.
- `lens` rows are never cascaded and survive their creators; entity/snapshot `lens_id` references have **no** cascade in either direction.
