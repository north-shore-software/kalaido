# Model Selection — Generated Audit Snapshot

> **Generated:** 2026-09-02, from source at commit `3998ebd`.
> This file is a generated audit snapshot — do not edit it. See `AGENTS.md` § "Generated audit docs". When code described here changes, a stale marker line is prepended above this block; nothing else in the file is ever modified by hand.

**Scope.** Which model serves which call: the static registry (model sets, roles, provider per model, per-role sampling options), the workspace's own provider configuration record and the hooks that guard it, how a role resolves to a concrete model at call time with per-entity and per-conversation overrides, the two provider implementations' request shapes, and the Ollama status/pull/preload surface. Scheduling, quota, and error envelopes for those calls are in `llm-queue-quota.md`; the routes' wire detail is in `api.md` § 3 and § 11.

**Completeness anchor.** 6 roles (`llm.Roles()`), 2 model sets, 2 providers, 5 models in the static provider table (`llm/registry.go`); 1 config collection (`kalaidoscope_config`) with 2 hooks (`internal/config/hooks.go`); 4 routes (`GET /api/llm/preflight`, `POST /api/llm/validate`, `GET /api/ollama/status`, `POST /api/ollama/pull`).

---

## 1. The static registry and the model set

**Roles** (`llm.Role`): `chat`, `refinement`, `colour`, `snapshot` (projection/reflection output), `map` (consolidation and discover), `annotate` (per-fragment map markup).

**Model sets** map every role to a model name:

| Role | `local` | `cloud` |
|---|---|---|
| chat | `gemma4` | `gemini-3.6-flash` |
| refinement | `gemma4` | `gemini-3.1-pro-preview` |
| colour | `gemma4` | `gemini-3.5-flash-lite` |
| snapshot | `gemma4` | `gemini-3.1-pro-preview` |
| map | `gemma4` | `gemini-3.6-flash` |
| annotate | `gemma4` | `gemini-3.5-flash-lite` |

**Provider per model** (static): `gemma4` → `ollama`; `gemini-3.5-flash`, `gemini-3.5-flash-lite`, `gemini-3.6-flash`, `gemini-3.1-pro-preview` → `gemini`. A model outside this table has no provider on the unconfigured path. **Credential env** per provider: `gemini` → `GEMINI_API_KEY`; `ollama` → none (`RequiresCredential` is false).

**Per-role generation options**: `snapshot`, `colour`, `map`, `annotate` run at temperature 0; `chat` and `refinement` use provider defaults.

**The active model set** is process state seeded at boot (`boot-and-workers.md` § 1 step 9): `kalaidoscope_config.model_set` is authoritative once set; `KALAIDO_MODEL_SET` only seeds an empty row (default `local`). A stored value that fails to parse is fatal at boot. There is no route that changes it; the update hook (§ 3) forbids non-superusers from touching it.

## 2. Provider construction

`llm.SetProviderFactory` is called once in `main`. `SelectedProviderForConfig(model, cfg)`:

- `cfg.Provider == gemini` → `gemini.Provider{Model, APIKey: cfg.APIKey}`; `== ollama` → `ollama.OllamaProvider{Model}`. The static model table is **not** consulted, so a configured workspace may name any model string.
- Unconfigured → `ProviderFor(model)` from the static table: `gemini` → Gemini with **no** key (it falls back to `GEMINI_API_KEY` at call time), anything else → Ollama; an unknown model yields an error provider whose `Stream` returns the lookup error and whose `ContextWindow` is 0.

`SelectedProvider(model)` uses the active workspace config. Providers are constructed per call; there is no pooling.

## 3. Workspace configuration (`kalaidoscope_config`)

A singleton row (create and delete disabled for clients; update open to the authenticated user). Fields read: `provider`, `api_key`, `default_model`, `role_models` (JSON object role → model; empty values dropped; unreadable JSON is logged and ignored), plus `model_set` (§ 1). `Configured()` ⇔ `provider != ""`; an unrecognised provider string still counts as configured and reaches the factory's default branch (→ Ollama).

**Boot:** `LoadAtBoot` publishes a configured row via `SetWorkspaceConfig`; an unconfigured row leaves the zero value.

**Update request hook** (`OnRecordUpdateRequest`): a request body containing `model_set` from a non-superuser → 403.

**Update hook** (`OnRecordUpdate`, model-level so programmatic saves are covered too), before the write:

1. If the new config is configured and references no model (`default_model` and every `role_models` value empty) → 400 with a `model_required` validation error on `default_model`.
2. If the provider requires a credential **and** `api_key` is non-empty, the models needing validation are live-tested (§ 4). A provider or key change validates every referenced model; otherwise only newly referenced models. A provider without a credential (Ollama) is never live-checked. A configured Gemini row with an **empty** key is not validated either — it saves, and calls then fail at the provider with an auth error.
3. After the write commits: `SetWorkspaceConfig(next)` (takes effect on the next call, no restart) and `llmq.Reconfigure(ConfigForProvider(ActiveProviderID()))`.

Validation failures are returned as a 400 whose validation payload is keyed on `api_key` with code `provider_<kind>` (`auth`, `quota`, `transient`, `other`) or `provider_validation_failed` for an unclassified error.

## 4. Validation calls

`config.ValidateModels(cfg, models)`: one goroutine per model, all under a single 20 s deadline; each calls `SelectedProviderForConfig(model, cfg).Stream` with the single user message `ping` and default options, drains the stream, and waits for usage. The first error in listed order wins. These calls go through the provider directly — **not** through `usage.Stream` — so they are not scheduled, not quota-checked, and not recorded in `usage`.

`POST /api/llm/validate` (`api.md` § 3) runs `ValidateConfig` over a body-supplied config without saving anything; `provider` required (400), at least one model required (400). Always 200: `{ok: true}` or `{ok: false, kind, provider, model, detail}`.

`GET /api/llm/preflight` reports, per role, whether a call could run **without** making one: for a configured workspace — model present and, if the provider needs a key, `api_key` non-empty; unconfigured — the static table has a model and a provider for the role and the credential env var is set. Response `{modelSet, ok, roles: [{role, model, provider, ok, detail}]}`. `modelSet` is always the active set, even when a configured workspace ignores it.

## 5. Role resolution at call time

`ResolveRole(role)`: configured workspace → `role_models[role]`, else `default_model`, else an error naming the role; unconfigured → the active model set's entry. `ResolveRoleFor(role, override)`: a non-blank override wins outright with no validation against any table.

Overrides in use: `projection.model` / `reflection.model` (set via PATCH; `""` clears) for `RoleSnapshot` in generation, the refinement apply, and `RoleRefinement` in the refinement chat; `chat_conversation.model` for `RoleChat` (re-read every turn; there is no route that sets it — only the collection's own update endpoint). Colour, map, annotate, and discover calls resolve at role level with no override.

`ActiveProviderID()`: the configured provider, else the provider of the active set's chat model, else `ollama`. It drives scheduler shape only (`llm-queue-quota.md` § 2).

## 6. Provider implementations

Both satisfy `llm.Provider`: `Stream(ctx, messages, tools, opts) (*Completion, error)` returning a channel of events (`text`, `tool-start`, `tool-arg-delta`, `tool-end`) and a `Wait()` that returns final `Usage`; and `ContextWindow()`.

**Gemini** (`gemini/`): `POST …/models/<model>:streamGenerateContent?alt=sse` with header `x-goog-api-key` (workspace key, else `GEMINI_API_KEY`; neither → an `auth` `ProviderError` before any request). `system` messages are concatenated into `systemInstruction`; `assistant` becomes `model`. Tools become one `functionDeclarations` group. `generationConfig.temperature` only when set. `service_tier` is the constant `"priority"` (the served tier is logged from `usageMetadata.trafficType`). Non-2xx → `ProviderError` classified by body first (`API_KEY_INVALID`, `API_KEY_SERVICE_BLOCKED`, `ACCOUNT_STATE_INVALID`, `SERVICE_DISABLED`, `UNAUTHENTICATED`, `PERMISSION_DENIED` → auth; `RESOURCE_EXHAUSTED` → quota; `UNAVAILABLE`, `DEADLINE_EXCEEDED`, `INTERNAL` → transient) then by status (401/403 auth, 429 quota, ≥500 transient, else other). Transport failure → transient unless the caller's context was cancelled. Usage is cumulative from `usageMetadata` (prompt, candidates, total, cached). `ContextWindow()` = 1,000,000. Tool-call ids are minted client-side per function name; a second call to the same function in one response is **not** emitted (deduped by name).

**Ollama** (`internal/ollama/`): base URL `OLLAMA_HOST` or `http://localhost:11434`. `POST /api/chat` streaming NDJSON, `keep_alive: 60m`, `options.num_ctx` = the model's context length from `/api/show` (5 s probe, cached per model, default 4096), `options.temperature` when set. Tools are passed as `function` tools; string-encoded arguments are unwrapped. Errors are **not** classified into `ProviderError` — a non-2xx or transport failure surfaces as a plain error (so the scheduler back-off and the auth/quota envelopes never trigger for Ollama). Usage comes from the final `done` chunk (`prompt_eval_count`, `eval_count`, tokens/s from `eval_duration`). `ContextWindow()` = 256,000 regardless of `num_ctx`. Empty `Model` falls back to `gemma4`.

**HTTP clients** (`httpx/`): a shared transport (10 s dial, 30 s response-header timeout, HTTP/2, proxy from env); `Streaming()` clones it with no response-header timeout; `Short(d)` applies an overall timeout.

## 7. Ollama routes and preload

- `GET /api/ollama/status`: `GET /api/tags` with a 5 s timeout. Always 200: `{reachable: true, models: [{name, size}]}` or `{reachable: false, models: [], error}`.
- `POST /api/ollama/pull` `{model}` (400 if empty): streams `POST /api/pull` progress as NDJSON `{status, completed, total}` lines, ending with `{status: "success", done: true}` or `{error}`; the HTTP status is 200 in every case once streaming starts.
- **Preload** (`boot-and-workers.md` § 2): `POST /api/generate` with an empty prompt for `gemma4`, 5 min per attempt, retried every 5 s for up to 2 min. Independent of the active provider.
