# LLM Queue & Quota — Generated Audit Snapshot

> **Generated:** 2026-09-17, from source at commit `895984c`.
> This file is a generated audit snapshot — do not edit it. See `AGENTS.md` § "Generated audit docs". When code described here changes, a stale marker line is prepended above this block; nothing else in the file is ever modified by hand.

**Scope.** What happens to every outbound model call between the caller and the provider: the single call path, the scheduler (priorities, admission, rate spacing, idle gating, preemption, throttle back-off), the status it publishes and the held reason it reports, usage recording and the period quota, how provider failures are classified and returned on the wire, and the request/failure logging both providers emit. Which model a call uses is `models.md`; the callers are the flow and lifecycle docs.

**Completeness anchor.** One provider entry point, `usage.stream`, behind 5 exported wrappers (`Stream`, `GenerateOnce`, `GenerateOnceMsgs`, `GenerateStreamMsgs`, `GenerateWithToolCalls`) reached from 14 call sites; one scheduler instance (`llmq.std`) with 3 schedulable priorities and 5 held reasons; one quota `Authorizer` slot (`quota.Set`), **never set** in this binary; 4 provider error kinds; 1 status collection (`llm_queue_status`); 1 usage collection (`usage`); 6 `WriteProviderError` and 6 `WriteExhausted` call sites; 2 `llmq.Reconfigure` sites.

---

## 1. The single call path

Every model call — chat, refinement, refinement apply, snapshot, delta/merge, colour judge and preview, annotate, consolidate, discover, chat brief — goes through `usage.stream`:

1. **Quota check** `Authorized(ctx, app)`: returns `ErrExhausted` when the installed `quota.Authorizer` says `Allowed == false`. No authorizer is installed anywhere in this binary (`quota.Set` has no caller), so this check **always passes** and `ErrExhausted` is never produced; every `ErrExhausted` branch in handlers and workers (§ 4, § 5) is unreachable in this build.
2. Empty model → error `usage: no model resolved for role "<role>"`.
3. **Admission** `llmq.Acquire` with priority = the context's `WithPriority` value, else `DefaultPriorityForRole(role)` (§ 2.1); blocks until admitted or the caller's context ends (the context error is returned; nothing is recorded).
4. The provider built by `llm.SelectedProvider(model)` has its `Stream` invoked under the **run context** the scheduler returned, with `llm.OptionsForRole(role)` — `Temperature: 0` for `snapshot`, `colour`, `map`, `annotate`; provider default (nil) for `chat` and `refinement`. A synchronous failure releases the slot and is returned as-is; when it is a `ProviderError` of kind `quota` or `transient`, `llmq.ReportThrottled` (§ 2.5) is also called first.
5. The event channel is wrapped: the slot is held until the provider's stream **fully drains** (release runs when the provider closes its channel); streamed characters (`len(Text) + len(Args)` per event) are reported to the scheduler as `chars / 4` token progress, incrementally; once the channel closes, `Record` (§ 5) runs with `comp.Wait()`'s usage. Failures after the 2xx are never surfaced as errors by either provider — a malformed chunk is skipped and the channel simply closes.

Exceptions that reach a provider without this path: config validation (`config.ValidateConfig` → `llm.SelectedProviderForConfig(...).Stream` with `GenOptions{}`, drained and discarded — `models.md` § 4) and the Ollama preload (`PreloadModel` → `/api/generate` — `models.md` § 7). Neither is admitted, throttled, or recorded.

**Wrappers.** `Stream` returns the wrapped `Completion` directly (used by the chat, summaries and refinement handlers; the SSE relays whatever arrives and persists it — `chat.md` § 6). `GenerateOnce` builds a single user message and delegates to `GenerateOnceMsgs`, which concatenates `EventText` and ignores tool events. `GenerateStreamMsgs` is the same with each text delta additionally forwarded through `onDelta` **as it arrives** (the refinement apply leg). `GenerateWithToolCalls` concatenates text and collects every `EventToolEnd` into `ToolCall{ID, Name, Args}`; `EventToolStart`/`EventToolArgDelta` are dropped.

**Truncation guards** in the three collecting wrappers, applied after the channel drains: if the run context's cancellation cause is `ErrPreempted`, the partial text is discarded and `ErrPreempted` returned; else if the caller's context has ended, `stream interrupted: <cause>` is returned instead of the partial text. `Stream` has neither check.

## 2. The scheduler (`llmq`)

One process-wide `Scheduler` (`llmq.std`), constructed with the Ollama configuration and reconfigured at two sites to `ConfigForProvider(ActiveProviderID())`: in an `OnServe` handler that runs after the rest of the serve chain (so workspace config has been loaded — `boot-and-workers.md` § 1), and in the `OnRecordUpdate` hook on `kalaidoscope_config`, after `e.Next()` has written the row (`config.RegisterHooks` — `models.md` § 3).

### 2.1 Priorities

`Interactive` (1) < `Background` (2) < `Idle` (3); numerically lower runs first. `PreemptNone` (0, string `none`) is a configuration value only and never a request priority. Priorities marshal to JSON as their names. Role defaults: `map`, `annotate` → Background; `colour` → Idle; every other role (`chat`, `refinement`, `snapshot`) → Interactive. Callers override per context with `WithPriority`; `PriorityFromContext` reads it (§ 3 lists the sites).

### 2.2 Configuration per provider

| | `ollama` | any other provider |
|---|---|---|
| `MaxConcurrent` | 1 | 100 |
| `MinStartInterval` | 0 | 0 |
| `IdleAfter` | 5 min | 1 min |
| `PreemptAtOrBelow` | Background (Background and Idle tasks may be cancelled) | `PreemptNone` |

`MaxConcurrent < 1` is clamped to 1 in both `New` and `Reconfigure`. `Reconfigure` replaces the config at once, zeroes the high-water mark and its timestamp, and re-runs dispatch; a lowered cap takes effect as running calls finish. `ActiveProviderID` falls back to `ollama` when nothing resolves, so the strictest shape is also the fallback.

### 2.3 Admission (`Acquire` / `dispatchLocked`)

`Acquire` returns the context's error immediately if it is already done. Otherwise the waiter is appended with a monotonically increasing sequence number and the queue is stably sorted by (priority, sequence); a non-Idle arrival stamps `lastNonIdle = now`. Dispatch then runs and, on every subsequent state change, examines the head waiter repeatedly:

0. If the high-water mark is older than 10 min, it is reset to the current running count.
1. A **non-Interactive** head is held while a throttle back-off window is open (§ 2.5).
2. An **Idle** head is held while any non-Idle task runs, and until `IdleAfter` has elapsed since `lastNonIdle` (set by non-Idle arrival, admission and completion alike).
3. If the running count is at `MaxConcurrent`, admission stops; if the head is Interactive, preemption is attempted first (§ 2.4).
4. **Rate spacing** applies only when growing past the high-water mark (`running >= highWaterMark`): if `MinStartInterval > 0` and a previous start exists within that interval, wait. Backfilling below the mark is never spaced. With both shipped configurations `MinStartInterval` is 0, so spacing never applies.
5. Admit: the head is removed, a child context with cancel-cause is derived from the waiter's context, the task is appended to `running`, a non-Idle admission stamps `lastNonIdle`, and the waiter's channel is closed. When the admission grew the peak, the mark becomes the new running count and `lastStart = now`; when it merely restored the mark, only the mark's timestamp is refreshed.

A single timer is re-armed each dispatch for the earliest time-based condition (back-off end, idle quiet end, next allowed start). `release` is idempotent (`sync.Once`): it cancels the run context with cause `context.Canceled` (a sticky earlier `ErrPreempted` cause survives), removes the task, stamps `lastNonIdle` for a non-Idle task, and re-dispatches. A waiter whose own context ends while queued is removed and dispatch re-runs; if dispatch admitted it in the same instant, `release` is called for it immediately and the context error is still returned.

### 2.4 Preemption

Only when `PreemptAtOrBelow != PreemptNone` (the Ollama configuration). `needed` = the number of Interactive waiters (capped at `MaxConcurrent`) minus free slots minus tasks already marked `preempting`. For each unit needed, one running task with priority ≥ `PreemptAtOrBelow` and not already preempting is cancelled with cause `ErrPreempted`: lowest priority first, and among equals the **most recently started**. If no candidate remains, preemption stops short. The victim's slot frees only when its owner's stream drains and `release` runs; the owner is expected to retry `Acquire` (§ 4).

### 2.5 Throttle back-off

`ReportThrottled` is called only from `usage.stream`, on a synchronous provider failure of kind `quota` or `transient`. It sets the back-off step to 2 s on the first report or when more than 120 s have passed since the previous report; otherwise it doubles the step, capped at 60 s. `backoffUntil = now + step`. The high-water mark is reset to the current running count (growth must re-earn itself), and dispatch re-runs. While `now < backoffUntil`, every non-Interactive head is held (§ 2.3 step 1); Interactive work is never held by back-off.

### 2.6 Status and the held reason

`Status{Version (not serialised), running: [TaskInfo], waiting: {priorityName: count} (omitted when empty), held (omitted when nil)}`. `TaskInfo{role, priority, model, started, tokens (omitempty), tokens_per_second (omitempty)}`: `tokens` is the char/4 estimate from `AddProgress`; `tokens_per_second` = tokens over the whole elapsed time, present only once more than 0.5 s has elapsed and tokens > 0. `held` is computed only while something waits and describes why the **head** waiter is not running, in the admission order:

| `reason` | When | `until` |
|---|---|---|
| `backoff` | head is non-Interactive and a back-off window is open | end of the window |
| `idle_blocked` | head is Idle and a non-Idle task is running | — |
| `idle_quiet` | head is Idle and `IdleAfter` has not elapsed since `lastNonIdle` | when it will have |
| `capacity` | running count is at `MaxConcurrent` | — |
| `rate_spacing` | at or above the high-water mark, `MinStartInterval > 0`, and the last start is within it | the next allowed start |

When none applies, `held` is nil. `Waiting` keys are `interactive`, `background`, `idle`.

**Publication.** Every dispatch (each `Acquire`, `release`, `Reconfigure`, `ReportThrottled`, timer wake) increments `Version` and delivers the snapshot to the `SetOnChange` callback **in a new goroutine**; `AddProgress` publishes at most once per 500 ms. Without a callback neither the increment nor the delivery happens. `Snapshot()` exists but has no caller in this binary.

`server/queue_status.go` (registered in `OnServe`) is the only subscriber. At boot it writes an **empty** status first (running `[]`, waiting `{}`, held `null`, state `idle`), creating the row if the collection has none. Callbacks are debounced 300 ms (the latest snapshot wins) and a delivery whose `Version` is not greater than the last accepted one is discarded. Each write sets the first `llm_queue_status` row's `state` (`active` when anything runs or waits, else `idle`) and `running`, `waiting`, `held` as JSON strings; a missing collection or failed save is logged and dropped. The collection is server-written (create/update/delete rules nil; list/view require an authenticated user — `schema.md` § 2.15), and its statements are excluded from the SQL write echo (`writeEchoSkip`).

## 3. Priority overrides in use

| Caller | Wrapper / role | Context | Priority |
|---|---|---|---|
| Chat turn, summaries-mode rounds (`chat.go`, `chat_summaries.go`) | `Stream` / chat | request | Interactive (default) |
| Refinement turn and its post-tool continuation (`refinement_chat.go`) | `Stream` / refinement | request | Interactive (default) |
| Refinement apply leg (`engine.ApplyDraftLens`) | `GenerateStreamMsgs` / snapshot | request | Interactive (default) |
| Generate route: `GenerateSnapshot` / `GenerateWindows`, delta and merge (`synthesis.go`) | `GenerateOnce`, `GenerateOnceMsgs` / snapshot | `context.WithoutCancel(request)` | Interactive (default) |
| Chat brief (`chat.GenerateBrief`) | `GenerateWithToolCalls` / chat | request | Interactive (explicit override, same as default) |
| Colour preview route (`HandlePreviewColour`) | `GenerateOnce` / colour | request | **Interactive (override)** |
| Colour worker `judge` | `GenerateOnce` / colour | `context.Background()` | Idle (default) |
| Annotate worker and consolidate (`mapping.generate`) | `GenerateOnceMsgs` / annotate, map | `context.Background()` | Background (default) |
| Discover runs (`discover.runLoop`) | `GenerateWithToolCalls` / map | `context.Background()` | Background (explicit override, same as default) |
| Reconcile wave (`runWave`) | via `engine.GenerateSnapshot` / snapshot | `context.Background()` + generation trigger | **Background (override)** |
| Reflection pending-window generation (`engine.GeneratePendingWindows`) | via `GenerateWindows` / snapshot | `context.Background()` | **Background (override)** |

## 4. Retry postures

- **`retryPreempted`** — two identical copies, in `internal/mapping/worker.go` (used by `mapping.generate` for annotate and consolidate) and `internal/discover/worker.go` (used by the discover tool loop). `ErrPreempted` is retried indefinitely; a `ProviderError` of kind `quota` or `transient` is retried up to `maxThrottledAttempts` = 6 further times (7 calls in all) and then returned; any other error is returned at once. No delay of its own — the scheduler's back-off (§ 2.5) supplies the spacing.
- **Colour worker `judge`** — loops on `ErrPreempted` only; every other error is returned to `drainColour`, which stamps the provider-error marker when the error is an `auth`/`quota` `ProviderError` (`colours.md` § 4.2; any other error leaves the marker as it was) and stops that colour.
- **`engine.GenerateWindows`** — each window's goroutine loops on `ErrPreempted`; other errors are returned per window in `WindowResult`.
- **Reconcile wave** — per window, loops on `ErrPreempted`; `ErrLensNotReady` / `ErrGenerationInFlight` skip the entity; any other error ends the wave. At wave level, `ErrExhausted` is logged (`quota exhausted; not retrying`) and not retried; any other error schedules a retry after 1 min, then 5 min, then 15 min for every later consecutive failure (`boot-and-workers.md` § 2).
- **`engine.GenerateSnapshot`** — an `ErrPreempted` from the delta/merge continuation is propagated so the caller retries the whole generation; a cancelled context aborts without persisting; any other delta/merge failure is logged and the raw candidate is kept.
- **Request handlers** — never retry. Preemption only cancels tasks at or below `PreemptAtOrBelow` (Background), and every handler call is Interactive (§ 3), so `ErrPreempted` cannot reach a handler.
- **`ErrExhausted` in workers** — the annotate drain marks the batch exhausted and stops after the current wave of goroutines; the colour worker stops draining all remaining colours; discover returns it as the run's error. All unreachable in this build (§ 1 step 1).

## 5. Usage recording and quota

`usage.Setup` binds an `OnServe` handler that fails boot (`usage.Setup: …`) unless the `usage` collection exists and carries a single-column **unique** index on `period`.

`Record(ctx, app, usage)`: a no-op when usage is nil or `TotalTokens == 0`. Otherwise `PeriodKey` = UTC `YYYY-MM` of now, and in a transaction attempted at most twice the period's `usage` row is found or created and `prompt_tokens`, `completion_tokens`, `total_tokens`, `cached_tokens` are each incremented. A second failure is logged (`usage: record <period>: <err>`) and dropped. The installed `Authorizer.Record` is then called — none is installed. `Record` runs only from the wrapped-stream goroutine after the provider's channel closes, so it also runs for a call whose caller has gone away, provided the provider reported usage.

What each provider reports: **Ollama** fills usage only from the chunk with `done: true` (`prompt_eval_count`, `eval_count`, total = their sum, `cached_tokens` 0, tokens/s from `eval_duration`); a stream cut short by cancellation before that chunk yields nil and records nothing. **Gemini** keeps the latest cumulative `usageMetadata` (`promptTokenCount`, `candidatesTokenCount`, `totalTokenCount`, `cachedContentTokenCount`; tokens/s never set) and reports it whenever the SSE read loop ends — including when a cancelled request's body read fails part-way — provided at least one `usageMetadata` chunk was seen; a cancellation observed while blocked delivering an event (the `ctx.Done` arm of the send) returns before that point and reports nil, as does a stream that never carried `usageMetadata`.

`WriteExhausted` → `402 {error: "quota_exhausted", period, used}`, where `used` is the current period's `total_tokens` (0 when no row). Called on `ErrExhausted` from the chat turn, the summaries first round, the refinement turn, the chat brief route, and both error branches of the generate route (6 sites); the refinement apply leg instead reports it as a `quota_exhausted` turn error on the SSE stream (`refinement.md` § 3.1). All unreachable while no authorizer is installed.

The `usage` collection: `period` (required text), four number counters, `created`/`updated`; unique index `idx_usage_period`; readable by any authenticated user, no client writes (`schema.md` § 2.14).

## 6. Provider error classification and envelopes

`llm.ProviderError{Provider, Kind, StatusCode, Model, Body}`; kinds `auth`, `quota`, `transient`, `other`. `Error()` renders `<provider>: <kind> (HTTP <n>, model "<m>"): <body>`, or without the HTTP part when `StatusCode` is 0. `llm.ClassifyStatus`: 401 and 403 → `auth`; 429 → `quota`; ≥ 500 → `transient`; anything else → `other`.

**Where each provider produces one** (`models.md` § 6 for the providers themselves):

| Provider | Condition | Kind / `StatusCode` |
|---|---|---|
| Gemini | workspace key empty and `GEMINI_API_KEY` unset (before any request) | `auth` / 0 |
| Gemini | transport error with the request context still live | `transient` / 0 |
| Gemini | non-2xx response (body read up to 4096 bytes) | body-first `classify`, then `ClassifyStatus` |
| Ollama | transport error with the request context still live | `transient` / 0 |
| Ollama | non-200 response (body read up to 4096 bytes) | `ClassifyStatus(status)` |

Gemini's body-first `classify`: any `error.details[].reason` of `API_KEY_INVALID`, `API_KEY_SERVICE_BLOCKED`, `ACCOUNT_STATE_INVALID`, `SERVICE_DISABLED` → `auth`; else `error.status` `UNAUTHENTICATED` / `PERMISSION_DENIED` → `auth`, `RESOURCE_EXHAUSTED` → `quota`, `UNAVAILABLE` / `DEADLINE_EXCEEDED` / `INTERNAL` → `transient`; an unparseable body or any other status falls through to `ClassifyStatus`. Not `ProviderError`s: a transport error when the request context is already cancelled (the context error is returned unclassified), Gemini's empty-model error, request-marshal errors, and the `llm: no provider registered for model` error of the `ErrorProvider` used when an unconfigured workspace resolves a model the static table lacks — these reach handlers as plain errors and take their generic 500 branch.

`usage.WriteProviderError(e, err)` returns false (nothing written) unless `err` unwraps to a `ProviderError`. Otherwise it logs `<METHOD> <path>: provider error surfaced to client: <err>` and writes:

| Kind | HTTP | `error` |
|---|---|---|
| auth | 409 | `provider_auth_failed` |
| quota | 429 | `provider_quota_exceeded` |
| transient | 502 | `provider_transient` |
| other | 502 | `provider_error` |

Body `{error, kind, provider, model, detail}` with `detail` = `Error()`. 401 is never used. Call sites (6): the chat turn, the summaries first round, the refinement turn, the chat brief route, and both error branches of the generate route — each tried before the handler's generic 500. Other consumers of the kind: the colour worker's `last_provider_error_kind` marker, set for `auth`/`quota` only (`colours.md` § 4.2); the validate route, which returns 200 `{ok: false, kind, provider, model, detail}` (`models.md` § 4); the config update hook, which rejects with a 400 validation error keyed `api_key` and code `provider_<kind>` (`models.md` § 3); `retryPreempted` (§ 4); and `ReportThrottled` (§ 2.5). Paths that swallow provider errors instead: the colour preview route logs and drops each fragment's failure (silently when the request context is already cancelled — `colours.md` § 5); the refinement post-tool continuation logs and returns an empty text; summaries-mode rounds after the first send the error text as an SSE `error` event (`chat.md` § 5).

## 7. Provider call logging (trace and failure shape)

Both providers compute `llm.Shape(messages, tools, opts)` before every request: `messages=<n> (<role>:<count>/<chars>ch, … sorted by role) empty=<blank-content count> tools=[names] temp=<value|default>`.

- **Trace.** `llm.Trace` is true when `KALAIDO_LLM_TRACE` is non-empty in the process environment at start-up (read once; not reconfigurable). When on, `llm.LogRequest` logs `<provider>: trace request model=<m> url=<endpoint> body=<full JSON request body>` immediately before each request — the complete message content included. Gemini's URL is `…/models/<m>:streamGenerateContent?alt=sse` (the key travels in the `x-goog-api-key` header and is not logged); Ollama's is `<Base>/api/chat`. Off by default, nothing is logged here.
- **Failure shape.** `llm.LogFailure` is **always** written on both synchronous failure paths of both providers — transport error (`no response`, body = the error text) and non-2xx (`HTTP <n>`, body = the response body up to 4096 bytes) — except a transport error with the request context already cancelled, which returns the context error without either line. It is written as two lines: `<provider>: request failed (<where>) model=<m> <shape> <detail>` and `<provider>: response body: <body>`. `detail` is `tier=<serviceTier> system_instruction=<chars>ch contents=<n> parts=<n> body=<bytes>B` for Gemini and `num_ctx=<n> body=<bytes>B` for Ollama.
- **Gemini end-of-stream lines.** When usage was seen: `gemini: traffic_type=<ON_DEMAND_PRIORITY|ON_DEMAND|…> model=<m>`. When the stream ended without a plain `STOP`, carried a `promptFeedback.blockReason`, or delivered neither text nor a tool call: `gemini: completion ended finish_reason=<r> block_reason=<b> text_parts=<n> tool_calls=<n> completion_tokens=<n> model=<m> <shape> <detail>`. Ollama writes no end-of-stream line.
- **Route line.** `WriteProviderError` adds the method and path of the request the failure surfaced on (§ 6). Validation calls (`models.md` § 4) use the same providers and therefore emit the same trace and failure lines.
