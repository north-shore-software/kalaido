# Boot & Background Workers — Generated Audit Snapshot

> **Generated:** 2026-09-02, from source at commit `3998ebd`.
> This file is a generated audit snapshot — do not edit it. See `AGENTS.md` § "Generated audit docs". When code described here changes, a stale marker line is prepended above this block; nothing else in the file is ever modified by hand.

**Scope.** The process as a whole: what happens between binary start and the first served request, and every goroutine that runs outside a request afterwards — its trigger, what it drains, how it retries, and what it leaves behind on a crash. This is an index: each worker's domain behaviour (what a map drain or a colour drain actually does) lives in its own doc and is only pointed at here. Model-call admission for all of them is in `llm-queue-quota.md`.

**Completeness anchor.** 13 `OnServe().BindFunc` sites and 1 `OnBootstrap().BindFunc` site in non-test code (`cmd/sidecar/main.go` ×3, `server/server.go` ×3, `server/queue_status.go`, `internal/ollama/handlers.go` ×2, `internal/usage/usage.go`, `internal/config/config.go`, `internal/colour/worker.go`, `internal/mapping/worker.go`; bootstrap in `server/sqllog.go`); 6 long-lived goroutines (colour loop, reconcile loop, mapping loop, mapping aggregate loop, discover loop, Ollama preload); 6 collection hooks (`server/server.go` ×3, `internal/ingest/batch.go`, `internal/config/hooks.go` ×2).

---

## 1. Boot sequence

The binary's `main` builds the app through `server.New(true)` (start banner hidden, because the sidecar binds an OS-assigned port and PocketBase prints the banner before the port is known), then layers its own registrations, then `Start`s. Registration order matters only where noted; most work is deferred to `OnServe`, which fires once the HTTP server is about to listen.

**In `server.NewWithConfig` (library wiring, in order):**

1. `migratecmd` registered with `Automigrate: false` — migrations run only via the `migrate` subcommand, never on start (`schema.md` § 1).
2. `OnServe`: disables PocketBase's installer redirect (no `_superusers` row is ever created; the dashboard stays at `/_/` for a superuser created by hand), then **sweeps generation claims**: every `projection_snapshot`/`reflection_snapshot` row with `status = "generating"` is deleted — a claim can only be live while its goroutine runs in this process (`lifecycle-projection.md` § 4).
3. `OnBootstrap` (after `Next`): unless the app runs with `--dev`, installs a SQL write-echo logger on both DB handles — every `INSERT`/`UPDATE`/`DELETE` is logged (statement truncated to 500 runes), skipping `llm_queue_status` and underscore-prefixed PocketBase tables; reads and DDL are never logged. In `--dev` this hook installs nothing (PocketBase's own full echo applies).
4. Collection hooks: three on `fragment` (`ingestion.md` § 7), one on `ingest` (`ingestion.md` § 3), two on `kalaidoscope_config` (`models.md` § 3).
5. Custom routes (`api.md`).
6. `usage.Setup`: `OnServe` asserts the `usage` collection exists and has a unique single-column index on `period`; a missing index **fails boot** (`llm-queue-quota.md` § 5).
7. `colour.Register`, `reconcile.Register`, `mapping.Register`, `mapping.OnSettle(colour.OnMapSettled)`, `discover.Register`, `registerQueueStatus` — the workers in § 2.
8. `OnServe` (after `Next`, so it runs last in the chain): reconfigures the LLM scheduler for the provider that ended up active (`llm-queue-quota.md` § 2).

**In `main` (binary wiring, in order):**

9. `resolveModelSet` — `OnServe`: reads the single `kalaidoscope_config` row (creating one if none). If `model_set` is empty it is **seeded** from `KALAIDO_MODEL_SET` (default `local`; an unparseable value is fatal) and saved. Otherwise the stored value wins; an env value that disagrees is logged and ignored; a stored value that no longer parses is **fatal** (`models.md` § 1).
10. `config.LoadAtBoot` — `OnServe`: publishes the stored workspace provider config (provider, key, models) if one is configured (`models.md` § 3).
11. `llm.SetProviderFactory` — the one place providers are constructed: a configured workspace dispatches on its stored provider (`gemini` → Gemini with the stored key, `ollama` → Ollama); an unconfigured one resolves the provider from the static model table, falling back to an error-returning provider for an unknown model (`models.md` § 2).
12. `ollama.RegisterRoutes` (2 routes) and `ollama.RegisterPreload` (§ 2.6).
13. `seedSidecarUser` — `OnServe`: finds or creates the `users` auth record `user@kalaido.local`, sets its password from `KALAIDO_USER_PASSWORD` (or a random one) **on every start**, mints an auth token and prints `KALAIDO_USER_TOKEN=<jwt>` to stdout for the desktop wrapper. Failures are logged, not fatal.
14. `reportPort` — `OnServe`: wraps the listener's base context to print `KALAIDO_PORT=<n>` and a banner once, when the listener binds.
15. `server.EnsureReady` — **fatal** if no provider factory is registered. Then `a.Start()`.

Nothing in the boot path performs a model call. Nothing resumes an interrupted generation; workers that keep their state in the database (§ 2) resume by re-deriving it.

## 2. Long-lived workers

All workers share one shape: a package-level `chan struct{}` of capacity 1 as the wake signal (a `Signal()` that finds the buffer full is a no-op, so bursts coalesce into one drain), a loop goroutine started in `Register`, and a drain that re-derives its worklist from the database each pass. None holds an in-memory queue of work items.

| Worker | Started by | Woken by | Drain reads | Retry / failure posture | Doc |
|---|---|---|---|---|---|
| **Colour prompt worker** | `colour.Register` (`go loop()`) | `colour.Signal()` — after every fragment create; colour create with a prompt; `Rematch`; and once at boot (`OnServe`, after `Next`) | every `colour` with a non-empty `prompt`, judged forward from its `prompt_matched_through` watermark | `ErrPreempted` → retried in place; `usage.ErrExhausted` aborts the whole drain; other errors move to the next colour (first error logged); auth/quota provider errors are stamped on the colour row | `colours.md` § 4 |
| **Reconcile wave worker** | `reconcile.Register` (`go workerLoop()`); also sets `engine.RequestWave` | `EnqueueWave()` — `POST /api/reconcile`, and a refinement commit of a chain-marked candidate | a fresh staleness evaluation (`rotation.md`) | **Disabled** by the compile-time constant `waveEnabled = false`: `EnqueueWave` logs and returns without signalling. When enabled: a signal arriving mid-wave coalesces into one follow-up wave; the first entity error ends the wave; `ErrPreempted` retries; `ErrLensNotReady`/`ErrGenerationInFlight` skip the entity | `rotation.md` § 3 |
| **Mapping annotate worker** | `mapping.Register` (`go loop()`) | `mapping.Signal()` — `POST /api/map`, and the ingest pipeline; `mapping.SignalAuto()` is a no-op while `autoMapEnabled = false` (it is `false`), so fragment creates and plain ingest completions do **not** wake it; at boot (`OnServe`, after `Next`) `SignalAuto` is called if any fragment lacks an annotation — also a no-op under the flag | every live fragment without a `fragment_annotation` row | up to 100 fragments annotated concurrently; a fragment that fails is skipped for the rest of the drain; `ErrExhausted` stops the drain; each call retries `ErrPreempted` indefinitely and quota/transient provider errors up to 6 times; after the drain, one map cycle runs (consolidate + settle hooks) regardless of errors | `map.md` § 2–3 |
| **Mapping aggregate loop** | `mapping.Register` (`go aggregateLoop()`) | a 10 s ticker, always | unfolded `fragment_annotation` rows | when consolidation is due (> 50 unfolded rows, or the newest unfolded row is older than 1 min) runs a cycle; otherwise only refreshes the map's `fragments`/`annotated` counters | `map.md` § 3 |
| **Discover worker** | `discover.Register` (`go loop()`) | `discover.Signal(kind)` — `POST /api/discover`, and the ingest pipeline; unknown kinds are ignored | the pending-kind set, drained in the fixed order colours → projections → reflections | one run per kind; a run's error is logged and the next kind still runs; each model call retries `ErrPreempted` indefinitely and quota/transient errors up to 6 times; run outcome is recorded on the `discover_run` row | `discover.md` § 2 |
| **Ollama preload** | `ollama.RegisterPreload` (`OnServe` → `go preloadDefaultModel`) | once at boot | — | asks Ollama to load the default model (`gemma4`) with a 60 min keep-alive; retries every 5 s for up to 2 min, then gives up with a log line. Runs whether or not Ollama is the active provider | `models.md` § 7 |

**Follow-up queue.** `mapping` and `discover` each own a `followup.Queue`: a mutex-guarded slice of `func(error)` callbacks. `AfterDrain(fn)` appends; the loop `Take`s the whole slice at the start of a drain and runs every callback with the drain's error once it ends. A callback registered *during* a drain therefore runs after the *next* one. The only registrant is the ingest pipeline (`ingestion.md` § 4), which chains mapping → discover(colours, projections, reflections) → done.

**Settle hooks.** `mapping.OnSettle` registers callbacks run after every map cycle, outside the aggregate lock. The only registrant is `colour.OnMapSettled`, which recomputes thing-backed colour membership when the map version or annotation count changed since it last ran (`colours.md` § 3).

## 3. Detached per-event goroutines

These are started by requests or hooks and outlive them; the request returns before they finish.

| Family | Started from | Runs | State on crash |
|---|---|---|---|
| **Ingest batch processing** | `OnRecordCreate("ingest")` hook, after the record is saved | parses every uploaded file, writes fragments, then updates the `ingest` row's `status`/`ingested`/`error` and either signals mapping or starts the pipeline | the row stays `pending`; nothing resumes it |
| **Reflection pending windows** | `engine.RunPendingWindows` — refinement commit on a reflection, and `POST /api/reflections/{id}/backfill` | `GeneratePendingWindows`: every window the reflection owes, generated as approved at background priority, one goroutine per window | windows without a snapshot are simply still pending next time; claim rows are swept at boot |
| **Generation fan-out** | `handleGenerateSnapshot` with several windows; `GenerateWindows` | one goroutine per window, joined before the response | as above |
| **Detached request contexts** | generate-snapshot and refinement-commit handlers use `context.WithoutCancel` | the operation completes even if the client disconnects | — |
| **Queue-status writer** | `registerQueueStatus` (`OnServe`): resets the `llm_queue_status` singleton to empty at boot, then subscribes to scheduler changes | each change is debounced 300 ms and written to the row (`state`, `running`, `waiting`); out-of-order deliveries are dropped by version | the row describes the process, not the workspace; reset at next boot |
| **Config validation** | `OnRecordUpdate("kalaidoscope_config")` | one goroutine per model to validate, joined under a 20 s shared deadline, *inside* the request | — |

## 4. What is not background

- Staleness (`rotation.md`) is computed on demand per request; there is no periodic evaluator.
- Snapshot generation from `POST …/candidates` and `…/generate-snapshot` runs on the request goroutine (or its fan-out), detached from cancellation but not from the request's lifetime.
- Colour **thing** membership is recomputed synchronously inside the settle hook, colour handlers, and the discover colours flow — never by the colour worker, which handles prompt membership only.
- There is no cron: `time.Tick` in the aggregate loop is the only timer-driven work.
