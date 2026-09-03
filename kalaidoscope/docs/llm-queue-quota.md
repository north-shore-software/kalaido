# LLM Queue & Quota — Generated Audit Snapshot

> **Generated:** 2026-09-02, from source at commit `3998ebd`.
> This file is a generated audit snapshot — do not edit it. See `AGENTS.md` § "Generated audit docs". When code described here changes, a stale marker line is prepended above this block; nothing else in the file is ever modified by hand.

**Scope.** What happens to every outbound model call between the caller and the provider: the single call path, the scheduler (priorities, admission, rate spacing, idle gating, preemption, throttle back-off), the status it publishes, usage recording and the period quota, and how provider failures are classified and returned on the wire. Which model a call uses is `models.md`; the callers are the flow and lifecycle docs.

**Completeness anchor.** One provider entry point, `usage.stream` (4 public wrappers: `Stream`, `GenerateOnce`/`GenerateOnceMsgs`, `GenerateStreamMsgs`, `GenerateWithToolCalls`); one scheduler instance (`llmq.std`); one quota `Authorizer` slot (`quota.Set`), **never set** in this binary; 1 status collection (`llm_queue_status`); 1 usage collection (`usage`).

---

## 1. The single call path

Every model call — chat, refinement, apply, snapshot, delta/merge, colour judge, annotate, consolidate, discover — goes through `usage.stream`:

1. **Quota check** `Authorized(ctx, app)`: returns `ErrExhausted` when the installed `quota.Authorizer` says no. No authorizer is installed anywhere in this binary (`quota.Set` has no caller), so this check **always passes** and `ErrExhausted` is never produced here; the handlers' 402 branches are unreachable in this build.
2. Empty model → error (`no model resolved for role`).
3. **Admission** `llmq.Acquire` with priority = the context's override, else the role default (§ 2); blocks until admitted or the caller's context ends.
4. The provider's `Stream` is invoked under the **run context** the scheduler returned. A synchronous failure releases the slot; a `ProviderError` of kind `quota` or `transient` also calls `ReportThrottled` (§ 2.5).
5. The event channel is wrapped: the slot is held until the stream **fully drains**; streamed characters are reported to the scheduler as `chars / 4` token progress; when the channel closes, `Record` (§ 5) runs with the provider's final usage.

Exceptions: config validation calls (`models.md` § 4) hit the provider directly and bypass all of this.

**Truncation guards** in the collecting wrappers: if the run context's cancellation cause is `ErrPreempted`, the partial text is discarded and `ErrPreempted` returned; if the caller's context ended, `stream interrupted: <cause>` is returned rather than the partial text. `Stream` itself (used by the chat handlers) returns the wrapped channel without these checks; the chat SSE relays whatever arrived.

## 2. The scheduler (`llmq`)

One process-wide `Scheduler`, booted with the Ollama configuration and reconfigured at the end of the serve chain and after every config commit to `ConfigForProvider(ActiveProviderID())`.

### 2.1 Priorities

`Interactive` (0) < `Background` (1) < `Idle` (2); numerically lower runs first. Role defaults: `map`, `annotate` → Background; `colour` → Idle; `chat`, `refinement`, `snapshot` → Interactive. Callers override via `WithPriority` on the context: the reconcile wave, discover runs, and reflection pending-window runs use Background; the colour preview route uses Interactive.

### 2.2 Configuration per provider

| | `ollama` | any other |
|---|---|---|
| `MaxConcurrent` | 1 | 100 |
| `MinStartInterval` | 0 | 0 |
| `IdleAfter` | 5 min | 1 min |
| `PreemptAtOrBelow` | Background (Background and Idle tasks may be cancelled) | none |

`MaxConcurrent < 1` is clamped to 1. Reconfiguration applies at once; a lowered cap takes effect as running calls finish.

### 2.3 Admission (`dispatchLocked`)

Waiters are kept sorted by (priority, arrival). On every state change the head is examined repeatedly:

1. Non-Interactive waiters are held while a throttle back-off window is open (§ 2.5).
2. An **Idle** waiter is held while any non-Idle task runs, and until `IdleAfter` has passed since the last non-Idle activity (arrival, admission, or completion all count).
3. If the running count is at the cap, admission stops; if the head is Interactive, preemption is attempted (§ 2.4).
4. **Rate spacing** applies only when growing past the proven high-water mark of concurrency: if `MinStartInterval > 0` and the last start was more recent, wait. Backfilling up to a level already sustained within the last 10 minutes is not spaced. (With both shipped configurations `MinStartInterval` is 0, so spacing never applies.)
5. Admit: a child context with cancel-cause is created from the waiter's context; `release` (idempotent) removes the task and re-dispatches.

A timer is armed for the earliest time-based condition. A waiter whose own context ends is removed; if it was admitted in the same instant the slot is handed straight back.

### 2.4 Preemption

Only when `PreemptAtOrBelow` is set (Ollama). For each Interactive waiter that cannot get a slot, one running task at or below that priority is cancelled with cause `ErrPreempted`: lowest priority first, and among equals the most recently started. A task already being preempted counts as a slot on its way. The victim's owner is expected to retry `Acquire`; every worker and the engine do (`boot-and-workers.md` § 2, `lifecycle-projection.md` § 4).

### 2.5 Throttle back-off

`ReportThrottled` (called on provider `quota`/`transient` errors) opens a back-off window during which non-Interactive waiters are held: 2 s on the first report, doubling per report up to 60 s; a report more than 120 s after the previous one restarts at 2 s. The high-water mark is reset to the current running count so growth must re-earn itself. Interactive work is never held by back-off.

### 2.6 Status

`Status{running: [{role, priority, model, started, tokens?, tokens_per_second?}], waiting: {priority: count}}`, versioned. Published asynchronously on every transition and at most every 500 ms for progress. `server/queue_status.go` mirrors it into the singleton `llm_queue_status` row (`state` = `active` when anything runs or waits, else `idle`; `running` and `waiting` as JSON), debounced 300 ms, discarding out-of-order versions, and **reset to empty at boot**. The row is server-written only; its writes are excluded from the SQL echo log.

## 3. Priority overrides in use

| Caller | Role | Priority |
|---|---|---|
| Chat, refinement, refinement apply, on-demand snapshot generation | chat / refinement / snapshot | Interactive (default) |
| Colour preview route | colour | Interactive (override) |
| Colour worker | colour | Idle (default) |
| Annotate worker, consolidate | annotate / map | Background (default) |
| Discover runs, reconcile wave, reflection pending-window runs | map / snapshot | Background (override) |

## 4. Retry postures

`ErrPreempted` is retried in place by: the colour worker judge, mapping and discover calls (`retryPreempted`), `GenerateWindows`, the reconcile wave, and the mapping annotate/consolidate `generate`. In addition `retryPreempted` (mapping, discover) retries `quota`/`transient` `ProviderError`s up to 6 times, without delay of its own (the scheduler's back-off supplies the spacing). Request handlers do **not** retry a preempted call; Interactive work is never preempted, so this does not arise for them.

## 5. Usage recording and quota

`Record(ctx, app, usage)`: skipped when usage is nil or `total_tokens` is 0. Otherwise, in a transaction retried once, the `usage` row for the current period — `PeriodKey` = UTC `YYYY-MM` — is found or created and `prompt_tokens`, `completion_tokens`, `total_tokens`, `cached_tokens` are incremented. Failure is logged. The installed `Authorizer.Record` is then called — none is installed. The `usage` collection is client-readable, server-written; `Setup` fails boot if the unique index on `period` is missing.

`WriteExhausted` → `402 {error: "quota_exhausted", period, used}` where `used` is the current period's `total_tokens`. Reachable from the chat, refinement, generation and colour-preview paths only if an authorizer were installed.

Provider usage of **Ollama** calls is recorded like any other (`total_tokens` from prompt + eval counts).

## 6. Provider error classification and envelopes

`llm.ProviderError{Provider, Kind, StatusCode, Model, Body}`; kinds `auth`, `quota`, `transient`, `other`. Gemini classifies (`models.md` § 6); Ollama returns plain errors that are **not** `ProviderError`s.

`usage.WriteProviderError(e, err)` writes, when `err` is a `ProviderError`:

| Kind | HTTP | `error` |
|---|---|---|
| auth | 409 | `provider_auth_failed` |
| quota | 429 | `provider_quota_exceeded` |
| transient | 502 | `provider_transient` |
| other | 502 | `provider_error` |

Body `{error, kind, provider, model, detail}`. 401 is deliberately never used (the client would read it as session expiry). Used by the chat, refinement, and generation handlers before their generic 500; the colour preview route logs and drops per-fragment failures instead; workers stamp the kind on a record (`colours.md` § 4) or log it.
