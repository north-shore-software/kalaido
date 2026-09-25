> **STALE** — code has changed since this document was generated.

# Kalaidoscope HTTP API — Generated Audit Snapshot

> **Generated:** 2026-09-23, from source at commit `bdd0b9a`.
> This file is a generated audit snapshot — do not edit it. See `AGENTS.md` § "Generated audit docs". When code described here changes, a stale marker line is prepended above this block; nothing else in the file is ever modified by hand.

**Scope.** The externally callable HTTP surface of the kalaidoscope PocketBase server (single-tenant sidecar): every custom route, every hook that modifies PocketBase's built-in collection endpoints, auth posture, and shared wire/error conventions. This is a route index: each row states the request and response contract and points at the doc that describes the mechanics. The aggregate status route (§ 9) is indexed as a composition of per-domain axes, each described in its owning doc (`ingestion.md`, `map.md`, `discover.md`, `colours.md`, `reconcile.md`). PocketBase's generic surface (`/api/collections/*`, `/api/realtime`, `/api/files/*`, the `/_/` dashboard) is otherwise not documented.

**Completeness anchor.** 43 custom routes, registered at exactly two sites: `server/server.go` `RegisterRoutes` (41 routes) and `llm/providers/ollama/handlers.go` `RegisterRoutes` (2 routes). 7 collection hooks, registered in `server/server.go` `RegisterTriggers` (3), `internal/ingest/batch.go` `RegisterHooks` (1), and `internal/config/hooks.go` `RegisterHooks` (3). One router-wide middleware (`se.Router.BindFunc` in `RegisterRoutes`).

---

## 1. Wire conventions

- JSON field names are **lowerCamelCase** throughout. `POST /api/ingest` additionally accepts the retired **snake_case** spellings of its multi-word fields (`ingested_via`, `occurred_at`, `fragment_limit`, `skip_duplicates`) through a custom unmarshaller; when a body carries both spellings the lowerCamelCase one wins. `POST /api/reflections/{id}/snapshots` likewise accepts the legacy `all` key for `allWindows`.
- Declared DTOs live in `internal/api`; every handler binds a declared DTO this generation (no anonymous request structs). Bodies are bound with PocketBase's `BindBody`; unknown fields are ignored everywhere, and declared fields a handler never reads are called out per row.
- Errors raised through PocketBase helpers (`BadRequestError`, `NotFoundError`, `InternalServerError`, `ForbiddenError`, `e.Error(status, …)`) use PocketBase's standard envelope `{status, message, data}`. Domain-specific bodies (quota exhaustion, provider failures, config validation) are in § 13.
- Streaming routes commit `200` and headers before work begins; later failures are in-band (§ 13) or silent.
- **Every response** the router produces carries the header `X-Kalaido-Schema-Version: <schema.Version>` (`4` at this commit), set by a router-wide middleware; no request header is checked. The database's own state is reported by one route:

| Endpoint | Request | Behaviour & side effects | Response / errors |
|---|---|---|---|
| `GET /api/schema` | — | Reads the `_kalaido_schema` state table and the failed-upgrade marker file (`schema.md` § 1); nothing written | `200 {version, latest, failed: null \| {from, to, delta, error, backup, restored, at, binaryRev}, history: [{version, appliedAt, source, binaryRev}]}` (`version` `0` and `history` `null` before the state table exists); `500` |

- **No custom route requires authentication** and none reads the caller's identity except `PATCH` `pinned` (§ 5/6); see § 13.

## 2. Ingestion

| Endpoint | Request | Behaviour & side effects | Response / errors |
|---|---|---|---|
| `POST /api/ingest` | `{type?, ingestedVia?, source?, content, occurredAt?, skipDuplicates?, format?, fragmentLimit?, extensions?}` | One fragment written inline through the writer (`ingestion.md` § 2, § 6): trimmed `type` defaults to `note`, trimmed `ingestedVia` to `sync`; `occurredAt` is parsed as RFC3339 and a malformed value is silently dropped (the create hook then stamps now, § 12); `skipDuplicates` loads every existing fragment's content hash and makes a duplicate a no-op. The fragment birth hooks fire (§ 12). | `200 {fragmentId, ingested}` (`""`/`0` when deduped); `400` bad body / whitespace-only `content` / any of `format`, `fragmentLimit`, `extensions` set (they apply to file ingest only); `500` write failure |

The batch path is the `ingest` collection's create endpoint (§ 12).

## 3. Context & tokens

| Endpoint | Request | Behaviour & side effects | Response / errors |
|---|---|---|---|
| `POST /api/llm/count-tokens` | a `ContextSpec` (`context.md` § 1) plus `window? {start, end}` and `conversationId?` | **Spec form** (no `conversationId`): estimates `chars/4` per selector, each rendered as a fresh context (`context.md` § 4); whole scope is counted once in the requested mode; fragment-level pins (`fragmentIds`, `fragmentTypes`, `colourIds`) are counted only when `wholeScope` is empty or `summaries`; snapshot pins always. A window missing either bound is ignored. Resolution errors count as 0. `model`/`limit` are the chat role's default model and its prompt budget (context window less an eighth; 0 when the provider reports none — `context.md` § 6); `fits` is `totalTokens ≤ limit`, always true when `limit` is 0. **Conversation form**: the next turn of that explore conversation — system prompt, context, transcript — with the spec/window applied as a trailing pending system message, against the conversation's own `generate_with_model` override (`explore.md` § 9); a conversation id with no row is estimated as an empty transcript. Nothing is written. | `200 {totalTokens, breakdown, model, limit, fits}`; `breakdown` keys are `"WholeScope" \| "Fragment:<id>" \| "Type:<t>" \| "Colour:<id>" \| "Projection:<id>" \| "Reflection:<id>"` (spec form) or `"System" \| "Context" \| "Transcript"` (conversation form); `400` bad JSON; `500` estimate failure (conversation form only) |
| `GET /api/llm/preflight` | — | Per-role readiness without a model call: against the stored workspace config when a provider is set, else against the env-seeded model set (`models.md` § 4) | `200 {modelSet, ok, roles: [{role, model?, provider?, ok, detail?}]}` — never non-200 |
| `POST /api/llm/validate` | `{provider, apiKey?, defaultModel?, roleModels?}` | Live-tests every referenced model concurrently without saving (`models.md` § 4); empty `roleModels` values are dropped | `200 {ok: true}` or `200 {ok: false, detail, kind?, provider?, model?}`; `400` bad body / empty `provider` / no model |

## 4. Explore

| Endpoint | Request | Behaviour & side effects | Response / errors |
|---|---|---|---|
| `POST /api/explore` | `{id, messages: [UIMessage]}` | One explore turn (`explore.md` § 1–5): finds or creates the `chat_conversation` whose `external_conversation_id` is `id` (none when `id` is empty, or when the lookup/create fails — the turn then streams unpersisted, failure logged), persists the new messages, hydrates against the conversation's final context, resolves the chat role with the conversation's `generate_with_model` override (re-read every turn), checks the prompt budget, streams one assistant turn; summaries mode loops read tools (`explore.md` § 5, `tool-loop.md`). Refinement ids are **not** routed here (§ 7). | SSE (`explore.md` § 6). Before the stream: `400` bad body / empty hydrated transcript; `500` no chat model; `422` prompt too large (full mode appends the hint to switch the scope to Summaries); `402` quota (unreachable, § 13); provider envelope; `500` stream start / map load (summaries). In-band, summaries rounds only: `{type: "error", errorText}`; a full-mode stream that fails mid-turn ends its text and finishes normally. |
| `PATCH /api/explore/conversations/{cid}/messages/{mid}/bookmark` | `{bookmarked}` | Sets `bookmarked` on the `chat_message` whose stored UIMessage id is `{mid}` (`explore.md` § 7). `{cid}` is a `chat_conversation` client id only: a refinement id, or an explore chat that never sent a turn, is not found. | `200 {messageId, bookmarked, fragmentId?}`; `400` missing ids / bad body; `404` conversation / message not persisted yet; `422` the row is a `system` message or undecodable; `500` |
| `POST /api/explore/conversations/{cid}/bookmarks/save` | — | In one transaction, every bookmarked non-system turn with text becomes a `fragment` (`type` `chat`, `ingested_via` `app`, `source` `explore:<cid>:<mid>`, `occurred_at` = the row's `created`) and the row is stamped with `fragment_id`; a turn already stamped with a live fragment is reported with `created: false`, not recreated; a stamped fragment that was since soft-deleted is recreated; tool-only turns are skipped. Detached from the request. Each created fragment fires the birth hooks (§ 12). | `200 {saved: [{messageId, fragmentId, created}]}` (`[]` when nothing was bookmarked); `400`; `404`; `500` |
| `POST /api/explore/conversations/{cid}/brief` | — | One Interactive-priority chat-role call (conversation override honoured) over the conversation's text turns (bookmarked ones marked) with a `propose_brief` tool (`prompts.md` § 3, `explore.md` § 8); the last tool call wins, else the reply text is the message with no name. Prompt-budget checked first. Nothing is created or stored. | `200 {name, message}`; `400`; `404`; `402`; provider envelope; `422` context too large / no text turns / model produced neither call nor text; `500` (also no chat model) |

## 5. Projections

| Endpoint | Request | Behaviour & side effects | Response / errors |
|---|---|---|---|
| `POST /api/projections` | `{name, description?}` | Creates an `active` projection with `name` (unvalidated, empty allowed) and trimmed `description` (omitted when blank); nothing else (`lifecycle-projection.md` § 2). Any `windowSpec` is silently ignored. | `201 {projectionId}`; `400` bad body; `500` |
| `PATCH /api/projections/{id}` | `{name?, pinned?, generateWithModel?}` | Renames; sets/clears (trimmed, `""` clears) `generate_with_model`; `pinned` adds/removes `e.Auth.Id` in `pinned_by` and is silently skipped with no auth (`lifecycle-projection.md` § 7). A `windowSpec` key is silently ignored. | `200 {id}`; `400` bad body; `404` missing or soft-deleted; `500` |
| `DELETE /api/projections/{id}` | — | Soft delete: stamps `deleted_at`, scrubs the id from `sourceProjectionIds` of every live `current_context_spec` in `projection` and `reflection`, in one transaction (`lifecycle-projection.md` § 6); already-deleted → `204` no-op | `204`; `404` missing; `409` a live generation claim exists (a `generating` snapshot younger than 10 min); `500` |
| `POST /api/projections/{id}/restore` | — | Clears `deleted_at`; scrubbed references are not restored; live entity → no-op | `200 {id}`; `404` missing; `500` |
| `POST /api/projections/{id}/candidates` and `POST /api/projections/{id}/snapshots` (same handler) | `{preview?}` (`sourceId`, `chatId`, `fragmentIds`, `colourIds`, `messages` are bound and unread) | Refuses when the staleness evaluation lists `blockedBy` (an evaluation failure is logged and ignored); cancels a running reconcile wave unless that wave is producing this very entity (`coordination.md`); generates one snapshot — `pending_review` if `preview`, else approved — under a claim row, joining an in-flight generation for up to the claim TTL instead of refusing, and regenerating if the joined run ends without output (`lifecycle-projection.md` § 4). Generation is detached from the request; only the wait to join is bounded by it. Requests a wave afterwards when an approved snapshot was produced or a wave was cut short. | `200 {snapshotId}`; `400` bad body; `404` missing or soft-deleted; `409` blocked by upstream / lens not ready / generation in flight (join abandoned and retry also in flight); `422` context too large; `402`; provider envelope; `500` |
| `POST /api/projections/{id}/candidates/{rid}/approve` | — | Promotes the candidate (next `approval_sequence_number`, `approved_at`, `status` `approved`), discards its pending siblings, requests a wave (`lifecycle-projection.md` § 4); an already-approved row is a no-op | `200 {snapshotId}`; `400` missing ids; `404` unknown or foreign candidate; `422` not approvable (still generating, discarded, or whitespace-only output); `500` |
| `POST /api/projections/{id}/candidates/{rid}/edit` | `{oldText, newText}` | Replaces one exact passage of a `pending_review` candidate's output in one transaction: writes an `edit` fragment (`ingested_via` `app`, `occurred_at` now), pins it on the parent's and the candidate's specs, appends a new pending snapshot (`lifecycle-projection.md` § 4). Detached from the request. The fragment birth hooks fire (§ 12). | `200 {snapshotId, fragmentId}`; `400` bad body / empty `oldText`; `404` unknown or foreign candidate; `409` candidate not pending; `422` passage not found, ambiguous, unchanged, or would empty the candidate; `500` (also for a soft-deleted parent) |

## 6. Reflections

| Endpoint | Request | Behaviour & side effects | Response / errors |
|---|---|---|---|
| `POST /api/reflections` | `{name, description?, windowSpec?}` | Creates `active` with version 1 of the schedule, effective from `startTime` when that is in the past, else now (`lifecycle-reflection.md` § 2, `windows.md` § 2); an absent or empty spec is an unscheduled reflection | `201 {reflectionId}`; `400` bad body / invalid spec (`period` not a positive duration, `duration` set but not a positive duration, `startTime` set but not RFC3339); `500` |
| `PATCH /api/reflections/{id}` | `{name?, pinned?, generateWithModel?, windowSpec?}` | As projections, plus appends a schedule version effective now; an empty `startTime` inherits the governing version's (`lifecycle-reflection.md` § 3) | `200 {id}`; `400` bad body / invalid spec; `404` missing or soft-deleted; `500` |
| `DELETE /api/reflections/{id}` | — | As projections, scrubbing `sourceReflectionIds` (`lifecycle-reflection.md` § 8) | `204`; `404`; `409`; `500` |
| `POST /api/reflections/{id}/restore` | — | As projections | `200 {id}`; `404`; `500` |
| `POST /api/reflections/{id}/generate-snapshot` and `POST /api/reflections/{id}/snapshots` (same handler) | `{preview?, windowId?, allWindows?}` (`all` accepted as an alias of `allWindows`; `sourceId`, `chatId`, `fragmentIds`, `colourIds`, `messages` bound and unread) | Refuses on `blockedBy` and cancels a foreign wave as projections. Selects windows: `windowId` names any window of the series; otherwise the candidates are the windows with no approved snapshot and no generation in flight, those whose approved snapshot's lens differs from `current_lens_id`, and the evaluator's stale windows — one candidate or `allWindows` generates them, several without `allWindows` is refused, none at all falls back to the default (current) window (`windows.md` § 7). One window generates through the join path; several generate concurrently, one goroutine each, without joining (`lifecycle-reflection.md` § 5). The response lists the successes; failures are only logged when at least one window succeeded. Detached as projections. | `200 {snapshotIds}`; `400` bad body / both `windowId` and `allWindows` / unknown `windowId` / several candidates without `allWindows`; `404`; `409` blocked by upstream; on total failure the first error as projections (`409`, `422`, `402`, envelope, `500`) |
| `GET /api/reflections/{id}/windows` | — | The series, oldest first, with status flags: grid windows, backfilled `reflection_window` rows, and windows named by an approved or generating snapshot; `stale` from the staleness evaluation (silently all-false if it fails), `lensOutdated` when the newest approved snapshot's lens differs from `current_lens_id` (`lifecycle-reflection.md` § 9, `windows.md` § 6) | `200 {windows: [{id, start, end, key, hasApproved, generating, backfilled, stale?, lensOutdated?}], currentWindowId?}` (`currentWindowId` absent for an unscheduled reflection); `400` missing id; `404` missing or soft-deleted |
| `POST /api/reflections/{id}/backfill` | `{from}` RFC3339 | Materialises `reflection_window` rows between `from` and the grid's lower bound (an already-materialised window is tolerated), then hands every pending window of the reflection to the background runner at Background priority as approved snapshots (`lifecycle-reflection.md` § 9) | `200 {windows: [{id, start, end}]}` (`null` when nothing new was materialised); `400` bad body / not RFC3339 / `from` not before the covered range; `404`; `500` unscheduled or period-less |

There is no reflection approve or edit route (`lifecycle-reflection.md` § 6).

## 7. Refinements

| Endpoint | Request | Behaviour & side effects | Response / errors |
|---|---|---|---|
| `POST /api/projections/{id}/refinements` | `{clientId, snapshotId?, contextSpec?}` | Opens a session in one transaction; seeds one system message with `context_spec` (explicit spec, else the snapshot's) and its resolved `pinned_ids` — no message when neither yields a spec (`refinement.md` § 2) | `201 {refinementId, messages?}`; `400` missing target id / bad body / missing `clientId`; `500` (also for a missing or soft-deleted projection, or an unknown `snapshotId`) |
| `POST /api/reflections/{id}/refinements` | `{clientId, window?, contextSpec?}` | Opens a session bound to `window` when both bounds are given (else the reflection's default window); seeds context (explicit, else the reflection's `current_context_spec`), the `window` part, `pinned_ids` resolved inside that window, and — when the reflection has a lens with a non-empty prompt — an assistant turn replaying the current lens paired with the window's newest approved output (`refinement.md` § 2) | as above (`500` for a missing or soft-deleted reflection) |
| `POST /api/projections/{id}/refinements/{rid}/chat` and `POST /api/reflections/{id}/refinements/{rid}/chat` | `{id?, messages: [UIMessage]}` (`id` defaults to the refinement's `external_conversation_id` and is otherwise unused) | One drafting turn of the refinement conversation (`refinement.md` § 3): persists the new messages, hydrates, resolves the refinement role with the parent's `generate_with_model`, checks the prompt budget, streams the turn with the `update_lens` and `suggest_name` tools, then runs the from-scratch preview leg for a newly drafted lens. A send carrying only a new `window` part runs the window re-apply leg instead (`refinement.md` § 4). | SSE (`explore.md` § 6 shape). Before the stream: `400` missing ids / refinement not belonging to `{id}` (including a soft-deleted parent) / bad body / empty transcript; `404` refinement; `500` no refinement model; `422` prompt too large; `402`; provider envelope; `500` stream start. In-band: `data-refine_error {kind: apply_failed \| quota_exhausted \| context_too_large, message}` when the preview leg fails, `data-refine_lint {match}` when the lens pins a count. |
| `POST /api/projections/{id}/refinements/{rid}/commit` | — | Reads the newest drafted lens and its same-message preview off the transcript; in one transaction creates the lens row, appends and approves a snapshot, re-points the parent's `current_lens_id`/`current_context_spec`; then requests a wave (`refinement.md` § 5). Detached from the request. | `200 {snapshotId}`; `400` missing `{rid}`; `404` refinement; `400` no drafted lens / no parent / `{id}` differs from the parent; `409` latest lens has no generated preview; `500` (also for a soft-deleted parent) |
| `POST /api/reflections/{id}/refinements/{rid}/commit` | — | Creates the lens, re-points the parent, requests a wave, hands pending-window generation to the background runner; publishes no snapshot | `200 {snapshotId: ""}`; errors as above |

## 8. Colours

| Endpoint | Request | Behaviour & side effects | Response / errors |
|---|---|---|---|
| `POST /api/colours/preview` | `{prompt, positiveExamples?, negativeExamples?}` (example values are fragment ids; unknown ids are silently dropped) | Judges the 20 newest live fragments, up to 20 at a time, at Interactive priority; streams each match as it lands (`colours.md` § 5). An empty `prompt` is accepted. Per-fragment call failures — including quota exhaustion — are logged and skipped, never surfaced; zero fragments is an empty stream. Bound to the request context. | `200` SSE, `data: <fragment record JSON>` per match; `400` bad body; `500` fragment query / no colour model / streaming unsupported |
| `POST /api/colours` | `{name, prompt?, fragmentIds?, positiveExamples?, negativeExamples?}` | Creates with the next swatch and trimmed `prompt`; seeds `prompt` match rows from `fragmentIds` (failures logged only); writes manual example rows (negatives, then positives); signals the colour worker when the stored prompt is non-empty; requests a wave (`colours.md` § 5) | `200 {colourId}`; `400` bad body / whitespace-only `name`; `500` |
| `PATCH /api/colours/{id}` | `{name?, prompt?, positiveExamples?, negativeExamples?, clearExamples?}` | Writes/clears example rows first; renames unless the new name is whitespace-only; a changed trimmed prompt restarts matching (drops prompt rows, clears `prompt_match_completed_up_to_fragment_id`, recomputes thing rows, signals) and requests a wave (`colours.md` § 4) | `200 {colourId, name, prompt}`; `400` missing id / bad body; `404`; `500` |
| `DELETE /api/colours/{id}` | — | In one transaction scrubs the id from `colourIds` of every live `current_context_spec` in `projection` and `reflection`, then deletes the row (`colour_fragment` links cascade) (`colours.md` § 6) | `204`; `400` missing id; `404`; `500` |
| `POST /api/colours/{id}/rematch` | — | Drops prompt rows and the watermark; recomputes thing rows; signals the worker; requests a wave (`colours.md` § 4) — the row rewrites happen inline, before the response | `202`; `400` missing id; `404`; `500` |

## 9. Status, reconcile, map & discover

| Endpoint | Request | Behaviour & side effects | Response / errors |
|---|---|---|---|
| `GET /api/status` | — | The aggregate status, composed from per-domain axes evaluated in sequence; any axis failing fails the route. Kicks nothing and writes nothing (a missing `kalaidoscope_map` row reads as an empty document at version 0). | `200 {fragments, imports, map, discover, policy, reconcile, colour}` — see below; `500` |
| `GET /api/reconcile` | — | Full staleness evaluation over every live entity plus the wave worker's in-process state (`reconcile.md` § 1–2, § 5) | `200 {running, lastStarted?, lastError?, lastCompleted?, lastCancelled?, currentEntity? {id, type}, progress? {completed, total}, statuses: [{id, type, upToDateSnapshotId?, newFragmentIds?, staleDependencies?, blockedBy?, pendingWindows?, staleWindows?}]}`; `500` |
| `POST /api/reconcile` | — | Starts a wave now: stops any pending automatic debounce and signals the worker directly, regardless of `KALAIDO_AUTO_WAVE` (`reconcile.md` § 4); signals coalesce through a one-slot channel — at most one further wave is queued behind a running one, further signals are dropped | `202` |
| `POST /api/map` | — | Signals the map worker for an annotate drain followed by one settle cycle (`map.md` § 5) | `202` |
| `POST /api/discover` | `{kind}` | Marks the kind pending and wakes the discover worker; kinds are `colours`, `projections`, `reflections` (`discover.md` § 2) | `202`; `400` bad body / unknown kind |

**Composition of `GET /api/status`.** Each axis is produced by its owning package's status evaluator; the rule that selects each state lives in the owning doc.

| Key | Shape | Owning doc |
|---|---|---|
| `fragments` | count of `fragment` rows with empty `deleted_at` | — |
| `imports` | `{pending, lastError?}` from `ingest` rows | `ingestion.md`, the imports status axis |
| `map` | `{state: empty \| unannotated \| annotating \| consolidating \| folding \| settled, version, annotated, pendingAnnotation, unconsolidated, lastRun? {id, status, error?, model?, finished, interrupted?}, lastDrainError?, wantSettle, thingsCount}` | `map.md`, the map status axis |
| `discover` | `{state: never_run \| pending \| running \| due \| settled, running?, pending, due, runs: {<kind>: {id, status, error?, model?, rounds?, mapVersion?, finished, interrupted?}}, proposals: {projections, reflections}, waitingOnMap, currentStarted?}` | `discover.md`, the discover status axis |
| `colour` | `{draining, currentColourId?, lastStarted?, lastCompleted?, lastError?, promptColoursCount, totalColoursCount, unjudgedFragments}` | `colours.md`, the colour status axis |
| `reconcile` | the same object `GET /api/reconcile` publishes minus `statuses` | `reconcile.md` § 5 |
| `policy` | `{wave}` — whether automatic waves are on (`KALAIDO_AUTO_WAVE`) | `reconcile.md` § 4 |

## 10. LLM provider

Covered in § 3 (`/api/llm/preflight`, `/api/llm/validate`, `/api/llm/count-tokens`); configuration itself is written through the `kalaidoscope_config` collection endpoint (§ 12).

## 11. Ollama

| Endpoint | Request | Behaviour & side effects | Response / errors |
|---|---|---|---|
| `GET /api/ollama/status` | — | Lists local models (5 s timeout) (`models.md` § 7) | `200 {reachable, models: [{name, size}], error?}` — never non-200 (`models` is `[]` when unreachable) |
| `POST /api/ollama/pull` | `{model}` | Streams pull progress, bound to the request context (`models.md` § 7) | `200` NDJSON `{status, completed, total}`… then `{status: "success", done: true}` or `{error}`; `400` bad body / empty `model` |

## 12. Hook-modified collection endpoints

| Collection & operation | Hook | Effect |
|---|---|---|
| `fragment` create (any path) | `OnRecordCreate` | `occurred_at` defaults to now; `ingested_via` defaults to `app` |
| `fragment` create (any path) | `OnRecordAfterCreateSuccess` | Signals the colour worker; unless `ingested_via = import`, also signals the map worker for an annotate drain only (no settle cycle) and requests a wave (`ingestion.md` § 7) |
| `fragment` delete (REST) | `OnRecordDeleteRequest` | **Soft delete**: sets `deleted_at` (idempotent), returns `204`, row kept (`ingestion.md` § 7). The collection's delete rule is superuser-only, so PocketBase rejects a non-superuser request with `403` before this hook runs. |
| `ingest` create | `OnRecordCreate` | Reads the uploaded `file`s (a read failure is logged and the files read so far are used) and `format`/`fragment_limit`/`extensions`/`skip_duplicates`/`organize_after`, forces `status = pending`, writes the row, then processes on the background runner: files in order, stopping at the first failure; writes `ingested`, `status` (`done`/`error`), `error`; requests a wave when anything was written; then either starts the post-import pipeline (`organize_after`: a full map cycle, and once that drain succeeds a discover signal for `colours`, `projections`, `reflections`) or signals an annotate drain only (`ingestion.md` § 3–4) |
| `kalaidoscope_config` update (REST) | `OnRecordUpdateRequest` | `403` if the body contains `model_set` without superuser auth |
| `kalaidoscope_config` read (REST & realtime) | `OnRecordEnrich` | `api_key` is hidden from every response without superuser auth |
| `kalaidoscope_config` update (any path) | `OnRecordUpdate` | When a provider is set: requires a model; for credentialed providers with a non-empty `api_key`, live-validates the models needing it (every model when provider or key changed, else only newly named ones) before the write; after the write commits, republishes the config and reconfigures the scheduler for the active provider (`models.md` § 3) |

Every other collection endpoint behaves as PocketBase defines it, subject to the rules in `schema.md` § 2.

## 13. Cross-cutting

**Auth posture.** Every canonical collection's list/view rule is `@request.auth.id != ''`, except `lens`, whose list/view rules are nil (superuser-only). Create/update/delete rules are nil (superuser-only) on every base collection except `ingest` (create open to the authenticated user; update/delete superuser-only) and `kalaidoscope_config` (update open to the authenticated user; create/delete superuser-only); `view_stream` is a view with the read rule only. The sidecar seeds one `users` record (`user@kalaido.local`) and prints its token as `KALAIDO_USER_TOKEN=` at boot (`boot-and-workers.md` § 1); no superuser is ever created by the binary. Custom routes register **no** auth middleware: any caller reaching the port may generate, commit, delete, or ingest. `PATCH` `pinned` is the only custom-route behaviour that reads `e.Auth`, and it is silently skipped when absent.

**Quota exhaustion.** `402 {error: "quota_exhausted", period, used}` — emitted by explore, brief, refinement chat, and generation paths when `usage.ErrExhausted` is returned; no authorizer is installed in this binary (`quota.Set` is never called), so it never is (`llm-queue-quota.md` § 5). The colour preview swallows it per fragment; the refinement preview leg reports it in-band as `kind` `quota_exhausted`.

**Provider failures.** A classified `ProviderError` becomes `{error, kind, provider, model, detail}` with status `409` (`provider_auth_failed`, kind `auth`), `429` (`provider_quota_exceeded`, kind `quota`), `502` (`provider_transient`, kind `transient`; `provider_error`, kind `other`) — `llm-queue-quota.md` § 6. There is deliberately no `401`.

**Context too large.** `422` with the guard's message (`context.md` § 6) from explore (with the Summaries hint in full mode), brief, refinement chat, and generation; inside an open stream, as a `{type: "error", errorText}` stream part (explore summaries rounds) or a `data-refine_error {kind: context_too_large, message}` part (the refinement preview leg, `refinement.md` § 3; the same part carries `kind` `quota_exhausted` or `apply_failed` for the other preview failures).

**Validation payloads.** Config-hook rejections are `400` with PocketBase validation data keyed on `default_model` (`model_required`) or `api_key` (`provider_<kind>` / `provider_validation_failed`).

**Detached work.** Generation, edit, commit, and bookmark save run under `context.WithoutCancel`; a client disconnect does not stop them. Backfill's pending-window pass, a reflection commit's pending-window pass, and ingest-record processing run on the process-scoped background runner (`boot-and-workers.md` § 3). Discover, map, and reconcile return `202` before any work; backfill materialises its `reflection_window` rows and rematch rewrites its membership rows inline, then return (`200`/`202`) before any model call; progress is visible only through collection changes over `/api/realtime`, the `llm_queue_status` row, `GET /api/status`, and `GET /api/reconcile`. The colour preview and the Ollama pull are bound to the request context and stop when the client disconnects.
