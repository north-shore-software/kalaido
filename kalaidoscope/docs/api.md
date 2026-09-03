> **STALE** — code has changed since this document was generated.

# Kalaidoscope HTTP API — Generated Audit Snapshot

> **Generated:** 2026-09-02, from source at commit `3998ebd`.
> This file is a generated audit snapshot — do not edit it. See `AGENTS.md` § "Generated audit docs". When code described here changes, a stale marker line is prepended above this block; nothing else in the file is ever modified by hand.

**Scope.** The externally callable HTTP surface of the kalaidoscope PocketBase server (single-tenant sidecar): every custom route, every hook that modifies PocketBase's built-in collection endpoints, auth posture, and shared wire/error conventions. This is a route index: each row states the request and response contract and points at the doc that describes the mechanics. PocketBase's generic surface (`/api/collections/*`, `/api/realtime`, `/api/files/*`, the `/_/` dashboard) is otherwise not documented.

**Completeness anchor.** 31 custom routes, registered at exactly two sites: `server/server.go` `RegisterRoutes` (29 routes) and `internal/ollama/handlers.go` `RegisterRoutes` (2 routes). 6 collection hooks, registered in `server/server.go` `RegisterTriggers` (3), `internal/ingest/batch.go` (1), and `internal/config/hooks.go` (2).

---

## 1. Wire conventions

- JSON field names are **lowerCamelCase** throughout, with one exception: the `POST /api/ingest` body uses **snake_case** for its multi-word fields (`source_time`, `skip_duplicates`).
- Declared DTOs live in `internal/api`. Where a handler binds an **anonymous struct** instead (create/update of projections and reflections, discover kick, token resolution), this document records the fields actually bound.
- Errors raised through PocketBase helpers (`BadRequestError`, `NotFoundError`, `InternalServerError`, `e.Error(status, …)`) use PocketBase's standard JSON error envelope. Domain-specific bodies (quota exhaustion, provider failures, validation) are in § 13.
- Streaming routes commit `200` and headers before work begins; later failures are in-band (§ 13).
- **No custom route requires authentication** and none reads the caller's identity except `PATCH` `pinned` (§ 5/6); see § 13.

## 2. Ingestion

| Endpoint | Request | Behaviour & side effects | Response / errors |
|---|---|---|---|
| `POST /api/ingest` | `{type?, source?, content, source_time?, skip_duplicates?, format?, limit?, extensions?}` | One fragment written inline (`ingestion.md` § 2). `format`/`limit`/`extensions` accepted, unused. | `200 {fragmentId, ingested}` (`""`/`0` when deduped); `400` empty content; `500` write failure |

The batch path is the `ingest` collection's create endpoint (§ 12).

## 3. Context & tokens

| Endpoint | Request | Behaviour & side effects | Response / errors |
|---|---|---|---|
| `POST /api/context/tokens` | a `ContextSpec` (`context.md` § 1) plus `window? {start, end}` | Resolves each selector separately and estimates `chars/4` of its full hydration (`summaries: true` → row hydration for the whole-scope case). A window with a missing bound is ignored. Resolution errors count as 0. | `200 {totalTokens, breakdown: {"WholeScope" \| "Fragment:<id>" \| "Type:<t>" \| "Colour:<id>" \| "Projection:<id>" \| "Reflection:<id>": n}}`; `400` bad JSON |
| `GET /api/llm/preflight` | — | Per-role readiness without a model call (`models.md` § 4) | `200 {modelSet, ok, roles: [{role, model?, provider?, ok, detail?}]}` |
| `POST /api/llm/validate` | `{provider, apiKey?, defaultModel?, roleModels?}` | Live-tests every referenced model without saving (`models.md` § 4) | `200 {ok}` or `200 {ok: false, kind?, provider?, model?, detail}`; `400` no provider / no model |

## 4. Chat

| Endpoint | Request | Behaviour & side effects | Response / errors |
|---|---|---|---|
| `POST /api/chat` | `{id, messages: [UIMessage]}` | If `id` names a refinement conversation → `refinement.md` § 3–4. Else general chat: persists new messages, hydrates, streams one assistant turn; summaries mode loops read tools (`chat.md`). | SSE (`chat.md` § 6); before the stream: `400` bad body / empty transcript, `422` context too large, `402` quota (unreachable), provider envelope, `500` |

## 5. Projections

| Endpoint | Request | Behaviour & side effects | Response / errors |
|---|---|---|---|
| `POST /api/projections` | `{name}` (`windowSpec` → 400) | Creates an `active` projection with nothing else (`lifecycle-projection.md` § 2) | `201 {projectionId}` |
| `PATCH /api/projections/{id}` | `{name?, pinned?, model?}` | Renames; sets/clears model override; toggles the authenticated user in `pinned_by` (`lifecycle-projection.md` § 7) | `200 {id}`; `404` |
| `DELETE /api/projections/{id}` | — | Deletes with cascades (`lifecycle-projection.md` § 6) | `204`; `404` |
| `POST /api/projections/{id}/candidates` | `{preview?}` (other declared fields unread) | Generates one snapshot: `pending` if preview, else approved; claim row; minimal-diff rewrite (`lifecycle-projection.md` § 4) | `200 {snapshotId}`; `409` blocked by upstream / lens not ready / generation in flight; `422` context too large; `404`; provider envelope; `500` |
| `POST /api/projections/{id}/candidates/{rid}/approve` | — | Promotes the candidate; discards other pending (`lifecycle-projection.md` § 4.3) | `200 {snapshotId}`; `404` unknown or foreign candidate; `422` not approvable |

## 6. Reflections

| Endpoint | Request | Behaviour & side effects | Response / errors |
|---|---|---|---|
| `POST /api/reflections` | `{name, windowSpec?}` | Creates with version 1 of the schedule (`lifecycle-reflection.md` § 2) | `201 {reflectionId}`; `400` invalid spec |
| `PATCH /api/reflections/{id}` | `{name?, pinned?, model?, windowSpec?}` | As projections, plus appends a schedule version (`lifecycle-reflection.md` § 3) | `200 {id}`; `400`; `404` |
| `DELETE /api/reflections/{id}` | — | Deletes with cascades | `204`; `404` |
| `POST /api/reflections/{id}/generate-snapshot` | `{preview?, windowId?, all?}` | Generates the selected windows concurrently (`lifecycle-reflection.md` § 5) | `200 {snapshotIds}`; `400` unknown window / several pending without `all`; `409`, `422`, `404`, envelope, `500` as projections |
| `GET /api/reflections/{id}/windows` | — | The series with status flags (`lifecycle-reflection.md` § 9) | `200 {windows: [{id, start, end, key, hasApproved, generating, backfilled, stale?, lensOutdated?}], currentWindowId?}`; `404` |
| `POST /api/reflections/{id}/backfill` | `{from}` RFC3339 | Materialises windows before the grid and starts background generation (`lifecycle-reflection.md` § 9) | `200 {windows}`; `400` bad date / out of range; `404`; `500` unscheduled |

There is no reflection approve route (`lifecycle-reflection.md` § 6).

## 7. Refinements

| Endpoint | Request | Behaviour & side effects | Response / errors |
|---|---|---|---|
| `POST /api/projections/{id}/refinements` | `{clientId, snapshotId?, contextSpec?}` | Opens a session; seeds context (`refinement.md` § 2) | `201 {refinementId, messages?}`; `400` missing clientId; `500` |
| `POST /api/reflections/{id}/refinements` | `{clientId, window?, contextSpec?}` (`snapshotId` ignored) | Opens a session bound to a window; seeds context and the current lens | as above |
| `POST /api/projections/{id}/refinements/{rid}/commit` | — | Creates the lens, appends and approves a snapshot, re-points the parent (`refinement.md` § 5) | `200 {snapshotId}`; `400` no lens / parent mismatch; `404`; `409` lens has no preview; `500` |
| `POST /api/reflections/{id}/refinements/{rid}/commit` | — | Creates the lens, re-points the parent, starts pending-window generation; publishes no snapshot | `200 {snapshotId: ""}`; errors as above |

Turns within a session go through `POST /api/chat` (§ 4).

## 8. Colours

| Endpoint | Request | Behaviour & side effects | Response / errors |
|---|---|---|---|
| `POST /api/colours/preview` | `{prompt, positiveExamples?, negativeExamples?}` | Judges the 20 newest fragments at Interactive priority; streams matches (`colours.md` § 5) | SSE `data: <fragment JSON>` per match; `400`; `500` no model / no fragments |
| `POST /api/colours` | `{name, prompt?, fragmentIds?, positiveExamples?, negativeExamples?}` | Creates; seeds `prompt` rows from `fragmentIds`; writes examples; signals the worker | `200 {colourId}`; `400` empty name; `500` |
| `PATCH /api/colours/{id}` | `{name?, prompt?, positiveExamples?, negativeExamples?, clearExamples?}` | Writes examples; renames; a changed prompt restarts matching | `200 {colourId, name, prompt}`; `400` missing id; `404`; `500` |
| `DELETE /api/colours/{id}` | — | Scrubs the id from live context specs; deletes (links cascade) | `204`; `404` |
| `POST /api/colours/{id}/rematch` | — | Drops prompt rows and watermark; recomputes thing rows; signals the worker | `202`; `404` |

## 9. Rotation, reconcile, map & discover

| Endpoint | Request | Behaviour & side effects | Response / errors |
|---|---|---|---|
| `GET /api/rotation` | — | Full staleness evaluation (`rotation.md`) | `200 {statuses: [EntityStatus]}`; `500` |
| `POST /api/reconcile` | — | Requests a wave — **disabled**, logged and dropped (`rotation.md` § 3) | `202` |
| `POST /api/map` | — | Signals the annotate worker (`map.md` § 5) | `202` |
| `POST /api/discover` | `{kind}` | Signals a discover run for `colours`, `projections`, or `reflections` (`discover.md` § 2) | `202`; `400` unknown kind |

## 10. LLM provider

Covered in § 3 (`/api/llm/preflight`, `/api/llm/validate`); configuration itself is written through the `kalaidoscope_config` collection endpoint (§ 12).

## 11. Ollama

| Endpoint | Request | Behaviour & side effects | Response / errors |
|---|---|---|---|
| `GET /api/ollama/status` | — | Lists local models (5 s timeout) | `200 {reachable, models: [{name, size}], error?}` — never non-200 |
| `POST /api/ollama/pull` | `{model}` | Streams pull progress (`models.md` § 7) | `200` NDJSON `{status, completed, total}`… then `{status: "success", done: true}` or `{error}`; `400` empty model |

## 12. Hook-modified collection endpoints

| Collection & operation | Hook | Effect |
|---|---|---|
| `fragment` create | `OnRecordCreate` | `source_time` defaults to now; `origin` defaults to `app` |
| `fragment` create | `OnRecordAfterCreateSuccess` | Signals the colour worker; map auto-signal (compiled out) |
| `fragment` delete (REST) | `OnRecordDeleteRequest` | **Soft delete**: sets `deleted_at`, returns `204`, row kept (`ingestion.md` § 7) |
| `ingest` create | `OnRecordCreate` | Reads uploads and config, sets `status = pending`, processes in the background (`ingestion.md` § 3) |
| `kalaidoscope_config` update (REST) | `OnRecordUpdateRequest` | `403` if the body touches `model_set` without superuser auth |
| `kalaidoscope_config` update (any) | `OnRecordUpdate` | Requires a model when a provider is set; live-validates changed credentialed models; on commit republishes the config and reconfigures the scheduler (`models.md` § 3) |

Every other collection endpoint behaves as PocketBase defines it, subject to the rules in `schema.md` § 2.

## 13. Cross-cutting

**Auth posture.** Collection endpoints require an authenticated `users` record (`@request.auth.id != ''`) where enabled (`schema.md` § 2); the sidecar seeds one user and prints its token at boot (`boot-and-workers.md` § 1). Custom routes register **no** auth middleware: any caller reaching the port may generate, commit, delete, or ingest. `PATCH` `pinned` is the only custom-route behaviour that reads `e.Auth`, and it is silently skipped when absent.

**Quota exhaustion.** `402 {error: "quota_exhausted", period, used}` — emitted by chat, refinement, generation, and preview paths when `usage.ErrExhausted` is returned; no authorizer is installed in this binary, so it never is (`llm-queue-quota.md` § 1, § 5).

**Provider failures.** A classified `ProviderError` becomes `{error, kind, provider, model, detail}` with status `409` (`provider_auth_failed`), `429` (`provider_quota_exceeded`), `502` (`provider_transient` / `provider_error`) — `llm-queue-quota.md` § 6. Ollama failures are never classified and surface as `500`.

**Context too large.** `422` with the guard's message (`context.md` § 6) from chat, refinement, and generation; inside an open stream, as an SSE `error` event or a `data-refine_error {kind: context_too_large}` part.

**Validation payloads.** Config-hook rejections are `400` with PocketBase validation data keyed on `default_model` (`model_required`) or `api_key` (`provider_<kind>` / `provider_validation_failed`).

**Detached work.** Generation and commit run under `context.WithoutCancel`; a client disconnect does not stop them. Backfill, discover, map, reconcile, and rematch return `202`/`200` before any work; progress is visible only through collection changes over `/api/realtime` and the `llm_queue_status` row.
