> **STALE** — code has changed since this document was generated.

# Model Selection — Generated Audit Snapshot

> **Generated:** 2026-09-17, from source at commit `895984c`.
> This file is a generated audit snapshot — do not edit it. See `AGENTS.md` § "Generated audit docs". When code described here changes, a stale marker line is prepended above this block; nothing else in the file is ever modified by hand.

**Scope.** Which model serves which call: the static registry (model sets, roles, provider per model, per-role sampling options), the workspace's own provider configuration record and the hooks that guard it, how a role resolves to a concrete model at call time with per-entity overrides, the two provider implementations' request shapes and error classification, and the Ollama status/pull/preload surface. Scheduling, quota, and the HTTP error envelopes for those calls are in `llm-queue-quota.md`; the routes' wire detail is in `api.md` § 3, § 10 and § 11; the config collection's fields and rules are in `schema.md` § 2.16; the prompt-size guard that reads `ContextWindow()` is in `context.md` § 6.

**Completeness anchor.** 6 roles (`llm.Roles()`), 2 model sets, 2 providers, 5 models in the static provider table (`llm/registry.go`); 1 config collection (`kalaidoscope_config`) with 3 hooks (`internal/config/hooks.go`: `OnRecordUpdateRequest`, `OnRecordEnrich`, `OnRecordUpdate`); 4 routes (`GET /api/llm/preflight`, `POST /api/llm/validate` in `server/server.go`; `GET /api/ollama/status`, `POST /api/ollama/pull` in `internal/ollama/handlers.go`); 3 collections carrying a `generate_with_model` override (`projection`, `reflection`, `chat_conversation`).

---

## 1. The static registry and the model set

**Roles** (`llm.Role`): `chat`, `refinement`, `colour`, `snapshot` (projection/reflection output), `map` (map consolidation and every discover flow), `annotate` (per-fragment map markup). `llm.Roles()` returns them in that order; every per-role loop (config `Models()`, preflight) iterates it.

**Model sets** (`modelsBySetRole`) map every role to a model name:

| Role | `local` | `cloud` |
|---|---|---|
| chat | `gemma4` | `gemini-3.6-flash` |
| refinement | `gemma4` | `gemini-3.1-pro-preview` |
| colour | `gemma4` | `gemini-3.5-flash-lite` |
| snapshot | `gemma4` | `gemini-3.1-pro-preview` |
| map | `gemma4` | `gemini-3.6-flash` |
| annotate | `gemma4` | `gemini-3.5-flash-lite` |

`ParseModelSet` accepts exactly `local` and `cloud`; anything else is an error. `ModelFor(set, role)` errors on an unknown set or a role absent from the set (none is absent today).

**Provider per model** (`providerByModel`, static): `gemma4` → `ollama`; `gemini-3.5-flash`, `gemini-3.5-flash-lite`, `gemini-3.6-flash`, `gemini-3.1-pro-preview` → `gemini`. `gemini-3.5-flash` is in the provider table but in no model set. A model outside this table has no provider on the unconfigured path (`ProviderFor` errors). **Credential env** per provider (`credentialEnv`): `gemini` → `GEMINI_API_KEY`; `ollama` → `""`. `RequiresCredential(p)` ⇔ the env name is non-empty, so only `gemini` is ever key-validated.

**Per-role generation options** (`optionsByRole`): `snapshot`, `colour`, `map`, `annotate` → `Temperature` 0; `chat` and `refinement` have no entry and get the zero `GenOptions` (temperature omitted from the request, provider default). `OptionsForRole` is applied inside `usage.Stream` (`llm-queue-quota.md` § 1); the validation calls in § 4 pass the zero value regardless of role.

**The active model set** is process state (`activeSet`, default `local`) written only at boot by `resolveModelSet` in `cmd/sidecar/main.go` (`boot-and-workers.md` § 1 step 9):

- The `kalaidoscope_config` collection cannot be found → logged, the in-memory default `local` stands, boot continues.
- The singleton row (first row of `FindAllRecords`; a new unsaved record when none exists) has an empty `model_set` → the set is `local`, or `KALAIDO_MODEL_SET` when that is set; an unparseable env value is **fatal**. The value is written to the row and saved; a save failure is logged and the set is still used for this run.
- A non-empty stored `model_set` that fails to parse is **fatal**. A parseable one wins; a `KALAIDO_MODEL_SET` that differs is logged as ignored.

No route changes `model_set`; the update-request hook (§ 3) rejects any non-superuser body that names it. A change made by a superuser takes effect on the next boot only — nothing re-reads the field while the process runs.

## 2. Provider construction

`llm.SetProviderFactory` is called once, in `main` (`boot-and-workers.md` § 1 step 11); `server.EnsureReady` is fatal if it was not. `SelectedProviderForConfig(model, cfg)` panics if no factory is registered, then delegates to it:

- `cfg.Provider == gemini` → `&gemini.Provider{Model, APIKey: cfg.APIKey}`; `== ollama` → `&ollama.OllamaProvider{Model}`. The static model table is **not** consulted, so a configured workspace may name any model string.
- Any other non-empty `cfg.Provider` (unrecognised but "configured", § 3) and the unconfigured case both fall through to `ProviderFor(model)` on the static table: `gemini` → `&gemini.Provider{Model}` with **no** key (the provider falls back to `GEMINI_API_KEY` at call time), any other registered provider → Ollama; a model absent from the table yields `ErrorProvider(err)`, whose `Stream` returns the lookup error (a plain error, not a `ProviderError`) and whose `ContextWindow()` is 0.

`SelectedProvider(model)` uses `ActiveWorkspaceConfig()`. Providers are constructed per call; there is no pooling or caching of provider instances. Callers of `SelectedProvider`: `usage.Stream` (every scheduled call), `engine.CheckPromptFits` / `engine.PromptBudget` (for `ContextWindow()` only, `context.md` § 6); `SelectedProviderForConfig` is called only by `config.validateModel` (§ 4).

## 3. Workspace configuration (`kalaidoscope_config`)

A singleton row: list/view and update rules are `@request.auth.id != ''`; create and delete rules are nil (the row is created server-side by `resolveModelSet`, § 1, a path that runs none of the hooks below). Fields (`schema.md` § 2.16): `model_set`, `provider`, `api_key`, `default_model` (text), `role_models` (JSON), `created`, `updated`.

**`config.Read(rec)`** builds an `llm.WorkspaceConfig{Provider, APIKey, DefaultModel, RoleModels}` from `provider`, `api_key`, `default_model`, `role_models`. `role_models` equal to `""` or `"null"` is skipped; any other value is decoded as `map[string]string` — an undecodable value is logged (`config: ignoring unreadable role_models`) and treated as empty; entries with an empty value are dropped; keys are **not** checked against `Roles()` (an unknown key is stored in the map and never consulted, because `Models()` and every resolver iterate `Roles()`). A nil record yields the zero value. `Configured()` ⇔ `Provider != ""`; an unrecognised provider string counts as configured and reaches the factory's fall-through branch (§ 2). `ModelForRole(r)` = `RoleModels[r]`, else `DefaultModel`, else `""`. `Models()` = the distinct non-empty models, `DefaultModel` first then each role in `Roles()` order.

**Boot** (`LoadAtBoot`, `OnServe`, `boot-and-workers.md` § 1 step 10): finds the row; if it exists and `Read` is configured, `llm.SetWorkspaceConfig(cfg)` and a log line; otherwise the zero value stays. `SetWorkspaceConfig` clones `RoleModels` and swaps the value under a `RWMutex`.

**Hooks** (`RegisterHooks`, called from `server.RegisterTriggers`):

1. **`OnRecordUpdateRequest`** (route-level only): if the parsed request body contains the key `model_set` — at any value, including the stored one — and the request is not superuser-authenticated → `403 "model_set can only be changed by a superuser"`. Other fields are untouched.
2. **`OnRecordEnrich`**: when there is no request info or it is not superuser-authenticated, `api_key` is hidden from the serialised record (list, view, the update response, realtime). The field itself is a plain `TextField`, so a client update carrying `api_key` is stored.
3. **`OnRecordUpdate`** (model-level, so programmatic saves too; runs after the submitted values are loaded and before the row is written). `orig = Read(Original())`, `next = Read(Record)`.
   - If `next.Configured()` and `next.Models()` is empty → `400 "a model is required when a provider is set"` with validation payload `{default_model: {code: model_required}}`. Nothing is written.
   - If `next.Configured()`, `RequiresCredential(next.Provider)` and `next.APIKey != ""` → `ModelsNeedingValidation(orig, next)`; when non-empty, `ValidateModels` (§ 4) runs and a failure is returned as `validationError(err)`: `400 "provider validation failed: <err>"` with payload `{api_key: {code: provider_<kind>}}` (`provider_auth`, `provider_quota`, `provider_transient`, `provider_other`) when the error is a `*llm.ProviderError`, else `{api_key: {code: provider_validation_failed}}`. Nothing is written.
   - Not live-checked: a provider without a credential (Ollama, or an unrecognised provider string); a `gemini` row whose `api_key` is empty (it saves, and calls then fail at the provider unless `GEMINI_API_KEY` is set in the environment); a transition to unconfigured (`provider` cleared).
   - After `e.Next()` succeeds: `llm.SetWorkspaceConfig(next)` (takes effect on the next call, no restart; a cleared provider publishes the zero value and resolution falls back to the model set) and `llmq.Reconfigure(llmq.ConfigForProvider(llm.ActiveProviderID()))` (`llm-queue-quota.md` § 2). Both run on every successful update, including a superuser's `model_set`-only edit.

**`ModelsNeedingValidation(orig, next)`**: if `next.Provider != orig.Provider` or `next.APIKey != orig.APIKey` → all of `next.Models()`; otherwise only the models in `next.Models()` absent from `orig.Models()`. Retargeting a role to a model the config already references elsewhere therefore validates nothing.

There is no create or delete hook (both operations are closed to clients by rule).

## 4. Validation calls

`config.ValidateModels(ctx, cfg, models)`: returns nil for an empty list; otherwise one goroutine per model under a single `context.WithTimeout` of **20 s** (`validationDeadline`, shared by the whole pass, not per model). Each `validateModel` calls `llm.SelectedProviderForConfig(model, cfg).Stream(ctx, [{role: user, content: prompts.ValidationPing}], nil, GenOptions{})` (`prompts.md` § 2 — the literal `ping`), drains `Events`, then `Wait()`. Errors are collected per index and the first non-nil in listed order is returned. `ValidateConfig(ctx, cfg)` = `ValidateModels(ctx, cfg, cfg.Models())`.

These calls go to the provider directly, **not** through `usage.Stream`: no `usage.Authorized` check, no scheduler admission, no quota check, no `usage` row, no per-role options, and no throttle report on a quota/transient error. A stream that opens successfully and then ends abnormally (empty reply, safety block) still counts as valid — only a `Stream` error fails a model.

**`POST /api/llm/validate`** (`HandleValidateProvider`; `api.md` § 3) binds `api.ValidateProviderRequest{provider, apiKey, defaultModel, roleModels}` (camelCase wire names; the collection uses snake_case). Unbindable body → `400 "invalid request body"`; empty `provider` → `400 "provider is required"`; `roleModels` entries with empty values are dropped; `Models()` empty → `400 "a model is required"`. Then `ValidateConfig` runs on the request context for **every** provider — unlike the update hook, Ollama and an empty `apiKey` are not exempt (an empty Gemini key here fails with an `auth` error only when `GEMINI_API_KEY` is also unset in the sidecar's environment). Nothing is saved. Response is always `200`: `{ok: true}`, or `{ok: false, detail}` plus `kind`, `provider`, `model` when the error is a `*llm.ProviderError` (all four `omitempty`).

**`GET /api/llm/preflight`** (`HandleModelPreflight`) reports, per role, whether a call could run, **without** making one. Response `api.ModelPreflightResponse{modelSet, ok, roles: [{role, model?, provider?, ok, detail?}]}` — `ok` fields are always present, the rest `omitempty`; `modelSet` is always the active set even when a configured workspace ignores it; top-level `ok` is false if any role's is.

- Configured workspace (`workspacePreflight`): `provider` = the stored provider for every role; `model` = `cfg.ModelForRole(role)`; `ok` false with `detail` `"no model configured for this role"` when the model is empty, or `"no API key configured for this workspace"` when `RequiresCredential(provider)` and `api_key` is empty. The environment credential is not consulted on this path.
- Unconfigured (`modelSetPreflight`): `model` from `ModelFor(activeSet, role)` (an error puts its text in `detail`, no `model`/`provider`); `provider` from `ProviderFor(model)` (an error puts its text in `detail`, `model` present); then `ok` false with `detail` `"<ENV> is not set"` when the provider's credential env is named and empty. Reachability of Ollama is not checked.

## 5. Role resolution at call time

`llm.ResolveRole(role)`: configured workspace → `cfg.ModelForRole(role)`, and an empty result is an error (`workspace provider %q has no model for role %q`); unconfigured → `ModelFor(activeSet, role)`. `ResolveRoleFor(role, override)`: a non-blank (after `TrimSpace`) override is returned as-is — not checked against any table, provider, or the configured workspace — else `ResolveRole`.

**The override field** is `generate_with_model` (text) on `projection`, `reflection` and `chat_conversation`.

- `projection` / `reflection`: written by `PATCH /api/projections/{id}` and `PATCH /api/reflections/{id}` (`handleUpdate`, `lifecycle-projection.md` § 7, `lifecycle-reflection.md` § 3) from `api.UpdateSynthesisRequest.generateWithModel` (`*string`; absent = unchanged; the value is trimmed; `""` clears). The collections' own update rule is closed to clients, so this route is the only client-side writer.
- `chat_conversation`: `DisableWriteOperations` — no client update rule, and no route or hook in the binary writes the field. It is read on every chat turn, brief and token estimate; it can be set only by a superuser (dashboard or direct database access).

**Resolution per call site** (each site resolves exactly once and threads the model into `usage.Stream`, which stamps it as provenance — `llm-queue-quota.md` § 1):

| Role | Override | Sites |
|---|---|---|
| `snapshot` | parent entity's `generate_with_model` | `engine.GenerateOnce` (`internal/engine/snapshot.go`) before the claim; `engine.SnapshotIsCurrent` (a latest snapshot whose `generated_by_model` is non-empty and differs from the currently effective model reads as non-current); the refinement apply / from-scratch preview and the window re-apply (`refinement_chat.go`, both via the parent's field — a refinement has no field of its own); commit provenance in `engine/lifecycle.go` (projection commits only; the resolve error is discarded, so a failed resolution stamps `""`) |
| `refinement` | parent entity's `generate_with_model` | the refinement chat turn (`refinement_chat.go`), resolved before the prompt-size guard; error → `500 "no model configured for refinement"` |
| `chat` | `chat_conversation.generate_with_model` | the chat turn (`handlers/chat.go`, re-read from the conversation row every turn; error → `500 "no model configured for chat"`); `chat.GenerateBrief`; `POST /api/context/tokens` — the conversation form passes the conversation's field, the spec form passes `""` (resolution failure there is silent: `model`/`limit` stay empty and `fits` is true) |
| `colour` | none (`ResolveRole`) | colour worker drain (`colours.md` § 4); colour preview route, resolved before the SSE `200` (error → `500 "no model configured for colour matching"`) |
| `map` | none | `mapping` consolidate (`map.md` § 3); every discover flow (`discover.md` § 3) |
| `annotate` | none | `mapping` annotate worker (`map.md` § 2) |

**`ActiveProviderID()`**: the configured provider (whatever string it is), else the provider of the active set's `chat` model, else `ollama` when either lookup fails. It selects the scheduler shape only (`llmq.ConfigForProvider`: `ollama` → concurrency 1 with preemption; anything else → the hosted shape; `llm-queue-quota.md` § 2). It is read at the end of boot (`boot-and-workers.md` § 1 step 8) and after every committed config update (§ 3).

## 6. Provider implementations

Both satisfy `llm.Provider`: `Stream(ctx, messages, tools, opts) (*Completion, error)` returning a channel of `StreamEvent`s (kinds `EventText`, `EventToolStart`, `EventToolArgDelta`, `EventToolEnd`) and a `Wait()` that blocks until the reader goroutine exits and returns the final `*Usage` (nil when the stream ended without a usage record); and `ContextWindow() int`. Neither provider emits `EventToolArgDelta`; both emit exactly one `EventToolStart` and at most one `EventToolEnd` (carrying the complete arguments) per tool call. Both providers: a transport failure while the caller's context is already cancelled returns `ctx.Err()` unclassified; any other transport failure is a `ProviderError` of kind `transient` with `StatusCode` 0; the error body read on a non-success status is capped at 4096 bytes and trimmed. Every failure to open a stream is logged by `llm.LogFailure` with the call's `Shape` (message count and characters per role, empty-message count, tool names, temperature) and a provider-specific detail string; with `KALAIDO_LLM_TRACE` set to any value, `llm.LogRequest` additionally logs the full request body (content included) before every call.

**Gemini** (`gemini/`): `POST https://generativelanguage.googleapis.com/v1beta/models/<model>:streamGenerateContent?alt=sse` with header `x-goog-api-key` = the provider's `APIKey`, else `GEMINI_API_KEY`; neither → an `auth` `ProviderError` before any request. An empty `Model` → the plain error `gemini: no model set`. Message mapping: only a system message **at index 0** becomes `systemInstruction`; any later `system` message is sent as a `user` turn in its position; `assistant` becomes `model`; consecutive same-role turns are merged into one `contents` entry with several `parts`. Tools become a single `tools[0].functionDeclarations` group. `generationConfig.temperature` is sent only when `opts.Temperature` is set. `service_tier` is the compile-time constant `"priority"` on every request; the tier that actually served the call is read from `usageMetadata.trafficType` and logged (`gemini: traffic_type=…`) once per completed stream. Non-2xx → `ProviderError` classified by `gemini.classify`: body `error.details[].reason` `API_KEY_INVALID`, `API_KEY_SERVICE_BLOCKED`, `ACCOUNT_STATE_INVALID`, `SERVICE_DISABLED` → `auth`; else body `error.status` `UNAUTHENTICATED`, `PERMISSION_DENIED` → `auth`, `RESOURCE_EXHAUSTED` → `quota`, `UNAVAILABLE`, `DEADLINE_EXCEEDED`, `INTERNAL` → `transient`; else `llm.ClassifyStatus` (401/403 `auth`, 429 `quota`, ≥500 `transient`, anything else `other`). Stream parsing: SSE `data: ` lines (others skipped), `[DONE]` ends, undecodable chunks skipped, 1 MiB line buffer. Usage is cumulative — the latest `usageMetadata` wins (`promptTokenCount`, `candidatesTokenCount`, `totalTokenCount`, `cachedContentTokenCount`); `Wait()` returns nil if no chunk carried it. Only `candidates[0]` is read. Tool calls: the id is minted client-side (`call-<unix-nanos>`) and keyed by **function name** — a second call to the same function in one response is not emitted, and `EventToolEnd` fires once, on the first part with non-empty `args`. After the stream, one log line names `finishReason`/`finishMessage`, `promptFeedback.blockReason`, the part counts and usage whenever the finish reason is anything but `STOP`, a block reason was seen, or nothing was emitted. `ContextWindow()` = 1,000,000.

**Ollama** (`internal/ollama/`): base URL `OLLAMA_HOST` (trailing `/` trimmed) or `http://localhost:11434`, fixed at process start. `POST /api/chat` with `stream: true`, `keep_alive: "60m"`, `options.num_ctx` = `GetModelContextLength` (a `POST /api/show` probe with a 5 s client timeout, reading the first `model_info` key ending in `.context_length`; 4096 when the probe fails or the key is absent; the result is cached per model for the life of the process only when the probe returned 200), `options.temperature` when set. Tools are sent as `type: "function"` entries. An empty `Model` is sent as `gemma4`. Non-200 → `ProviderError` with `Kind = llm.ClassifyStatus(status)` (so a 404 for a model that is not pulled classifies as `other`). Stream parsing: NDJSON, undecodable lines skipped; `message.content` → `EventText`; tool calls are tracked by index within the response (`call-<unix-nanos>-<i>`), `EventToolEnd` fires once per index when `arguments` is non-empty, and string-encoded arguments are unwrapped to raw JSON. Usage comes from the chunk with `done: true` (`prompt_eval_count`, `eval_count`, their sum, and tokens/s = `eval_count` ÷ `eval_duration`); the reader stops at that chunk, and if the body ends without one `Wait()` returns nil. `ContextWindow()` = 256,000 regardless of `num_ctx`.

**HTTP clients** (`httpx/`): a shared transport (10 s dial, 30 s TLS handshake, 30 s response-header timeout, HTTP/2 attempted, proxy from environment, 100 idle connections / 90 s idle); `Streaming()` is a clone with no response-header timeout and no overall timeout (the request context bounds it); `Short(d)` is the shared transport with an overall client timeout `d`.

## 7. Ollama routes and preload

- **`GET /api/ollama/status`** (`HandleOllamaStatus`): `ListModels` = `GET <base>/api/tags` under a 5 s request-context timeout and a 5 s client timeout; a non-200 becomes the error `ollama: tags status <n>`; a `null` model list is normalised to `[]`. Always `200`: `api.OllamaStatusResponse{reachable: true, models: [{name, size}]}` or `{reachable: false, models: [], error}`. The active provider and model set are not consulted.
- **`POST /api/ollama/pull`** (`HandleOllamaPull`) binds `api.OllamaPullRequest{model}`: unbindable body → `400 "invalid pull request body"`; empty `model` → `400 "model required"`. Otherwise it writes `Content-Type: application/x-ndjson`, `Cache-Control: no-cache` and status `200` **before** contacting Ollama, then `PullModel` streams `POST <base>/api/pull` `{name, stream: true}` on the request context (`Streaming()` client, 1 MiB line buffer): each decoded chunk is forwarded as `{status, completed, total}` (values passed through verbatim; undecodable and empty lines skipped); a chunk with a non-empty `error` ends the pull with `{error: "ollama: pull: <text>"}`; a transport failure, a non-200 from Ollama (`ollama: pull status <n>`) or a scanner error also end it with `{error}`; a clean end of stream sends `{status: "success", done: true}`. Every outcome is HTTP `200` once streaming has begun; each line is flushed when the writer supports it.
- **Preload** (`RegisterPreload`, `boot-and-workers.md` § 2): at `OnServe`, `go preloadDefaultModel(context.Background())` — never cancelled by shutdown. Each attempt is `PreloadModel(ctx, "gemma4")`: `POST <base>/api/generate` `{model, prompt: "", stream: false, keep_alive: "60m", options: {num_ctx}}` with a 5 min client timeout; a non-200 is an error. Attempts repeat every 5 s until one succeeds or 2 min have elapsed since the first attempt began; each outcome is logged (`resident`, `not ready, retrying`, `giving up`). The model is the package constant `defaultModel`, independent of the active model set, the workspace config, and whether Ollama is the active provider.
