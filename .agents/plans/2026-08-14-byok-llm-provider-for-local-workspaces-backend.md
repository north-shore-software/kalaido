---
title: "Backend plan: per-workspace BYOK LLM provider"
status: "planned"
author: "claude"
created: "2026-08-14"
source_spec: "2026-08-14-byok-llm-provider-for-local-workspaces.md"
---

**Scope**: Go/PocketBase backend only (`/code/kalaido/kalaidoscope`). No UI, Rust, or Tauri changes — those are covered by a separate plan. Live API-key validation and runtime error classification are in scope.

## Context

The wishlist item `2026-08-14-byok-llm-provider-for-local-workspaces.md` asks to decouple workspace storage location from LLM provider: local workspaces should be able to use Google Gemini via a user-supplied API key ("BYOK"), not just local Ollama. Today, provider selection is entirely global/env-seeded (`GEMINI_API_KEY` env var, `KALAIDO_MODEL_SET` env var seeding a single DB row once at boot) — there's no per-workspace concept of provider or credentials anywhere in the Go backend. This plan makes provider, API key, and per-role model assignments first-class, persisted, workspace-scoped config, while leaving the existing global/env-based path fully intact for backward compatibility (pre-existing local workspaces, and the separately-deployed cloud/managed-key backend which is out of this repo's control and out of scope).

Two things shape the whole design:
1. Each local workspace already **is** its own isolated OS process + PocketBase SQLite DB (the Tauri "kalaidoscope" sidecar, `cmd/sidecar/main.go`, spawned per-workspace with its own `--dir`). So "per-workspace config" is just "a row in this process's own DB" — no multi-tenancy needed, and no new Rust→Go plumbing needed either, since the same process that hosts the PocketBase DB is the one making the provider's HTTP calls.
2. Gemini is the first BYOK provider, not the last (per explicit direction) — schema, config resolution, validation, and error classification are all designed **provider-generic** below, so adding a second provider later means touching only provider-registration code (a new package + one factory-switch case), never the schema or the dispatch/validation/hook plumbing.

## 1. Schema — edit the existing migration file directly, generic fields

Kalaido hasn't launched yet, so there are no existing workspace DBs whose migration ledger needs preserving — edit `kalaidoscope/migrations/1748000000_init_schema.go`'s `schema` slice directly rather than adding a second migration file. (If this changes before implementation — i.e. real user data exists — revisit: PocketBase tracks applied migrations by source filename, so a schema-file edit alone would not reach any DB that already ran this migration.)

A workspace has exactly one active provider at a time (permanent for its lifetime), so the config row needs exactly one generic key/model set — not one column per provider:

- Extend `tableDef` with three granular flags — `DisableCreate`, `DisableUpdate`, `DisableDelete` — alongside the existing all-or-nothing `DisableWriteOperations` (kept, unchanged meaning, for every other entry that already uses it). Update `ensureCollection`'s rule derivation to combine `DisableWriteOperations || DisableCreate` etc. per operation, so `kalaidoscope_config` can go from "fully superuser-only" to "create/delete superuser-only, update open to the authenticated app user."
- New fields on `kalaidoscope_config` (added directly to its existing `schema` entry) — deliberately **not** namespaced by provider name:
  | Field | Type | Meaning |
  |---|---|---|
  | `provider` | `TextField` | `""` (legacy/unset) \| `"ollama"` \| `"gemini"` \| future values. Permanent once non-empty — enforced by hook (§5), not schema. |
  | `api_key` | `TextField` | Plaintext BYOK credential for whichever provider is set (per spec — no `PasswordField`, which hashes irreversibly and can't be viewed back; no OS keychain, matching existing plaintext-local-settings precedent). Meaningless/unused for providers with no credential concept (e.g. Ollama). |
  | `default_model` | `TextField` | Model for all 5 roles unless overridden. |
  | `role_models` | `JSONField` | Sparse `{"chat":"...", "refinement":"...", "colour":"...", "distill":"...", "snapshot":"..."}` override map. |
- New field on `colour`'s existing `schema` entry: `last_provider_error_kind` (`TextField`, `""` \| `"auth"` \| `"quota"`) — see §6 (background worker error surfacing). Generic name, not tied to Gemini.

## 2. Config resolution — extend `llm/selector.go`, don't replace it

Current state (verified): `providerFactory func(model string) Provider` and `activeSet ModelSet` are package-global, boot-time-seeded, single-process state — `ResolveRole`/`SelectedProvider` read them directly. This pattern is reused, not rebuilt.

- Add `WorkspaceConfig{ Provider ProviderID; APIKey string; DefaultModel string; RoleModels map[Role]string }` (generic — no per-provider fields) plus `SetWorkspaceConfig`/`ActiveWorkspaceConfig` (mutex-guarded global, same shape as `activeSet`).
- `ResolveRole(r)`: if `ActiveWorkspaceConfig().Provider != ""`, resolve from `RoleModels[r]` → fallback `DefaultModel`; otherwise fall through unchanged to today's `ModelFor(activeSet, r)`.
- Widen the factory signature to `func(model string, cfg WorkspaceConfig) Provider` (one call site today, in `main.go` — contained change). `llm` cannot import `gemini`/`ollama` directly (import cycle — this is exactly why the factory is injected from `main.go` today), so concrete construction (`&gemini.Provider{Model, APIKey: cfg.APIKey}` when `cfg.Provider == llm.ProviderGemini`, etc.) stays in `main.go`'s closure — **this switch is the one place a future provider gets added**, falling through to the existing `llm.ProviderFor(model)` + env-key path when `cfg.Provider == ""`.
- `SelectedProvider(model)` keeps resolving against the *active* global config (`providerFactory(model, ActiveWorkspaceConfig())`, unchanged call shape). Add a sibling `SelectedProviderForConfig(model string, cfg WorkspaceConfig) Provider` that calls `providerFactory(model, cfg)` directly with an arbitrary **candidate** config — this is what makes validation (§4) fully provider-agnostic: it can construct-and-test a not-yet-saved config through the exact same factory switch, with zero knowledge of which concrete provider package is involved.
- Population: boot-time load in a new `internal/config.LoadAtBoot`, bound via `a.OnServe()` next to the existing `resolveModelSet` call in `main.go` (same file/pattern). Empty `provider` on the row ⇒ zero-value `WorkspaceConfig{}` ⇒ byte-identical to not calling it. Refreshed **live, no restart** via the update hook in §5, satisfying "revalidated live on every change" without requiring a process bounce.

## 3. Shared provider-error type — lives in `llm`, not `gemini`

New file `llm/errors.go` (not `gemini/errors.go`) — a classified error type every current and future `Provider` implementation returns, so validation, hooks, and call-site error handling never need to know which concrete provider produced it:

```go
type ErrorKind string
const (
    ErrKindAuth      ErrorKind = "auth"      // invalid/revoked credential, or no access to the model
    ErrKindQuota     ErrorKind = "quota"     // rate limit / quota exhausted
    ErrKindTransient ErrorKind = "transient" // network failure, timeout, 5xx — safe to retry
    ErrKindOther     ErrorKind = "other"
)
type ProviderError struct { Provider ProviderID; Kind ErrorKind; StatusCode int; Model string; Body string }
func (e *ProviderError) Error() string { ... }
```

`gemini/gemini.go`: add `APIKey string` to `Provider` (currently just `Model string`). In `Stream()`, use `p.APIKey` if set, else fall back to `os.Getenv("GEMINI_API_KEY")` (preserves the managed-key path for the separately-deployed cloud backend and any workspace that hasn't opted into BYOK). Replace today's two unstructured `fmt.Errorf` failure sites (network error, non-2xx response) with `&llm.ProviderError{Provider: llm.ProviderGemini, Kind: classify(statusCode), ...}`, status-code classified (401/403→auth, 429→quota, 5xx→transient, else other). Preserve context-cancellation as a plain `ctx.Err()` return (not wrapped as `*ProviderError`) so it's never misclassified downstream, and so `internal/handlers/colour.go`'s existing `ctx.Err() == nil` disconnect-detection keeps working untouched. A future provider package classifies its own errors into the same shared `llm.ProviderError` — no new error type per provider.

## 4. Live validation — fully provider-agnostic, reuses `Stream()`

New file `internal/config/validate.go`: `ValidateWorkspaceConfig(ctx, cfg)` iterates the distinct models referenced by `cfg` (default + per-role overrides, deduped), and for each calls `llm.SelectedProviderForConfig(model, cfg).Stream(ctx, []llm.Message{{Role:"user", Content:"ping"}}, nil)`, draining the response — the exact same code path a real call uses, so "invalid key," "no access to this model," and "quota exceeded" are all caught identically to a live production failure. This file **imports no concrete provider package** (`gemini`, `ollama`, or any future one) — it only knows `llm`, so it needs zero changes when a new provider is added. Errors already come back as `*llm.ProviderError`.

**When validation runs** — gate on whether the provider *has a credential concept*, not on whether a key string happens to be present:

- Add `llm.RequiresCredential(p ProviderID) bool` to `registry.go`, backed by the existing `credentialEnv` table (which already encodes `ollama → ""` / `gemini → "GEMINI_API_KEY"`). A new provider registers there anyway, so this stays generic.
- Validate when `provider != ""` **and** `RequiresCredential(provider)` **and** a non-empty `api_key` is present.
- Deliberate consequence: **Ollama model choices are not live-validated.** This matches today's behavior (Ollama model selection is unvalidated) and avoids "you can't change any setting because Ollama isn't running." Recorded as a decision, not an oversight.
- Empty `api_key` on a credential provider (the "clear key" action) skips validation — always allowed; the next real `Stream()` call then fails fast with a classified auth error, which is itself the distinguishable-failure behavior requirement 6 wants.
- **Reject `provider != ""` with no model at all** (empty `default_model` and empty `role_models`). Otherwise `ResolveRole` errors on every subsequent generation, and validation would vacuously pass by iterating zero models.

**Bounding cost and latency**: validating every referenced model serially is up to 5 live billed generations per save. Validate the models **concurrently** under a single overall deadline (~20s) rather than a per-model timeout, and only validate models that actually **changed** versus `Record.Original()` — the common edits (rotate the key, change one role) then cost one call, not five. A key change invalidates all models and revalidates the full set.

**Verified — no DB lock is held during these network calls.** The REST update path is `recordUpdate` → `form.Submit()` → `SaveWithContext` → `BaseApp.update`, none of which opens a transaction (`RunInTransaction` in `forms/record_upsert.go` appears only inside `DrySubmit`, a different method). `OnModelUpdate`/`OnRecordUpdate` fire *before* the single `UPDATE` statement, so a slow validation call blocks only that one HTTP request — it does not hold SQLite's single writer lock or stall other workspace traffic. (Worth keeping in mind if a future change wraps record updates in a transaction: at that point this validation must move out of the hook.)

Trigger point: the `OnRecordUpdate("kalaidoscope_config")` hook (§5) — every persisted change to provider/key/models is validated before the write commits, blocking bad saves.

**Interface note for the UI plan — "validated before the workspace is created" is not literally achievable backend-side.** The config row lives *in the workspace's own DB*, so the directory must exist and the sidecar must be running before any validation can happen. What this design guarantees is that a workspace never *retains* an invalid config: a failed PATCH is rejected and nothing is persisted, so `provider` stays unset and the user can retry. The UI create flow therefore has to be "create dir + spawn sidecar + PATCH config → register the workspace only on success, discard on failure." This is a hard dependency the UI plan must account for.

Given that, the standalone `POST /api/llm/validate` route (pattern: `internal/handlers/preflight.go`'s existing `GET /api/llm/preflight`) is **recommended rather than optional**: it lets the UI test a candidate key/model without mutating anything, which matters because the first *successful* PATCH permanently locks `provider` for the workspace's lifetime. Cheap to add — it's the same `ValidateWorkspaceConfig` call behind a request DTO.

## 5. Immutability + validation hook

New file `internal/config/hooks.go`, registered from `server.RegisterTriggers` next to the existing `ingest.RegisterHooks(app)` call (same pattern):

- `OnRecordUpdateRequest("kalaidoscope_config")`: guards `model_set` — collection-level `UpdateRule` is becoming "any authenticated user" (needed for the new fields), but PocketBase has no field-level rules, so `model_set` specifically must stay superuser-only via an explicit check on the raw request body (`e.RequestInfo().Body`) before it's bound to the record.
- `OnRecordUpdate("kalaidoscope_config")` (model-level — fires after new values are loaded, before persist, for every `Save()` regardless of origin): reject if `Record.Original().GetString("provider")` is non-empty and differs from the new value (verified: `core.Record.Original()` exists and returns the pre-change persisted snapshot — confirmed directly against the vendored PocketBase v0.27.0 source, not assumed). Then apply §4's validation gate — `ValidateWorkspaceConfig` when the provider requires a credential and a key is present, plus the reject-provider-with-no-model rule — and reject with a structured `apis.NewBadRequestError` carrying the classified `Kind` on failure; this call is identical regardless of which provider was chosen. On success, call `e.Next()` then `llm.SetWorkspaceConfig(...)` to push the change live — same "mutate/validate before `Next()`, side-effect after" shape as `internal/ingest/batch.go`'s existing hook.
- Partial-PATCH semantics are safe: a PATCH that omits `provider` leaves `e.Record.GetString("provider")` equal to the original value, so the immutability check produces no false rejection. `Read(e.Record)` sees the merged (original + submitted) state, which is what validation should test.
- Verified: returning a custom `*ApiError` from inside these hooks propagates untouched to the HTTP response rather than being flattened to a generic message — `recordUpdate` wraps `form.Submit()`'s error in `firstApiError(err, e.BadRequestError(...))`, and `firstApiError` returns the error as-is when it's already an `*ApiError` (direct type assert, then `errors.As` for wrapped ones).

## 6. Error propagation to the 5 generation call sites

No changes needed to `internal/usage/stream.go` — `Stream`/`GenerateOnce` already pass errors through unwrapped, so a `*llm.ProviderError` reaches every caller intact.

New shared helper `internal/usage/provider_errors.go`: `WriteProviderError(e *core.RequestEvent, err error) bool` — `errors.As`-checks for `*llm.ProviderError`, writes a structured JSON response and returns whether it handled it, mirroring the existing `errors.Is(err, usage.ErrExhausted)` branch shape already present at every call site (verified in `chat.go:71-77`). Generic name/shape — works unchanged for any future provider's classified errors.

**Do not use HTTP 401 for a provider auth failure.** 401 on a PocketBase endpoint conventionally means "your PocketBase session is invalid"; the PB JS SDK and typical app-level interceptors treat it as session expiry and may clear the auth token or bounce the user to re-auth — when the actual problem is a bad *Gemini* key, and the PocketBase session is perfectly fine. Use a status that can't be confused with session auth and let the `error` code string be the real discriminator:

| Kind | Status | `error` code |
|---|---|---|
| `auth` | 409 Conflict | `provider_auth_failed` |
| `quota` | 429 | `provider_quota_exceeded` |
| `transient` | 502 | `provider_transient` |
| `other` | 502 | `provider_error` |

429 for provider quota stays distinct from the existing Kalaido-quota path, which returns 402 (`usage.WriteExhausted`) — the two are different conditions and should not collapse.

## 6a. `/api/llm/preflight` must become workspace-config aware

`internal/handlers/preflight.go` is **broken for BYOK workspaces as written** and is not optional to fix — it would report a fully working BYOK workspace as broken on all 5 roles. Three separate causes, all on the legacy global path:

- `llm.ModelFor(set, role)` (line 21) reads the static `activeSet` table, ignoring workspace config entirely — reports `gemma4` for a Gemini BYOK workspace.
- `llm.ProviderFor(model)` (line 30) is a lookup in the static `providerByModel` map, so it **errors on any free-text model name** — and the spec explicitly allows free-text model entry. Note this is also precisely why the main dispatch path is unaffected: the §2 factory switches on `cfg.Provider` and never calls `ProviderFor`, so free-text models work everywhere except here.
- `os.Getenv(llm.CredentialEnv(provider))` (line 39) checks the process environment, but a BYOK key lives in the DB — so it reports "GEMINI_API_KEY is not set" for a working workspace.

Fix: resolve model via `llm.ResolveRole(role)` (which already honours workspace config after §2), take the provider from `ActiveWorkspaceConfig().Provider` when set (falling back to `ProviderFor` only on the legacy path), and treat the credential as satisfied when the workspace config carries a non-empty `api_key`, checking the env var only on the legacy path.

Severity note: `grep` finds **zero frontend references to `/api/llm/preflight`** today, so this is currently latent rather than user-visible — but it's exactly the endpoint a BYOK settings/readiness UI would reach for, so it must be correct before the UI plan lands.

Traced (not assumed) sync/async nature of each site:
- **Chat** (`internal/handlers/chat.go`), **refinement** (`internal/handlers/refinement_chat.go`), **projection/reflection snapshot** (`internal/engine/snapshot.go`, called from `internal/handlers/synthesis.go`'s synchronous handler), **lens distillation** (`internal/engine/lens.go`, called from `internal/engine/lifecycle.go`'s `CommitRefinement`, itself called from `internal/handlers/refinements.go`'s synchronous handler) — all four are synchronous HTTP request handlers. Insert `usage.WriteProviderError(e, err)` right alongside the existing `errors.Is(err, usage.ErrExhausted)` check at each site.
- **Colour scoring, synchronous path** (`internal/handlers/colour.go`'s `HandlePreviewColour`, SSE-streamed, headers already committed by the time any single evaluation completes) — minimal-diff: keep the existing swallow-and-log-per-fragment behavior, just enrich the log line with the classified `Kind` via `errors.As` for diagnostics. A named SSE error event is a possible future enhancement, not required by any acceptance criterion.
- **Colour scoring, background worker** (`internal/colour/worker.go`'s `evaluateTask` — confirmed async, queue-driven): follow the existing `internal/ingest` status/error-field convention using the new `colour.last_provider_error_kind` field — set it on `auth`/`quota` classified failures (durable, actionable), clear it on next success; leave `transient`/`other` unmarked since the next queued fragment retries organically.

## 7. Backward compatibility (hard constraint, verified both directions)

- **Pre-existing local workspaces**: new columns added with empty defaults; `provider == ""` ⇒ `WorkspaceConfig{}` zero value ⇒ `ResolveRole`/`SelectedProvider` take the untouched legacy branch (`ModelFor(activeSet, r)` / `llm.ProviderFor(model)` + env key). No behavior change until a workspace explicitly sets `provider` through the new update-and-validate path.
- **Cloud/managed backend** (same binary, deployed elsewhere with `KALAIDO_MODEL_SET=cloud` + env `GEMINI_API_KEY`, out of this repo): never touches the new fields ⇒ same zero-value fallback ⇒ `gemini.Provider{APIKey: ""}` falls back to `os.Getenv("GEMINI_API_KEY")` exactly as today. Structurally can't be reached anyway — cloud-storage workspaces never run this local sidecar binary at all.

## Critical files

- `kalaidoscope/migrations/1748000000_init_schema.go` — extend `tableDef` with per-op disable flags; add generic new fields directly to the `kalaidoscope_config` and `colour` schema entries.
- `kalaidoscope/llm/selector.go` — `WorkspaceConfig`, widened factory signature, `SelectedProviderForConfig`.
- `kalaidoscope/llm/registry.go` — add `RequiresCredential(ProviderID) bool`, backed by the existing `credentialEnv` table.
- `kalaidoscope/llm/errors.go` — new; shared `ProviderError`/`ErrorKind`, provider-agnostic.
- `kalaidoscope/internal/handlers/preflight.go` — make workspace-config aware (§6a); currently reports BYOK workspaces as broken.
- `kalaidoscope/gemini/gemini.go` — `APIKey` field, constructs `llm.ProviderError` on failure.
- `kalaidoscope/internal/config/validate.go` — new; live validator, provider-agnostic (imports only `llm`).
- `kalaidoscope/internal/config/hooks.go` — new; immutability + validation hook.
- `kalaidoscope/internal/config/` — new `LoadAtBoot` for boot-time seeding.
- `kalaidoscope/cmd/sidecar/main.go` — wire `LoadAtBoot`, widen `SetProviderFactory` closure (the one place a new provider gets registered).
- `kalaidoscope/internal/usage/provider_errors.go` — new; `WriteProviderError` helper, provider-agnostic.
- `kalaidoscope/server/server.go` — register `config.RegisterHooks(app)`.
- Call sites updated: `internal/handlers/chat.go`, `refinement_chat.go`, `synthesis.go`, `refinements.go`, `internal/colour/worker.go`.

## As-built notes (implemented 2026-08-14)

Two things only showed up once this was running against the real API, and both change the contract the UI codes against.

**Gemini reports a bad key as HTTP 400, not 401.** The response is `400 INVALID_ARGUMENT` with `error.details[].reason == "API_KEY_INVALID"`. Classifying on status alone therefore filed a dead credential under `other` — losing exactly the distinction the spec asks for. `gemini/errors.go` now classifies on the response body (reason, then `error.status`) and falls back to status only when the body doesn't say. A provider whose failure modes aren't visible in its status line needs the same treatment.

**PocketBase destroys error data it can't read.** Anything passed as `errData` that isn't a `SafeErrorItem` is rewritten to `{"code":"validation_invalid_value","message":"Invalid value."}`, so the first cut silently lost the classification. Payloads must be `validation.NewError(code, message)`.

Resulting API contract:

| Case | HTTP | Where to read it |
|---|---|---|
| Config save, bad credential | 400 | `data.api_key.code` = `provider_auth` \| `provider_quota` \| `provider_transient` \| `provider_other` |
| Config save, provider switch attempt | 400 | `data.provider.code` = `provider_immutable` |
| Config save, provider with no model | 400 | `data.default_model.code` = `model_required` |
| Config save, non-superuser touching `model_set` | 403 | — |
| Generation call, provider failure | 409 auth / 429 quota / 502 transient | body `error` = `provider_auth_failed` \| `provider_quota_exceeded` \| `provider_transient`; `kind` carries the raw classification |
| `POST /api/llm/validate` | 200 even on failure | `{ok, kind, provider, model, detail}` — a failed test is a successful request |

`POST /api/llm/validate` takes `{provider, apiKey, defaultModel, roleModels?}` and persists nothing. Note the request body is camelCase (a DTO) while the config record fields are snake_case (PocketBase columns).

Not verified against a real key: only the failure paths were exercised end-to-end, since that needs a live Gemini credential. The success path is covered by the Ollama provider (persistence, immutability, preflight, boot reload) and by unit tests.

## Verification

- `go build ./...` and `go test ./...` in `kalaidoscope/` after each change.
- Fresh workspace: start sidecar against an empty `--dir`, confirm `kalaidoscope_config` seeds with empty `provider` and existing Ollama-path chat/refinement/etc. still work unchanged (regression check for backward compat).
- BYOK path: `PATCH` the singleton `kalaidoscope_config` record with `provider=gemini` + a real (or deliberately invalid) API key + model via the seeded user's auth token (same token Tauri already captures via `KALAIDO_USER_TOKEN`), confirm: invalid key is rejected with a structured error and NOT persisted; valid key persists and immediately (no restart) routes chat/refinement/colour/etc. through Gemini with that key.
- Attempt a second `PATCH` changing `provider` after it's set — confirm rejected.
- Attempt a `PATCH` touching `model_set` as a non-superuser — confirm rejected.
- Attempt a `PATCH` setting `provider=gemini` with no `default_model` and no `role_models` — confirm rejected (rather than saving a config that fails every subsequent generation).
- Set a **free-text** model name (one absent from `providerByModel`) and confirm all 5 roles still dispatch correctly — this is the case that breaks the static-table lookups.
- `GET /api/llm/preflight` on a working BYOK workspace — confirm it reports all 5 roles OK (before §6a it reports all 5 broken), and still behaves as today on a legacy/env workspace.
- Confirm a provider auth failure does **not** return HTTP 401 and does not disturb the PocketBase session.
- Simulate a revoked key (or use an actually-invalid one) against a live generation call on each of the 5 roles — confirm each surfaces a classified error (HTTP response for the 4 synchronous sites; `colour.last_provider_error_kind` field for the background worker path).
- Time a config PATCH that changes only the key with 5 distinct per-role models — confirm it completes under the overall validation deadline rather than serialising 5 timeouts.
