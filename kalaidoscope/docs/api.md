# Kalaidoscope HTTP API — Generated Audit Snapshot

> **Generated:** 2026-08-18, from source at commit `f272f1c`.
> This file is a generated audit snapshot — do not edit it. See `AGENTS.md` § "Generated audit docs". When code described here changes, a stale marker line is prepended above this block; nothing else in the file is ever modified by hand.

**Scope.** The externally callable HTTP surface of the kalaidoscope PocketBase server (single-tenant sidecar): every custom route, every hook that modifies PocketBase's built-in collection endpoints, auth posture, and shared wire/error conventions. PocketBase's generic surface (`/api/collections/*`, `/api/realtime`, `/api/files/*`, the `/_/` dashboard) is otherwise not documented.

**Completeness anchor.** 26 custom routes, registered at exactly two sites: `server/server.go` `RegisterRoutes` (24 routes) and `internal/ollama/handlers.go` `RegisterRoutes` (2 routes). 7 collection hooks, registered in `server/server.go` `RegisterTriggers`, `internal/ingest/batch.go`, and `internal/config/hooks.go`.

**Generation status.** Initial generation is proceeding in reviewed slices; sections marked *(pending)* are not yet generated.

---

## 1. Wire conventions

- JSON field names are **lowerCamelCase** throughout (`fragmentIds`, `snapshotId`, `wholeScope`), with one exception: the `POST /api/ingest` body uses **snake_case** for its multi-word fields (`source_time`, `skip_duplicates`).
- Declared request/response DTOs live in `internal/api` (package `api`). Several handlers bind **anonymous structs** instead of the declared types; where that happens, this document records the fields actually bound, and notes the declared type as unbound.
- Errors raised through PocketBase helpers (`BadRequestError`, `InternalServerError`, …) use PocketBase's standard JSON error envelope. Domain-specific error bodies (quota exhaustion, provider failures) are described in § 13.
- No custom route requires authentication; the collection-rule and auth posture are described in § 13.

---

## 2. Ingestion

| Endpoint | Request | Behaviour & side effects | Response / errors |
|---|---|---|---|
| `POST /api/ingest` (sync, single fragment) | `IngestMessage`: `type` (string; blank → `"note"`; any non-blank value is stored as-is, no canonical-list validation), `source` (string), `content` (string, required non-whitespace), `source_time` (RFC3339 string, optional), `skip_duplicates` (bool). Also accepted but **unused** by this endpoint: `format`, `limit`, `extensions`. | Creates one `fragment` record with `type`, `source`, trimmed `content`, and `source_time`. An unparseable `source_time` is **silently ignored** (fragment falls back to ingestion time via the § 12 create hook). With `skip_duplicates: true`, the SHA-256 of the trimmed content is checked against the content hashes of **all existing fragments, including soft-deleted ones**; an exact match creates nothing. Fragment creation fires the § 12 create hooks (default `source_time`, colour-evaluation enqueue). | `200` `{fragmentId, ingested}` with `ingested` `0` or `1`. A skipped duplicate is `200` with `fragmentId: ""`, `ingested: 0`. `400` invalid body or empty/whitespace `content`. `500` on write failure. |
| `POST /api/collections/ingest/records` (async, file batch — built-in endpoint, behaviour via create hook) | Multipart create of an `ingest` record: `file` (one or more uploads), `format` (`"zip"` \| `"mbox"` \| `"docx"` \| `"text"`; blank → inferred **per file** from extension: `.mbox`/`.eml` → mbox, `.zip` → zip, `.docx` → docx, anything else → text), `limit` (int; 0 = unlimited; a single budget shared across all files in the record), `extensions` (CSV filter for zip entries, normalized to lowercased dot-prefixed values; blank → `.txt,.md,.docx`), `skip_duplicates` (bool). | The create hook reads the uploads and options, forces `status: "pending"`, and after the record saves processes the files in a **background goroutine**: each file is parsed into fragments (`type` `"email"` for mbox messages, otherwise `"note"`) and written through the same writer as the sync endpoint — same trim, dedupe, and limit rules; the dedupe hash set is preloaded once per record and shared across its files. Processing **stops at the first file that errors**. Every written fragment fires the § 12 create hooks. | The create request returns the saved record immediately (`status: "pending"`). Completion is observable on the record: `ingested` = total fragments written, and `status` `"done"`, or `"error"` with the `error` field set. Reaching the `limit` budget and context cancellation are treated as normal completion, not errors. |

---

## 3. Context & tokens

| Endpoint | Request | Behaviour & side effects | Response / errors |
|---|---|---|---|
| `POST /api/context/tokens` | A bare `ContextSpec` object (no wrapper): `wholeScope` (bool), `fragmentIds`, `fragmentTypes`, `colourIds`, `sourceProjectionIds`, `sourceReflectionIds` (all string arrays). | Estimates the prompt-token cost of a context spec. `wholeScope: true` short-circuits: all non-soft-deleted fragments are hydrated as a single component and every other field is ignored. Otherwise **each array element is resolved and hydrated independently** as its own single-element spec, and its token count is rendered-text length ÷ 4. Resolution semantics (shared with the engine's context resolution): fragments must have `deleted_at` unset — this filter also applies to explicitly pinned `fragmentIds`; `colourIds` resolve to every fragment holding a `colour_fragment` link to the colour **regardless of the link's `match_type`** (manual-negative links included); `sourceProjectionIds` / `sourceReflectionIds` resolve to the entity's latest **approved** snapshot (highest `approval_sequence_number`), one snapshot per entity. A component whose resolution errors contributes 0 tokens, silently. | `200` `{totalTokens, breakdown}`. `breakdown` is keyed `"WholeScope"` or `"Fragment:{id}"` / `"Type:{type}"` / `"Colour:{id}"` / `"Projection:{id}"` / `"Reflection:{id}"`. `totalTokens` is the sum of the independent components, so a fragment matched by more than one component is counted once per component. `400` invalid JSON. |

---

## 4. Chat *(pending)*

## 5. Projections *(pending)*

## 6. Reflections *(pending)*

## 7. Refinements *(pending)*

## 8. Colours *(pending)*

## 9. Rotation & reconcile *(pending)*

## 10. LLM provider *(pending)*

## 11. Ollama *(pending)*

---

## 12. Hook-modified collection endpoints

These PocketBase hooks change the behaviour of the built-in `/api/collections/...` endpoints (and apply equally to server-internal writes, where noted).

| Hook | Collection | Behaviour |
|---|---|---|
| `OnRecordCreate` | `fragment` | If `source_time` is unset/zero, defaults it to the current time. Applies to every creation path (direct record create, both ingestion paths). |
| `OnRecordAfterCreateSuccess` | `fragment` | Enqueues asynchronous colour evaluation of the new fragment (§ 8). Fires on every successful creation, from any path. |
| `OnRecordDeleteRequest` | `fragment` | **Soft delete.** If `deleted_at` is unset, sets it to now and saves; the row is never deleted. Returns `204` either way, so repeated deletes are idempotent and the original `deleted_at` is preserved. Applies only to the HTTP delete endpoint (server-internal deletes are not intercepted). |
| `OnRecordCreate` | `ingest` | Runs the async batch-ingestion pipeline described in § 2. |
| `OnRecordUpdateRequest` | `kalaidoscope_config` | *(pending — slice 5)* |
| `OnRecordUpdate` | `kalaidoscope_config` | *(pending — slice 5)* |
| `OnRecordAfterUpdateSuccess` | `kalaidoscope_config` | *(pending — slice 5)* |

---

## 13. Cross-cutting *(pending)*

Will cover: auth posture (no middleware on custom routes; collection-level API rules; the seeded local user), shared error shapes (quota exhaustion, provider errors, blocked-upstream conflict), and response formats (SSE, NDJSON, no-body statuses).
