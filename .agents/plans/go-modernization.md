# Go Sidecar Modernization Plan

**Status:** Proposed, fact-checked against `kalaido/kalaidoscope/` at `55a8458` (2026-09-17). Nothing implemented yet; branch `louis/go-tidy` is clean.
**Scope:** Go backend only. Retire package-level globals, add a shutdown lifecycle, structured logging, typed config, and fix the handful of API-shape deviations. Keep the codebase's "standard library first" posture.

---

## 1. What the audit got right

Verified in code:

- **No shutdown lifecycle in our code.** Zero `OnTerminate` subscribers; all four workers run `for range signal` forever; `ingest.RegisterHooks` and `engine.Background` launch bare goroutines. *Correction:* PocketBase's `apis.Serve` already traps SIGINT/SIGTERM, fires `OnTerminate`, and calls `http.Server.Shutdown`. The process is not SIGKILLed; we simply never subscribe. So the fix is an `OnTerminate` hook that cancels a root context and waits for workers, **not** a second `signal.NotifyContext` in `main`, which would race PocketBase's own handler.
- **Package-level worker state.** `mapping`, `colour`, `reconcile`, `discover` each hold `signal`/`wake`, `workerApp`, `followUps`, plus assorted mutex-guarded status vars. Cross-package hooks are mutable function vars: `engine.RequestWave`, `engine.Background`, `llm.SetProviderFactory`. No test file uses `t.Parallel()`.
- **Unstructured logging.** ~40 `log.Printf`/`log.Fatal` sites across 17 packages; zero `slog`.
- **Scattered env reads.** Seven sites: `KALAIDO_MODEL_SET`, `KALAIDO_USER_PASSWORD` (main), `KALAIDO_AUTO_WAVE` (reconcile, evaluated at package init), `KALAIDO_LLM_TRACE` (llm, at package init), `GEMINI_API_KEY`, `OLLAMA_HOST`, and a credential-env probe in `handlers/preflight.go`.
- **`AwaitGeneration` polls SQLite every 500ms** (`engine/genclaim.go`).
- **Anonymous request structs** in `handlers/synthesis.go:328`, `tokens.go:27`, `discover.go:13`. The ones in `refinement_chat.go:78,289,322` are LLM tool-call argument shapes, not HTTP DTOs; they belong next to the tool definitions in `prompts`, not `internal/api`.
- **`POST /api/ingest` is snake_case** while every other route is lowerCamelCase; `format`/`fragment_limit`/`extensions` are accepted and ignored (`docs/api.md §2`).
- **Ingest records can stick in `pending`.** No boot sweep exists for the `ingest` collection.
- **Retry on throttling has no delay.** `mapping.retryPreempted` and its twin in `discover` retry a quota/transient `ProviderError` up to six times with `continue` and **no sleep at all**. The audit called this a "hardcoded sleep"; it is worse. This is the one place a backoff library earns its keep.

## 2. What the audit got wrong

- **§4.6 "wrap `colour/worker.go` batch loops in a transaction".** `drainColour` makes one LLM call per fragment and writes one link row after each. PocketBase funnels all writes through a single non-concurrent connection, so a transaction held across LLM calls would block every writer in the process (the UI included) for the whole page. Do **not** do this. The same applies to `mapping/annotate.go` (one write per annotate call). Genuine batch-write candidates are the ingest fragment writer (`ingest/writer.go`, one `Save` per fragment with no LLM in between) and nothing else found; `mapping/consolidate.go` already uses `RunInTransaction`.
- **§2 "replace `MinStartInterval` with `x/time/rate`".** The pacing in `llmq` is not a rate limit. It only applies while the scheduler is growing its concurrency peak (`growingPeak`, `highWaterMark`), as a ramp to let the provider settle. A token bucket has different semantics and would need to be bypassed most of the time. Leave `llmq` alone.
- **Library count.** The audit proposes eight new dependencies for plumbing that is each 15–40 lines here. That contradicts the codebase's stated posture and the audit's own "libraries to avoid" reasoning. Revised list below.

## 3. Dependencies: revised

| Need | Audit proposed | Decision | Why |
|---|---|---|---|
| Worker lifecycle, bounded fan-out | `x/sync/errgroup` + `sourcegraph/conc` + `alitto/pond` | **`x/sync/errgroup` only** (already indirect; promote) | `errgroup.SetLimit` replaces the `sem` channel in `mapping.drain` and the `WaitGroup` in `HandlePreviewColour`. Panic-safety is not a real concern here: every LLM call already returns errors, and a panic in a worker should crash the sidecar loudly, not be swallowed. |
| Throttle retry with backoff | `cenkalti/backoff/v4` | **Adopt** | Replaces the sleepless six-retry loop in `mapping`/`discover`. Also a fit for the fixed `retryBackoff` ladder in `reconcile`. |
| Claim completion signalling | `cskr/pubsub` | **Std lib** | A `sync.Mutex` + `map[string][]chan struct{}` in a `ClaimHub` type is ~40 lines and has exactly the semantics we need (close-on-settle, ctx-aware wait). |
| Debounce | `bep/debounce` | **Keep existing** | `reconcile` needs "cancel the pending debounce when Start is pressed", which `bep/debounce` has no API for. The current timer code is 25 lines and correct. It just needs to move into the `Worker` struct. |
| Typed config | `caarlos0/env/v11` | **Std lib** | Seven variables. A `config.Env` struct with a `Load()` that reads `os.Getenv` once is smaller than the library's docs. Revisit if the variable count doubles. |
| LLM pacing | `x/time/rate` | **Do not adopt** | See §2. |
| Test diffs | `google/go-cmp` | **Adopt** | Test-only dependency. `schema/parity_test.go` uses `reflect.DeepEqual` on a whole schema snapshot and prints nothing useful on failure; `cmp.Diff` fixes that immediately. |

Net: two new direct dependencies (`cenkalti/backoff/v4`, `go-cmp`) plus promoting `x/sync`.

## 4. Target shape

```
cmd/sidecar/main.go
  ├── env := config.LoadEnv()              // one os.Getenv pass, validated, fail-fast
  ├── logger := slog.New(...)              // level from env, text handler (Tauri reads stdout)
  └── server.New(env, logger)
        ├── OnBootstrap: schema.Install
        ├── OnServe:     engine.SweepGenerationClaims, ingest.SweepPending, routes, then
        │                start workers under one errgroup bound to a root ctx
        ├── OnTerminate: cancel root ctx, g.Wait() with a bounded deadline
        ├── engine.Engine{claims *engine.ClaimHub, wave WaveRequester}
        ├── colour.Worker, mapping.Worker, reconcile.Worker, discover.Worker
        │     each: struct, NewWorker(app, deps), Run(ctx) error, Signal()
        └── handlers take the worker/engine they call as a constructor arg
```

Worker signature every package converges on:

```go
type Worker struct {
    app    core.App
    signal chan struct{}   // still 1-buffered, still coalescing
    // ...package-specific deps
}

func New(app core.App, ...) *Worker
func (w *Worker) Signal()
func (w *Worker) Run(ctx context.Context) error   // returns ctx.Err() on cancel
```

The coalescing-signal + re-derive-from-DB pattern is unchanged. Only the ownership moves.

## 5. Phases

Each phase leaves `./kalaido.sh test:go` and `go vet ./...` clean and is a separate PR.

### Phase 1: Foundations (no behaviour change)
- [ ] `go get github.com/cenkalti/backoff/v4 github.com/google/go-cmp`; promote `golang.org/x/sync` to direct.
- [ ] `internal/config/env.go`: `Env` struct (`ModelSet`, `UserPassword`, `AutoWave`, `LLMTrace`, `LogLevel`), `LoadEnv() (Env, error)`. `main` loads it once and passes it down. `llm.Trace` and `reconcile.autoWave` stop reading the environment at package init and become fields set from `Env`. Provider credential env vars (`GEMINI_API_KEY`, `OLLAMA_HOST`) stay where they are: they belong to the provider, and `preflight.go` probes them by name.
- [ ] `log/slog`: one logger built in `main`, level from `Env.LogLevel` (default `info`). Mechanical sweep of all `log.Printf` sites to `slog` with the worker/package as a fixed attribute. Keep `log.Fatal` semantics for boot invariants via `slog.Error` + `os.Exit(1)`.
- [ ] Move the three anonymous HTTP request structs to `internal/api` (`CreateSynthesisRequest`, `TokenResolutionRequest`, `DiscoverKickRequest`). Move the tool-argument structs in `refinement_chat.go` next to their tool definitions in `internal/prompts`.
- [ ] `api.IngestMessage`: switch JSON tags to lowerCamelCase and add an `UnmarshalJSON` that also accepts the legacy snake_case keys. Return `400` when `format`, `fragmentLimit`, or `extensions` are set on the synchronous route instead of ignoring them. Update `docs/api.md §1/§2` (regenerate, do not hand-edit).
- [ ] `schema/constants.go`: typed `Collection` and `Status` constants and a `NotDeleted()` predicate. Adopt at call sites opportunistically in later phases; do not do a repo-wide sweep in this phase.

### Phase 2: Fix the real bugs
- [ ] `retryPreempted` in `mapping` and `discover`: replace the sleepless loop with `backoff.Retry` (exponential, jitter, `MaxElapsedTime` ≈ 2 min, `Permanent` for non-throttle errors, `ErrPreempted` retried immediately as today).
- [ ] `ingest.SweepPending(app)` on `OnServe`, mirroring `engine.SweepGenerationClaims`: rows still `pending` at boot become `status=error`, `error="server restarted while processing"`.
- [ ] `ingest/writer.go`: wrap the per-upload fragment writes in one `RunInTransaction` (no LLM calls in that loop). Confirm the birth hooks still fire per record.

### Phase 3: Workers as structs, lifecycle under errgroup
- [ ] `engine.ClaimHub` (std lib): `Await(ctx, claimID)` and `Settle(claimID)`. `AwaitGeneration` waits on the hub and reads the row once on wake; the 500ms poll stays only as the fallback for a claim not registered in this process (TTL takeover).
- [ ] Convert `colour`, `mapping`, `reconcile`, `discover` to `Worker` structs per §4. The reconcile debounce and retry timers become fields. `followup.Queue` becomes a field.
- [ ] Replace `engine.RequestWave` with a `WaveRequester` interface passed into the engine; replace `engine.Background` with a `Runner` that the server owns and that is `errgroup`-tracked.
- [ ] `server.New` builds the graph explicitly, starts each `Run(ctx)` in an `errgroup`, and binds `OnTerminate` to cancel and wait (bounded, e.g. 10s, then log and exit).
- [ ] `mapping.drain` fan-out: `errgroup` with `SetLimit(annotateWorkers)`. `HandlePreviewColour`: same, keeping the streaming result channel.
- [ ] Tests: `testutil` gains a `NewWorkers(app)` helper; add `t.Parallel()` where package state no longer blocks it; verify with `go test -race ./...`.

### Phase 4: Test diffs
- [ ] `cmp.Diff` in `schema/parity_test.go` and in any handler/engine test comparing structs or slices by hand.

## 6. Gates

1. `go vet ./...` clean; `go test -race ./...` clean.
2. `schema/parity_test.go` and `schema/delta_lint_test.go` untouched and passing.
3. Boot still prints `KALAIDO_PORT=` and `KALAIDO_USER_TOKEN=` on stdout before serving. `slog` output goes to **stderr** so the host's stdout parse is unaffected.
4. Quitting the desktop app during an active wave or import leaves no `generating` claim rows and no `pending` ingest rows on the next boot (both sweeps become no-ops in the common case).
