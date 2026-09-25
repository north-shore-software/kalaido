# LLM Queue & Quota — Generated Audit Snapshot

> **Generated:** 2026-09-25, from source at commit `1c94d69`.
> This file is a generated audit snapshot — do not edit it. See `AGENTS.md` § "Generated audit docs". When code described here changes, a stale marker line is prepended above this block; nothing else in the file is ever modified by hand.

**Scope.** What happens to every outbound model call between the caller and the provider: the single call path, the scheduler (priorities, admission, rate spacing, idle gating, re-ordering, preemption and what a preempted caller does, throttle back-off, progress), the status it publishes and the held reason it reports, per-call usage recording and the period quota with its exhaustion response, how provider failures are classified and returned on the wire, the request/failure logging both providers emit, and the shared HTTP transport. Which model a call uses is `models.md`; the callers are the flow and lifecycle docs; the prompt-size guard that refuses a call before it reaches this path is `context.md` § 6.

**Completeness anchor.** One provider entry point, `usage.stream`, behind 6 exported wrappers (`Stream`, `GenerateOnce`, `GenerateOnceMsgs`, `GenerateOnceMsgsThrottled`, `GenerateStreamMsgs`, `GenerateWithToolCalls`) reached from 15 call sites; one scheduler per app (stored under `usage.SchedulerStoreKey`) with 3 schedulable priorities, 5 held reasons and 5 `queue.WithPriority` sites; one quota `Authorizer` slot (`quota.Set`), **never set** in this binary; 4 provider error kinds; 1 status collection (`llm_queue_status`); 1 usage collection (`usage`); 3 `WriteProviderError` and 3 `WriteExhausted` call sites; 2 `Reconfigure` sites; 2 `RetryThrottled` callers; 6 `httpx` client construction sites.

---

## 1. The single call path

Every model call — explore turn and summaries rounds, refinement turn, its name-only continuation and its lens compile, refinement apply, snapshot, delta/merge, colour judge and preview, annotate, consolidate, discover, explore brief — goes through `usage.stream` (`internal/usage/stream.go`):

1. **Quota check** `Authorized(ctx, app)`: returns `ErrExhausted` when the installed `quota.Authorizer` reports `Allowed == false`. No authorizer is installed anywhere in this binary (`quota.Set` has no caller; `quota.Get` returns nil), so this check **always passes** and `ErrExhausted` is never produced; every `ErrExhausted` branch in handlers and workers (§ 4, § 5) is unreachable in this build.
2. Empty model → error `usage: no model resolved for role "<role>"`.
3. **Admission** `Acquire` on the app's scheduler (`SchedulerForApp`: the `*queue.Scheduler` stored in `app.Store()` under `kalaido.llm.queue.scheduler`, else `queue.Default()`), with priority = the context's `WithPriority` value, else `DefaultPriorityForRole(role)` (§ 2.1); blocks until admitted or the caller's context ends (the context error is returned; nothing is recorded).
4. The provider built by `llm.SelectedProvider(model)` has its `Stream` invoked under the **run context** the scheduler returned, with `llm.OptionsForRole(role)` — `Temperature: 0` for `snapshot`, `colour`, `map`, `annotate`; nil (provider default, omitted from the request) for `chat` and `refinement`. A synchronous failure releases the slot and is returned as-is; when it is a `ProviderError` of kind `quota` or `transient`, `ReportThrottled` (§ 2.5) is called first. `SelectedProvider` panics when no provider descriptor has been registered, and returns an `ErrorProvider` (whose `Stream` returns the stored plain error) when the model has no provider or the configured provider is not registered.
5. The event channel is wrapped: the slot is held until the provider's stream **fully drains** (release runs when the provider closes its channel); streamed characters (`len(Text) + len(Args)` per event) are reported to the scheduler as `chars / 4` token progress, incrementally, as the estimate grows; once the channel closes, `Record` (§ 5) runs with `comp.Wait()`'s usage under the caller's original context. Failures after the 2xx are never surfaced as errors by either provider — a malformed chunk is skipped and the channel simply closes. The wrapped channel is unbuffered, so the slot is released only once the consumer has read every event.

Exceptions that reach a provider without this path: config validation (`config.ValidateModels` → one `SelectedProviderForConfig(...).Stream` per model to test, in parallel, with `prompts.ValidationPing` as the single user message, `GenOptions{}`, and a 20 s deadline over the whole pass, drained and discarded; the earliest-listed failing model's error wins — `models.md` § 4) and the Ollama preload (`PreloadModel` → `/api/generate`, retried every 5 s for up to 2 min from an `OnServe` goroutine — `models.md` § 7). Neither is admitted, throttled, or recorded.

**Wrappers.** `Stream` returns the wrapped `Completion` directly (used by the explore turn, summaries rounds, the refinement turn and its name-only continuation; the SSE relays whatever arrives and persists it — `explore.md` § 6). `GenerateOnce` builds a single user message and delegates to `GenerateOnceMsgs`, which concatenates `EventText` and ignores tool events. `GenerateOnceMsgsThrottled` is `GenerateOnceMsgs` inside `RetryThrottled` (§ 4). `GenerateStreamMsgs` is `GenerateOnceMsgs` with each text delta additionally forwarded through `onDelta` **as it arrives** (the refinement apply leg); no tools are passed. `GenerateWithToolCalls` concatenates text and collects every `EventToolEnd` into `ToolCall{ID, Name, Args}`; `EventToolStart`/`EventToolArgDelta` are dropped.

**Truncation guards** in the three collecting wrappers (`GenerateOnceMsgs`, `GenerateStreamMsgs`, `GenerateWithToolCalls`), applied after the channel drains: if the run context's cancellation cause is `ErrPreempted`, the partial text is discarded and `ErrPreempted` returned; else if the caller's context has ended, `stream interrupted: <cause>` is returned instead of the partial text. `Stream` has neither check; its consumers see an early channel close.

## 2. The scheduler (`llm/queue`)

One `Scheduler` per server runtime: `newRuntime` constructs `queue.New(ConfigForProvider(ActiveProviderID()))` and stores it in `app.Store()` under `usage.SchedulerStoreKey`; `usage.stream` resolves that instance. `queue.Default()` (`std`, Ollama configuration) is the fallback only when the app is nil or carries no scheduler — isolated unit tests. The runtime's scheduler is reconfigured at two sites to `ConfigForProvider(ActiveProviderID())`: in an `OnServe` handler bound after `registerQueueStatus` that runs after `se.Next()` (so model-set resolution and the workspace config load, registered later by `main`, have run — `boot-and-workers.md` § 1), and in the `OnRecordUpdate` hook on `kalaidoscope_config`, after `e.Next()` has written the row and `llm.SetWorkspaceConfig` has been applied (`config.RegisterHooks` — `models.md` § 3). `ActiveProviderID` is the workspace's configured provider, else the provider of the active model set's chat model, else `ollama`.

### 2.1 Priorities

`Interactive` (1) < `Background` (2) < `Idle` (3); numerically lower runs first. `PreemptNone` (0, string `none`) is a configuration value only and never a request priority. Priorities marshal to JSON as their names (`interactive`, `background`, `idle`). Role defaults (`DefaultPriorityForRole`): `map`, `annotate` → Background; `colour` → Idle; every other role (`chat`, `refinement`, `snapshot`) → Interactive. Callers override per context with `WithPriority`; `PriorityFromContext` reads it (§ 3 lists the sites).

### 2.2 Configuration per provider

| | `ollama` | any other provider |
|---|---|---|
| `MaxConcurrent` | 1 | 100 |
| `MinStartInterval` | 0 | 0 |
| `IdleAfter` | 5 min | 1 min |
| `PreemptAtOrBelow` | Background (Background and Idle tasks may be cancelled) | `PreemptNone` |

`MaxConcurrent < 1` is clamped to 1 in both `New` and `Reconfigure`. `Reconfigure` replaces the config at once, zeroes the high-water mark and its timestamp, and re-runs dispatch; a lowered cap takes effect as running calls finish. Because `ActiveProviderID` falls back to `ollama`, the strictest shape is also the fallback.

### 2.3 Admission (`Acquire` / `dispatchLocked`)

`Acquire` returns the context's error immediately if it is already done. Otherwise the waiter is appended with a monotonically increasing sequence number and the queue is stably sorted by (priority, sequence) — a higher-priority arrival is **re-ordered** ahead of earlier lower-priority waiters; a non-Idle arrival stamps `lastNonIdle = now` whether or not it is ever admitted. Dispatch then runs and, on every subsequent state change, examines the head waiter repeatedly:

0. If the high-water mark is older than 10 min, it is reset to the current running count.
1. A **non-Interactive** head is held while a throttle back-off window is open (§ 2.5).
2. An **Idle** head is held while any non-Idle task runs, and until `IdleAfter` has elapsed since `lastNonIdle` (set by non-Idle arrival, admission and completion alike). At process start `lastNonIdle` is the zero time, so before any non-Idle activity the quiet period counts as already elapsed.
3. If the running count is at `MaxConcurrent`, admission stops; if the head is Interactive, preemption is attempted first (§ 2.4).
4. **Rate spacing** applies only when growing past the high-water mark (`running >= highWaterMark`): if `MinStartInterval > 0` and a previous start exists within that interval, wait. Backfilling below the mark is never spaced. With both shipped configurations `MinStartInterval` is 0, so spacing never applies.
5. Admit: the head is removed, a child context with cancel-cause is derived from the waiter's context, the task is appended to `running`, a non-Idle admission stamps `lastNonIdle`, and the waiter's channel is closed. When the admission grew the peak, the mark becomes the new running count and `lastStart = now`; when it merely restored the mark, only the mark's timestamp is refreshed.

A single timer is re-armed each dispatch for the earliest time-based condition (back-off end, idle quiet end, next allowed start); its firing re-runs dispatch. `release` is idempotent (`sync.Once`): it cancels the run context with cause `context.Canceled` (a sticky earlier `ErrPreempted` cause survives), removes the task, stamps `lastNonIdle` for a non-Idle task, and re-dispatches. A waiter whose own context ends while queued is removed and dispatch re-runs; if dispatch admitted it in the same instant, `release` is called for it immediately and the context error is still returned.

### 2.4 Preemption

Only when `PreemptAtOrBelow != PreemptNone` (the Ollama configuration), and only from step 3 above — an Interactive head finding the cap full. `needed` = the number of Interactive waiters (capped at `MaxConcurrent`) minus free slots minus tasks already marked `preempting`. For each unit needed, one running task with priority ≥ `PreemptAtOrBelow` and not already preempting is cancelled with cause `ErrPreempted`: lowest priority first, and among equals the **most recently started**. If no candidate remains, preemption stops short. The victim's slot frees only when its owner's stream drains and `release` runs.

**What a preempted caller does.** The provider aborts on the cancelled run context and closes its channel; the collecting wrappers see the `ErrPreempted` cause and return it in place of the partial text (§ 1). The owner re-enters `Acquire` and waits its turn: `RetryThrottled` re-runs the call immediately and indefinitely; the colour judge, `GenerateWindows` and the reconcile wave each loop on it; `engine.GenerateSnapshot` propagates it from the delta/merge continuation so the caller retries the whole generation (§ 4). Nothing produced before the preemption is persisted. Only Background and Idle tasks can be victims, and every request handler runs Interactive (§ 3), so a handler never observes `ErrPreempted`.

### 2.5 Throttle back-off

`ReportThrottled` is called only from `usage.stream`, on a synchronous provider failure of kind `quota` or `transient`. It sets the back-off step to 2 s on the first report or when more than 120 s have passed since the previous report; otherwise it doubles the step, capped at 60 s. `backoffUntil = now + step`. The high-water mark is reset to the current running count (growth must re-earn itself), and dispatch re-runs. While `now < backoffUntil`, every non-Interactive head is held (§ 2.3 step 1); Interactive work is never held by back-off. Mid-stream failures never reach this path (§ 1 step 5).

### 2.6 Status and the held reason

`Status{Version (json:"-"), running: [TaskInfo], waiting: {priorityName: count} (omitempty), held (omitempty)}`. `TaskInfo{role, priority, model, started, tokens (omitempty), tokens_per_second (omitempty)}`: `tokens` is the char/4 estimate accumulated by `AddProgress`; `tokens_per_second` = tokens over the whole elapsed time since start, present only once more than 0.5 s has elapsed and tokens > 0. `waiting` and `held` are populated only while something waits; `held` describes why the **head** waiter is not running, in the admission order:

| `reason` | When | `until` |
|---|---|---|
| `backoff` | head is non-Interactive and a back-off window is open | end of the window |
| `idle_blocked` | head is Idle and a non-Idle task is running | — |
| `idle_quiet` | head is Idle and `IdleAfter` has not elapsed since `lastNonIdle` | when it will have |
| `capacity` | running count is at `MaxConcurrent` | — |
| `rate_spacing` | at or above the high-water mark, `MinStartInterval > 0`, and the last start is within it | the next allowed start |

When none applies, `held` is nil. `waiting` keys are `interactive`, `background`, `idle`. With both shipped configurations `rate_spacing` cannot occur.

**Publication.** Every dispatch (each `Acquire`, `release`, `Reconfigure`, `ReportThrottled`, waiter withdrawal, timer wake) increments `Version` and delivers the snapshot to the `SetOnChange` callback **in a new goroutine**; `AddProgress` publishes at most once per 500 ms (its counter still accumulates on every call). Without a callback neither the increment nor the delivery happens. `Snapshot()` exists but has no caller in this binary.

`server/queue_status.go` (`registerQueueStatus`, bound in `NewWithSchemaWithOptions`) is the only subscriber. In `OnServe` it writes an **empty** status first (running `[]`, waiting `{}`, held `null`, state `idle`), creating the row if the collection has none, then subscribes; `OnTerminate` unsubscribes (`SetOnChange(nil)`) and stops the mirror so no later flush writes. A delivery whose `Version` is not greater than the last accepted one, or arriving after stop, is discarded; otherwise it becomes the latest and, if no flush is pending, a flush is armed 300 ms out — later deliveries inside that window only replace the latest snapshot. Each write sets the first `llm_queue_status` row's `state` (`active` when anything runs or waits, else `idle`) and `running`, `waiting`, `held` as JSON strings; a missing collection or failed save is logged (`queue status collection unavailable` / `queue status save failed`) and dropped. The collection is server-written (`DisableWriteOperations`: create/update/delete rules nil; list/view require an authenticated user — `schema.md` § 2.15), and its statements are excluded from the SQL write echo (`writeEchoSkip`).

## 3. Priority overrides in use

| Caller | Wrapper / role | Context | Priority |
|---|---|---|---|
| Explore turn, summaries-mode rounds (`explore/turn.go`, `explore/summaries.go`) | `Stream` / chat | request | Interactive (default) |
| Refinement turn and its name-only continuation (`refinement/chat.go`) | `Stream` / refinement | request | Interactive (default) |
| Refinement lens compile on an `update_lens` call (`refinement.CompileLens`) | `GenerateOnceMsgs` / refinement | request | Interactive (default) |
| Refinement apply leg (`refinement.ApplyDraftLens`) | `GenerateStreamMsgs` / snapshot | request | Interactive (default) |
| Generate routes: `engine.GenerateOrJoin` / `reflections.GenerateWindows` → `GenerateSnapshot`, delta and merge (`engine/snapshot.go`) | `GenerateOnce`, `GenerateOnceMsgs` / snapshot | `context.WithoutCancel(request)` | Interactive (default) |
| Explore brief (`explore.GenerateBrief`) | `GenerateWithToolCalls` / chat | request | Interactive (explicit override, same as default) |
| Colour preview (`PreviewSession.Run`) | `GenerateOnce` / colour | request | **Interactive (override)** |
| Colour worker `judge` | `GenerateOnce` / colour | worker | Idle (default) |
| Annotate worker and consolidate (`mapping.generate`) | `GenerateOnceMsgsThrottled` / annotate, map | worker | Background (default) |
| Discover runs (`discover.runLoop`, via `RetryThrottled`) | `GenerateWithToolCalls` / map | worker | Background (explicit override, same as default) |
| Reconcile wave (`runWaveWithWorker`) | via `engine.GenerateSnapshot` / snapshot | worker + generation trigger | **Background (override)** |
| Reflection pending-window pass (`reflections.GeneratePendingWindows`) | via `GenerateWindows` / snapshot | detached runner | **Background (override)** |

The five `WithPriority` sites are the explore brief, the colour preview, the discover flow, the reconcile wave and the pending-window pass.

## 4. Retry postures

- **`usage.RetryThrottled(ctx, f)`** — the shared background retry (`internal/usage/retry.go`), used by `GenerateOnceMsgsThrottled` (annotate and consolidate — `map.md` § 2, § 3.3) and directly by the discover tool loop's `Generate` (`discover.md` § 3). Before each attempt a dead `ctx` is a permanent failure. `ErrPreempted` is retried immediately and indefinitely inside the attempt. Success ends it. A `ProviderError` of kind `quota` or `transient` is retried with the `cenkalti/backoff` exponential policy: initial interval 2 s, per-gap cap 1 min, giving up once 3 min have elapsed (growth factor and jitter are the library defaults); the wait between attempts ends early when `ctx` ends; after the budget the last provider error is returned. Every other error — `ErrExhausted`, `auth`, `other`, parse failures — is permanent and returned at once. The scheduler's back-off (§ 2.5) additionally spaces the re-admissions.
- **Colour worker `judge`** — loops on `ErrPreempted` only; every other error is returned to `drainColour`, which stamps `last_provider_error_kind` when the error is an `auth`/`quota` `ProviderError` and the stored kind differs (any other error leaves the marker as it was — `colours.md` § 4.2) and stops that colour. Each successful judgment clears a non-empty marker. The drain over colours stops entirely on `ErrExhausted`; any other colour's error is remembered as the first error and the next colour is still drained.
- **`reflections.GenerateWindows`** — each window's goroutine loops on `ErrPreempted`; other errors are returned per window in `WindowResult`.
- **Reconcile wave** — per window, loops on `ErrPreempted`; `ErrLensNotReady` / `ErrGenerationInFlight` skip the entity; any other error ends the wave. At wave level, `ErrExhausted` is logged (`wave quota exhausted; not retrying`) and not retried; `context.Canceled` is not retried; any other error schedules a retry after 1 min, then 5 min, then 15 min for every later consecutive failure (`reconcile.md` § 5).
- **`engine.GenerateSnapshot`** — an `ErrPreempted` from the delta/merge continuation is propagated so the caller retries the whole generation; a cancelled context aborts without persisting (`minimal-diff rewrite: <cause>`); any other delta/merge failure is logged (`minimal-diff rewrite failed, keeping raw candidate`) and the raw candidate is kept.
- **Request handlers** — never retry. Preemption only cancels tasks at or below `PreemptAtOrBelow` (Background), and every handler call is Interactive (§ 3), so `ErrPreempted` cannot reach a handler.
- **Mapping re-prompts** — an unparseable annotate or consolidate reply gets one further call with a JSON nudge appended; this is a fresh call through `GenerateOnceMsgsThrottled`, not an error retry (`map.md` § 2, § 3.3).
- **`ErrExhausted` in workers** — the annotate drain records the failure, sets an exhausted flag that stops further fragments from being launched, and leaves the batch loop after the current wave of goroutines; the colour worker stops draining all remaining colours; discover receives it as a permanent `RetryThrottled` failure and it becomes the run's error (`status` `error`). All unreachable in this build (§ 1 step 1).

## 5. Usage recording and quota

`usage.Setup` binds an `OnServe` handler that fails boot (`usage.Setup: …`) unless the `usage` collection exists and carries a single-column **unique** index on `period`.

`quota.PeriodKey(t)` = UTC `YYYY-MM` of `t`. `Record(ctx, app, usage)`: a no-op when usage is nil or `TotalTokens == 0`. Otherwise, in a transaction attempted at most twice, the current period's `usage` row is found or created and `prompt_tokens`, `completion_tokens`, `total_tokens`, `cached_tokens` are each incremented by the call's counts (`TokensPerSecond`, `Provider` and `Model` are not stored). A second failure is logged (`record usage failed`, with `period` and `error`) and dropped. The installed `Authorizer.Record` is then called with `TotalTokens` — none is installed. `Record` runs only from the wrapped-stream goroutine after the provider's channel closes, so it also runs for a call whose caller has gone away, provided the provider reported usage.

What each provider reports: **Ollama** fills usage only from the chunk with `done: true` (`prompt_eval_count`, `eval_count`, total = their sum, `cached_tokens` 0, tokens/s from `eval_count` over `eval_duration`); a stream cut short by cancellation before that chunk yields nil and records nothing. **Gemini** keeps the latest cumulative `usageMetadata` (`promptTokenCount`, `candidatesTokenCount`, `totalTokenCount`, `cachedContentTokenCount`; tokens/s never set) and reports it whenever the SSE read loop ends — on `[DONE]`, on end of body, or when a cancelled request's body read fails part-way — provided at least one `usageMetadata` chunk was seen; a cancellation observed while blocked delivering an event (the `ctx.Done` arm of the send) returns nil, as does a stream that never carried `usageMetadata`.

`WriteExhausted` → `402 {error: "quota_exhausted", period, used}`, where `used` is the current period's `total_tokens` (0 when no row). Direct call sites (3): the explore turn handler, the refinement chat handler (both refinement chat routes), and `handlers.WriteLLMError`, which the explore brief route and `WriteGenerateError` (the projection generate route, and both error branches of the reflection generate route) go through. The refinement apply leg instead reports it as a `quota_exhausted` turn error on the SSE stream (`refinement.md` § 3.1). All unreachable while no authorizer is installed.

The `usage` collection: `period` (required text), four number counters, `created`/`updated`; unique index `idx_usage_period`; readable by any authenticated user, no client writes (`schema.md` § 2.14).

## 6. Provider error classification and envelopes

`llm.ProviderError{Provider, Kind, StatusCode, Model, Body}`; kinds `auth`, `quota`, `transient`, `other`. `Error()` renders `<provider>: <kind> (HTTP <n>, model "<m>"): <body>`, or `<provider>: <kind> (model "<m>"): <body>` when `StatusCode` is 0. `llm.ClassifyStatus`: 401 and 403 → `auth`; 429 → `quota`; ≥ 500 → `transient`; anything else → `other`.

**Where each provider produces one** (`models.md` § 6 for the providers themselves):

| Provider | Condition | Kind / `StatusCode` |
|---|---|---|
| Gemini | workspace key empty and `GEMINI_API_KEY` unset (checked before the model, before any request) | `auth` / 0 |
| Gemini | transport error with the request context still live | `transient` / 0 |
| Gemini | response outside 200–299 (body read up to 4096 bytes, trimmed) | body-first `classify`, then `ClassifyStatus` |
| Ollama | transport error with the request context still live | `transient` / 0 |
| Ollama | response other than 200 (body read up to 4096 bytes, trimmed) | `ClassifyStatus(status)` |

Gemini's body-first `classify`: any `error.details[].reason` of `API_KEY_INVALID`, `API_KEY_SERVICE_BLOCKED`, `ACCOUNT_STATE_INVALID`, `SERVICE_DISABLED` → `auth`; else `error.status` `UNAUTHENTICATED` / `PERMISSION_DENIED` → `auth`, `RESOURCE_EXHAUSTED` → `quota`, `UNAVAILABLE` / `DEADLINE_EXCEEDED` / `INTERNAL` → `transient`; an unparseable body or any other status falls through to `ClassifyStatus`. Not `ProviderError`s: a transport error when the request context is already cancelled (the context error is returned unclassified), Gemini's `gemini: no model set`, request-marshal and request-construction errors of either provider, and the `ErrorProvider` errors (`llm: no provider registered for model …` / `llm: provider "<id>" not registered`) — these reach handlers as plain errors and take their generic 500 branch.

`usage.WriteProviderError(e, err)` returns false (nothing written) unless `err` unwraps to a `ProviderError`. Otherwise it logs `provider error surfaced to client` with `method`, `path` and `error`, and writes:

| Kind | HTTP | `error` |
|---|---|---|
| auth | 409 | `provider_auth_failed` |
| quota | 429 | `provider_quota_exceeded` |
| transient | 502 | `provider_transient` |
| other | 502 | `provider_error` |

Body `{error, kind, provider, model, detail}` with `detail` = `Error()`. 401 is never used. Direct call sites (3): the explore turn handler, the refinement chat handler, and `WriteLLMError` — which first checks `ErrExhausted`, then this, then answers a `ContextTooLargeError` with 422 (`context.md` § 6) — reached from the explore brief route and, via `WriteGenerateError`, the projection generate route and both error branches of the reflection generate route. Each is tried before the handler's generic 500. Other consumers of the kind: the colour worker's `last_provider_error_kind` marker, set for `auth`/`quota` only (§ 4; `colours.md` § 4.2); the validate route, which returns 200 `{ok: false, kind, provider, model, detail}` (`models.md` § 4); the config update hook, which rejects with a 400 validation error keyed `api_key` and code `provider_<kind>` (`models.md` § 3); `RetryThrottled` (§ 4); and `ReportThrottled` (§ 2.5). Paths that swallow provider errors instead: the colour preview logs and drops each fragment's failure (silently when the request context is already cancelled — `colours.md` § 5); the refinement name-only continuation logs (`refinement continuation failed`) and returns an empty text; the refinement lens compile logs (`refinement chat: compile lens failed`) and the turn continues with the previous lens; summaries-mode rounds after the first send the error text as an SSE `error` event and end the turn (`explore.md` § 5); the refinement apply leg reports every non-quota, non-size failure as the `apply_failed` turn error (`refinement.md` § 3.1).

## 7. Provider call logging (trace and failure shape)

All lines are structured `slog` records; component `llm` for the shared helpers, `gemini`/`ollama` for the providers' own lines, `usage` for the route line. Both providers compute `llm.Shape(messages, tools, opts)` before every request: `messages=<n> (<role>:<count>/<chars>ch, … sorted by role) empty=<blank-content count> tools=[names] temp=<value|default>`.

- **Trace.** `llm.Trace` is set once at start-up from `KALAIDO_LLM_TRACE` (`config.parseBool`: `1`, `true`, `yes`, `on` → on; empty, `0`, `false`, `no`, `off` → off, case-insensitive and trimmed; any other value fails boot with `KALAIDO_LLM_TRACE: unparseable boolean value`; not reconfigurable). When on, `llm.LogRequest` writes an Info `trace request` with `provider`, `model`, `url` and `body` = the full JSON request body — the complete message content included — immediately before each request. Gemini's URL is `…/models/<m>:streamGenerateContent?alt=sse` (the key travels in the `x-goog-api-key` header and is not logged); Ollama's is `<Base>/api/chat`. Off by default, nothing is logged here.
- **Failure shape.** `llm.LogFailure` is **always** written on both synchronous failure paths of both providers — transport error (`status="no response"`, `body` = the error text) and non-success status (`status="HTTP <n>"`, `body` = the response body up to 4096 bytes, trimmed) — except a transport error with the request context already cancelled, which returns the context error without a line. It is one Error record `request failed` with `provider`, `status`, `model`, `shape`, `detail`, `body`. `detail` is `tier=<serviceTier> system_instruction=<chars>ch contents=<n> parts=<n> body=<bytes>B` for Gemini (`serviceTier` is the constant `priority`) and `num_ctx=<n> body=<bytes>B` for Ollama.
- **Gemini end-of-stream lines.** When usage was seen: a Debug `traffic type` with `traffic_type` (the last `usageMetadata.trafficType`) and `model`. Then, unless the request context has ended: when the stream ended with a finish reason other than `STOP`, carried a `promptFeedback.blockReason`, or delivered neither text nor a tool call, a Warn `completion ended` with `finish_reason` (`none` when absent, with `finishMessage` appended in parentheses), `block_reason` (`none` when absent, with `blockReasonMessage` appended in parentheses), `text_parts`, `tool_calls`, `completion_tokens`, `model`, `shape`, `detail`. Ollama writes no end-of-stream line.
- **Route line.** `WriteProviderError` adds the method and path of the request the failure surfaced on (§ 6). Validation calls (`models.md` § 4) use the same providers and therefore emit the same trace and failure lines.

## 8. The shared HTTP transport (`httpx`)

One `http.Transport` (`sharedTransport`): proxy from the environment, dial timeout 10 s with 30 s keep-alive, HTTP/2 attempted, 100 idle connections kept for 90 s, TLS handshake timeout 10 s, expect-continue timeout 1 s, response-header timeout 30 s. `streamingTransport` is a clone with the response-header timeout removed. Two constructors: `Streaming()` returns a client on the streaming transport with no overall timeout; `Short(d)` returns a client on the shared transport with an overall timeout of `d`. Six construction sites: Gemini `streamGenerateContent` (`Streaming`), Ollama `/api/chat` (`Streaming`), Ollama `/api/pull` (`Streaming`), Ollama `/api/show` (`Short(5 s)`, result cached per model for the process lifetime), Ollama `/api/tags` (`Short(5 s)`), Ollama `/api/generate` preload (`Short(5 min)`). Cancellation of a streaming call comes only from the request context — the run context the scheduler hands out (§ 1 step 4) — never from a transport deadline.
