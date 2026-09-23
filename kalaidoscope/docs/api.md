> **STALE** — code has changed since this document was generated.

# Kalaidoscope HTTP API — Generated Audit Snapshot

> **Generated:** 2026-09-17, from source at commit `895984c`.
> This file is a generated audit snapshot — do not edit it. See `AGENTS.md` § "Generated audit docs". When code described here changes, a stale marker line is prepended above this block; nothing else in the file is ever modified by hand.

**Scope.** The externally callable HTTP surface of the kalaidoscope PocketBase server (single-tenant sidecar): every custom route, every hook that modifies PocketBase's built-in collection endpoints, auth posture, and shared wire/error conventions. This is a route index: each row states the request and response contract and points at the doc that describes the mechanics. PocketBase's generic surface (`/api/collections/*`, `/api/realtime`, `/api/files/*`, the `/_/` dashboard) is otherwise not documented.

**Completeness anchor.** 39 custom routes, registered at exactly two sites: `server/server.go` `RegisterRoutes` (37 routes) and `internal/ollama/handlers.go` `RegisterRoutes` (2 routes). 7 collection hooks, registered in `server/server.go` `RegisterTriggers` (3), `internal/ingest/batch.go` `RegisterHooks` (1), and `internal/config/hooks.go` `RegisterHooks` (3). One router-wide middleware (`se.Router.BindFunc` in `RegisterRoutes`).

---

## 1. Wire conventions

- JSON field names are **lowerCamelCase** throughout, with one exception: the `POST /api/ingest` body uses **snake_case** for its multi-word fields (`ingested_via`, `occurred_at`, `fragment_limit`, `skip_duplicates`).
- Declared DTOs live in `internal/api`. Where a handler binds an **anonymous struct** instead (create of projections and reflections, token resolution, discover kick), this document records the fields actually bound. Bodies are bound with PocketBase's `BindBody`; unknown fields are ignored everywhere.
- Errors raised through PocketBase helpers (`BadRequestError`, `NotFoundError`, `InternalServerError`, `ForbiddenError`, `e.Error(status, …)`) use PocketBase's standard envelope `{status, message, data}`. Domain-specific bodies (quota exhaustion, provider failures, config validation) are in § 13.
- Streaming routes commit `200` and headers before work begins; later failures are in-band (§ 13).
- **Every response** the router produces carries the header `X-Kalaido-Schema-Version: <schema.Version>` (`4` at this commit), set by a router-wide middleware; no request header is checked. The database's own state is reported by one route:

| Endpoint | Request | Behaviour & side effects | Response / errors |
|---|---|---|---|
| `GET /api/schema` | — | Reads the schema state table and the failed-upgrade marker file (`schema.md` § 1); nothing written | `200 {version, latest, failed: null \| {from, to, delta, error, backup, restored, at, binaryRev}, history: [{version, appliedAt, source, binaryRev}]}` (`version` `0` and `history` `null` before the state table exists); `500` |

- **No custom route requires authentication** and none reads the caller's identity except `PATCH` `pinned` (§ 5/6); see § 13.

## 2. Ingestion

| Endpoint | Request | Behaviour & side effects | Response / errors |
|---|---|---|---|
| `POST /api/ingest` | `{type?, ingested_via?, source?, content, occurred_at?, format?, fragment_limit?, extensions?, skip_duplicates?}` | One fragment written inline through the writer (`ingestion.md` § 2): `type` defaults to `note`, `ingested_via` to `sync`; `occurred_at` is parsed as RFC3339 and a malformed value is silently dropped (the create hook then stamps now, § 12); `skip_duplicates` makes a duplicate a no-op. `format`/`fragment_limit`/`extensions` are accepted and unused. The fragment birth hooks fire (§ 12). | `200 {fragmentId, ingested}` (`""`/`0` when deduped); `400` bad body / whitespace-only `content`; `500` write failure |

The batch path is the `ingest` collection's create endpoint (§ 12).

## 3. Context & tokens

| Endpoint | Request | Behaviour & side effects | Response / errors |
|---|---|---|---|
| `POST /api/context/tokens` | a `ContextSpec` (`context.md` § 1) plus `window? {start, end}` and `conversationId?` | **Spec form** (no `conversationId`): estimates `chars/4` per selector, each rendered as a fresh context (`context.md` § 4); whole scope is counted once in the requested mode; fragment-level pins (`fragmentIds`, `fragmentTypes`, `colourIds`) are counted only when `wholeScope` is empty or `summaries`; snapshot pins always. A window missing either bound is ignored. Resolution errors count as 0. `model`/`limit` are the chat role's default model and its prompt budget (`context.md` § 6); `fits` is `totalTokens ≤ limit`, always true when `limit` is 0. **Conversation form**: the next turn of that chat — system prompt, context, transcript — with the spec/window applied as a trailing pending system message, against the conversation's own model override (`chat.md` § 3); a conversation id with no row is estimated as an empty transcript. | `200 {totalTokens, breakdown, model, limit, fits}`; `breakdown` keys are `"WholeScope" \| "Fragment:<id>" \| "Type:<t>" \| "Colour:<id>" \| "Projection:<id>" \| "Reflection:<id>"` (spec form) or `"System" \| "Context" \| "Transcript"` (conversation form); `400` bad JSON; `500` estimate failure (conversation form only) |
| `GET /api/llm/preflight` | — | Per-role readiness without a model call: against the stored workspace config when a provider is set, else against the env-seeded model set (`models.md` § 4) | `200 {modelSet, ok, roles: [{role, model?, provider?, ok, detail?}]}` — never non-200 |
| `POST /api/llm/validate` | `{provider, apiKey?, defaultModel?, roleModels?}` | Live-tests every referenced model without saving (`models.md` § 4); empty `roleModels` values are dropped | `200 {ok: true}` or `200 {ok: false, detail, kind?, provider?, model?}`; `400` bad body / empty `provider` / no model |

## 4. Chat

| Endpoint | Request | Behaviour & side effects | Response / errors |
|---|---|---|---|
| `POST /api/chat` | `{id, messages: [UIMessage]}` | If `id` matches a `projection_refinement` or `reflection_refinement` `external_conversation_id` → the refinement turn (`refinement.md` § 3–4). Else general chat: finds or creates the `chat_conversation` (none when `id` is empty — the turn then streams unpersisted), persists the new messages, hydrates against the conversation's final context, resolves the chat role with the conversation's `generate_with_model` override, checks the prompt budget, streams one assistant turn; summaries mode loops read tools (`chat.md` § 4–5). | SSE (`chat.md` § 6). Before the stream: `400` bad body / empty hydrated transcript; `500` no chat model; `422` context too large (full mode appends the hint to switch the scope to Summaries); `402` quota (unreachable, § 13); provider envelope; `500` stream start. Refinement turns: `400`, `500` no refinement model, `422`, `402`, envelope, `500` likewise. |
| `PATCH /api/chat/conversations/{cid}/messages/{mid}/bookmark` | `{bookmarked}` | Sets `bookmarked` on the `chat_message` whose stored UIMessage id is `{mid}` (`chat.md` § 2). `{cid}` is a `chat_conversation` client id only: a refinement id or a chat that never sent a turn is not found. | `200 {messageId, bookmarked, fragmentId?}`; `400` missing ids / bad body; `404` conversation / message not persisted yet; `422` the row is a `system` message or undecodable; `500` |
| `POST /api/chat/conversations/{cid}/bookmarks/save` | — | In one transaction, every bookmarked non-system turn with text becomes a `fragment` (`type` `chat`, `ingested_via` `app`, `source` `chat:<cid>:<mid>`, `occurred_at` = the turn's `created`) and the row is stamped with `fragment_id`; a turn already stamped with a live fragment is reported, not recreated; a stamped fragment that was since soft-deleted is recreated. Detached from the request. Each created fragment fires the birth hooks (§ 12). | `200 {saved: [{messageId, fragmentId, created}]}` (`[]` when nothing was bookmarked); `400`; `404`; `500` |
| `POST /api/chat/conversations/{cid}/brief` | — | One Interactive-priority chat-role call over the conversation's turns (bookmarked ones marked) with a `propose_brief` tool (`prompts.md` § 2); the last tool call wins, else the reply text is the message with no name. Nothing is created or stored. | `200 {name, message}`; `400`; `404`; `402`; provider envelope; `422` context too large / no turns / model produced neither call nor text; `500` |

## 5. Projections

| Endpoint | Request | Behaviour & side effects | Response / errors |
|---|---|---|---|
| `POST /api/projections` | `{name, description?, windowSpec?}` (`windowSpec` → `400`) | Creates an `active` projection with `name` (unvalidated, empty allowed) and trimmed `description`; nothing else (`lifecycle-projection.md` § 2) | `201 {projectionId}`; `400` bad body; `500` |
| `PATCH /api/projections/{id}` | `{name?, pinned?, generateWithModel?, windowSpec?}` | Renames; sets/clears (trimmed, `""` clears) `generate_with_model`; `pinned` adds/removes `e.Auth.Id` in `pinned_by` and is silently skipped with no auth (`lifecycle-projection.md` § 7). `windowSpec` → `400`, checked after the entity lookup. | `200 {id}`; `400` bad body / `windowSpec`; `404` missing or soft-deleted; `500` |
| `DELETE /api/projections/{id}` | — | Soft delete: stamps `deleted_at`, scrubs the id from `sourceProjectionIds` of every live `current_context_spec` in `projection` and `reflection` (`lifecycle-projection.md` § 6); already-deleted → `204` no-op | `204`; `404` missing; `409` a live generation claim exists; `500` |
| `POST /api/projections/{id}/restore` | — | Clears `deleted_at`; scrubbed references are not restored; live entity → no-op | `200 {id}`; `404` missing; `500` |
| `POST /api/projections/{id}/candidates` | `{preview?}` (a malformed body is treated as empty; every other declared field is unread) | Refuses when the rotation evaluation lists `blockedBy`; generates one snapshot — `pending` if `preview`, else approved — under a claim row, joining an in-flight generation for up to the claim TTL instead of refusing (`lifecycle-projection.md` § 4). Detached from the request. | `200 {snapshotId}`; `404` missing or soft-deleted; `409` blocked by upstream / lens not ready / generation in flight (join abandoned and retry also in flight); `422` context too large; `402`; provider envelope; `500` |
| `POST /api/projections/{id}/candidates/{rid}/approve` | — | Promotes the candidate, discards its pending siblings, requests a wave (`lifecycle-projection.md` § 4.3); an already-approved row is a no-op | `200 {snapshotId}`; `404` unknown or foreign candidate; `422` not approvable (still generating, discarded, or empty output); `500` |
| `POST /api/projections/{id}/candidates/{rid}/edit` | `{oldText, newText}` | Replaces one exact passage of a `pending` candidate's output: writes an `edit` fragment, pins it on the parent's and the candidate's specs, appends a new pending snapshot (`lifecycle-projection.md` § 4). Detached from the request. | `200 {snapshotId, fragmentId}`; `400` bad body / empty `oldText`; `404` unknown or foreign candidate; `409` candidate not pending; `422` passage not replaceable as asked; `500` |

## 6. Reflections

| Endpoint | Request | Behaviour & side effects | Response / errors |
|---|---|---|---|
| `POST /api/reflections` | `{name, description?, windowSpec?}` | Creates `active` with version 1 of the schedule, effective from `startTime` when that is in the past, else now (`lifecycle-reflection.md` § 2, `windows.md` § 2); an empty spec is an unscheduled reflection | `201 {reflectionId}`; `400` bad body / invalid spec (`period` not a positive duration, `duration` not a positive duration, `startTime` not RFC3339); `500` |
| `PATCH /api/reflections/{id}` | `{name?, pinned?, generateWithModel?, windowSpec?}` | As projections, plus appends a schedule version effective now; an empty `startTime` inherits the governing version's (`lifecycle-reflection.md` § 3) | `200 {id}`; `400` bad body / invalid spec; `404`; `500` |
| `DELETE /api/reflections/{id}` | — | As projections, scrubbing `sourceReflectionIds` (`lifecycle-reflection.md` § 8) | `204`; `404`; `409`; `500` |
| `POST /api/reflections/{id}/restore` | — | As projections | `200 {id}`; `404`; `500` |
| `POST /api/reflections/{id}/generate-snapshot` | `{preview?, windowId?, all?}` | Selects windows: `windowId` names any materialised window; otherwise the pending, stale, and lens-outdated windows (all of them with `all`), or the current window when nothing is owed. Several windows generate concurrently; the response lists the successes and only logs failures when at least one window succeeded (`lifecycle-reflection.md` § 5). | `200 {snapshotIds}`; `400` unknown `windowId` / several candidates without `all`; `404`; `409`, `422`, `402`, envelope, `500` as projections (the first failure, when none succeeded) |
| `GET /api/reflections/{id}/windows` | — | The materialised series, oldest first, with status flags; `stale` from the rotation evaluation (silently all-false if it fails), `lensOutdated` when the approved snapshot's lens differs from `current_lens_id` (`lifecycle-reflection.md` § 9, `windows.md` § 6) | `200 {windows: [{id, start, end, key, hasApproved, generating, backfilled, stale?, lensOutdated?}], currentWindowId?}`; `404` |
| `POST /api/reflections/{id}/backfill` | `{from}` RFC3339 | Materialises `reflection_window` rows between `from` and the grid's lower bound, then generates every pending window in the background at Background priority (`lifecycle-reflection.md` § 9) | `200 {windows: [{id, start, end}]}` (`null` when nothing new was materialised); `400` bad body / not RFC3339 / `from` not before the covered range; `404`; `500` unscheduled or period-less |

There is no reflection approve or edit route (`lifecycle-reflection.md` § 6).

## 7. Refinements

| Endpoint | Request | Behaviour & side effects | Response / errors |
|---|---|---|---|
| `POST /api/projections/{id}/refinements` | `{clientId, snapshotId?, contextSpec?}` | Opens a session; seeds one system message with `context_spec` (explicit spec, else the snapshot's) and its resolved `pinned_ids` (`refinement.md` § 2) | `201 {refinementId, messages?}`; `400` bad body / missing `clientId`; `500` (also for a missing or soft-deleted projection, or an unknown `snapshotId`) |
| `POST /api/reflections/{id}/refinements` | `{clientId, window?, contextSpec?}` (`snapshotId` ignored) | Opens a session bound to `window` (else the reflection's current window); seeds context (explicit, else the reflection's `current_context_spec`), the `window` part, and — when the reflection has a lens — an assistant turn replaying the current lens paired with the window's approved output (`refinement.md` § 2) | as above (`500` for a missing or soft-deleted reflection) |
| `POST /api/projections/{id}/refinements/{rid}/commit` | — | Reads the newest drafted lens and its same-message preview off the transcript; creates the lens row, appends and approves a snapshot, re-points the parent, requests a wave (`refinement.md` § 5). Detached from the request. | `200 {snapshotId}`; `404` refinement; `400` no drafted lens / no parent / `{id}` differs from the parent; `409` latest lens has no generated preview; `500` (also for a soft-deleted parent) |
| `POST /api/reflections/{id}/refinements/{rid}/commit` | — | Creates the lens, re-points the parent, requests a wave, starts pending-window generation in the background; publishes no snapshot | `200 {snapshotId: ""}`; errors as above |

Turns within a session go through `POST /api/chat` (§ 4).

## 8. Colours

| Endpoint | Request | Behaviour & side effects | Response / errors |
|---|---|---|---|
| `POST /api/colours/preview` | `{prompt, positiveExamples?, negativeExamples?}` (example values are fragment ids; unknown ids are silently dropped) | Judges the 20 newest live fragments concurrently at Interactive priority; streams each match as it lands (`colours.md` § 5). An empty `prompt` is accepted. Per-fragment call failures — including quota exhaustion — are logged and skipped, never surfaced; zero fragments is an empty stream. | `200` SSE, `data: <fragment record JSON>` per match; `400` bad body; `500` fragment query / no colour model / streaming unsupported |
| `POST /api/colours` | `{name, prompt?, fragmentIds?, positiveExamples?, negativeExamples?}` | Creates with the next swatch; seeds `prompt` match rows from `fragmentIds` (failures logged only); writes manual example rows (negatives, then positives); signals the worker when the trimmed prompt is non-empty; requests a wave (`colours.md` § 5) | `200 {colourId}`; `400` bad body / whitespace-only `name`; `500` |
| `PATCH /api/colours/{id}` | `{name?, prompt?, positiveExamples?, negativeExamples?, clearExamples?}` | Writes/clears example rows first; renames unless the new name is whitespace-only; a changed trimmed prompt restarts matching (drops prompt rows and watermark, recomputes thing rows, signals) and requests a wave | `200 {colourId, name, prompt}`; `400` missing id / bad body; `404`; `500` |
| `DELETE /api/colours/{id}` | — | Scrubs the id from `colourIds` of every live `current_context_spec` in `projection` and `reflection`; deletes the row (links cascade) (`colours.md` § 6) | `204`; `404`; `500` |
| `POST /api/colours/{id}/rematch` | — | Drops prompt rows and watermark; recomputes thing rows; signals the worker; requests a wave (`colours.md` § 4) | `202`; `404`; `500` |

## 9. Rotation, organize, reconcile, map & discover

| Endpoint | Request | Behaviour & side effects | Response / errors |
|---|---|---|---|
| `GET /api/rotation` | — | Full staleness evaluation (`rotation.md` § 1–2) | `200 {statuses: [EntityStatus]}`; `500` |
| `GET /api/organize` | — | Derived organise status: counts from rows plus the workers' in-flight flags; kicks nothing (`organize.md` § 1). Creates the `kalaidoscope_map` singleton (version 0) as a side effect of loading it when none exists. | `200 {fragments, imports, map, discover, policy, reconcile}` (`organize.md` § 1); `500` |
| `POST /api/reconcile` | — | Starts a wave now: cancels any pending automatic debounce and signals the worker directly, regardless of `KALAIDO_AUTO_WAVE` (`rotation.md` § 3); signals coalesce through a one-slot channel — at most one further wave is queued behind a running one, further signals are dropped | `202` |
| `POST /api/map` | — | Signals the annotate worker for a full drain followed by one settle cycle (`map.md` § 5) | `202` |
| `POST /api/discover` | `{kind}` | Marks the kind pending and wakes the discover worker; kinds are `colours`, `projections`, `reflections` (`discover.md` § 2) | `202`; `400` bad body / unknown kind |

## 10. LLM provider

Covered in § 3 (`/api/llm/preflight`, `/api/llm/validate`); configuration itself is written through the `kalaidoscope_config` collection endpoint (§ 12).

## 11. Ollama

| Endpoint | Request | Behaviour & side effects | Response / errors |
|---|---|---|---|
| `GET /api/ollama/status` | — | Lists local models (5 s timeout) (`models.md` § 7) | `200 {reachable, models: [{name, size}], error?}` — never non-200 |
| `POST /api/ollama/pull` | `{model}` | Streams pull progress, bound to the request context (`models.md` § 7) | `200` NDJSON `{status, completed, total}`… then `{status: "success", done: true}` or `{error}`; `400` bad body / empty `model` |

## 12. Hook-modified collection endpoints

| Collection & operation | Hook | Effect |
|---|---|---|
| `fragment` create (any path) | `OnRecordCreate` | `occurred_at` defaults to now; `ingested_via` defaults to `app` |
| `fragment` create (any path) | `OnRecordAfterCreateSuccess` | Signals the colour worker; unless `ingested_via = import`, also signals the annotate worker (annotate only, no settle cycle) and requests a wave (`ingestion.md` § 7) |
| `fragment` delete (REST) | `OnRecordDeleteRequest` | **Soft delete**: sets `deleted_at` (idempotent), returns `204`, row kept (`ingestion.md` § 7). The collection's delete rule is superuser-only, so PocketBase rejects a non-superuser request with `403` before this hook runs. |
| `ingest` create | `OnRecordCreate` | Reads the uploaded files and `format`/`fragment_limit`/`extensions`/`skip_duplicates`/`organize_after`, forces `status = pending`, then processes in a detached goroutine that writes `ingested`, `status` (`done`/`error`), `error`, requests a wave when anything was written, and hands off to the organise pipeline or the annotate worker (`ingestion.md` § 3, `organize.md` § 8) |
| `kalaidoscope_config` update (REST) | `OnRecordUpdateRequest` | `403` if the body contains `model_set` without superuser auth |
| `kalaidoscope_config` read (REST & realtime) | `OnRecordEnrich` | `api_key` is hidden from every response without superuser auth |
| `kalaidoscope_config` update (any path) | `OnRecordUpdate` | Requires a model when a provider is set; live-validates changed models for credentialed providers when `api_key` is non-empty (all models when provider or key changed); after the write commits, republishes the config and reconfigures the scheduler (`models.md` § 3) |

Every other collection endpoint behaves as PocketBase defines it, subject to the rules in `schema.md` § 2.

## 13. Cross-cutting

**Auth posture.** Every canonical collection's list/view rule is `@request.auth.id != ''`, except `lens`, whose list/view rules are nil (superuser-only). Create/update/delete rules are nil (superuser-only) on every collection except `ingest` (create open to the authenticated user; update/delete superuser-only) and `kalaidoscope_config` (update open; create/delete superuser-only). The sidecar seeds one `users` record and prints its token at boot (`boot-and-workers.md` § 1); no superuser is ever created by the binary. Custom routes register **no** auth middleware: any caller reaching the port may generate, commit, delete, or ingest. `PATCH` `pinned` is the only custom-route behaviour that reads `e.Auth`, and it is silently skipped when absent.

**Quota exhaustion.** `402 {error: "quota_exhausted", period, used}` — emitted by chat, brief, refinement, and generation paths when `usage.ErrExhausted` is returned; no authorizer is installed in this binary (`quota.Set` is never called), so it never is (`llm-queue-quota.md` § 5). The colour preview swallows it per fragment.

**Provider failures.** A classified `ProviderError` becomes `{error, kind, provider, model, detail}` with status `409` (`provider_auth_failed`, kind `auth`), `429` (`provider_quota_exceeded`, kind `quota`), `502` (`provider_transient`, kind `transient`; `provider_error`, kind `other`) — `llm-queue-quota.md` § 6. Ollama failures are classified too: a connection failure is `transient`, a non-200 reply by its status.

**Context too large.** `422` with the guard's message (`context.md` § 6) from chat, brief, refinement turns, and generation; inside an open stream, as a `{type: "error", errorText}` stream part (summaries rounds) or a `data-refine_error {kind: context_too_large, message}` part (the refinement apply leg, `refinement.md` § 3; the same part carries `kind` `quota_exhausted` or `apply_failed` for the other apply failures).

**Validation payloads.** Config-hook rejections are `400` with PocketBase validation data keyed on `default_model` (`model_required`) or `api_key` (`provider_<kind>` / `provider_validation_failed`).

**Detached work.** Generation, edit, commit, and bookmark save run under `context.WithoutCancel`; a client disconnect does not stop them. Discover, map, and reconcile return `202` before any work; backfill materialises its `reflection_window` rows and rematch rewrites its membership rows inline, then return (`200`/`202`) before any model call; progress is visible only through collection changes over `/api/realtime`, the `llm_queue_status` row, and `GET /api/organize`. The colour preview and the Ollama pull are bound to the request context and stop when the client disconnects.
