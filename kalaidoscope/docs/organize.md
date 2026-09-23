> **STALE** — code has changed since this document was generated.

# Organize — Generated Audit Snapshot

> **Generated:** 2026-09-17, from source at commit `895984c`.
> This file is a generated audit snapshot — do not edit it. See `AGENTS.md` § "Generated audit docs". When code described here changes, a stale marker line is prepended above this block; nothing else in the file is ever modified by hand.

**Scope.** The organise pipeline end to end: the derived status behind `GET /api/organize` — its axes, every state and the rule that selects it, which facts come from rows and which from the workers' in-flight flags, how a crash leftover is reported as interrupted, the surfaced policy flag, and what the status does not do — and the post-import chain that sequences mapping then discover after an import. Readers of the status (the onboarding splash, the dashboard's Start button) are out of scope. The workers it observes are described in `map.md`, `discover.md`, `rotation.md` and `boot-and-workers.md`; the import that starts the chain is `ingestion.md` § 3.

**Completeness anchor.** 1 route (`GET /api/organize`, `server/server.go`); 1 evaluator (`organize.Evaluate`, `internal/organize/status.go`); 6 map states and 5 discover states, and a 6-field top-level response struct with 7 nested structs (`internal/api/organize.go`); 7 in-flight accessors read (`mapping.Annotating`, `mapping.Consolidating`, `mapping.LastDrainError`, `discover.Running`, `discover.Pending`, `reconcile.WaveEnabled`, `reconcile.Status`); 1 chain (`ingest.startPipeline`, `internal/ingest/pipeline.go`).

---

## 1. The route and the response

`GET /api/organize` (`handlers.HandleGetOrganize`) → `organize.Evaluate(requestCtx, app, time.Now())` → `200` with the `api.OrganizeStatus` struct:

```
{fragments,
 imports:   {pending, lastError?},
 map:       {state, version, annotated, pendingAnnotation, unconsolidated, lastRun?, lastDrainError?},
 discover:  {state, running?, pending[], due[], runs: {<kind>: RunInfo}, proposals: {projections, reflections}},
 policy:    {wave},
 reconcile: {running, lastStarted?, lastError?, lastCompleted?}}
```

`RunInfo` = `{id, status, error?, model?, rounds?, mapVersion?, finished, interrupted?}`. Fields marked `?` carry `omitempty` and are absent when zero/empty/false; every other field is always present (`pending`, `due` and `runs` are initialised empty, never `null`). `finished` is the row's `updated` autodate in RFC3339 UTC whatever its status; `model` is the row's `generated_by_model`; `rounds` and `mapVersion` are the row's `rounds` and `map_version`, which only `discover_run` rows have — on a `map_run` they read `0` and are omitted.

The first database error aborts the evaluation: the handler logs `organize.status: evaluation failed: …` and returns `500` (`failed to evaluate organize status`). No request body, query or path input is read. The request context and the clock are passed to `Evaluate` and unused — cancellation does not stop the evaluation and every timestamp comes from rows or worker memory. The route has no per-route auth middleware; router-wide behaviour is `api.md` § 1.

## 2. Where each fact comes from

| Fact | Source | Survives restart |
|---|---|---|
| `fragments` | count of `fragment` with `deleted_at = ''` | yes |
| `imports.pending`, `imports.lastError` | `ingest` rows: count of `status = pending`; `error` of the newest (`-created`) `status = error` row | yes |
| `map.version`, thing count | `mapping.LoadDocument` — reads the `kalaidoscope_map` singleton and **creates it (`version = 0`, empty body) if absent** | yes |
| `map.annotated`, `map.unconsolidated` | counts of `fragment_annotation`, all rows and rows with `consolidated_at = ''` | yes |
| `map.pendingAnnotation` | `mapping.PendingCount`: fragments with `deleted_at = ''` that have no `fragment_annotation` row | yes |
| `map.lastRun` | newest (`-created`) `map_run` row | yes |
| `map.lastDrainError` | `mapping.LastDrainError()`: the error of the last annotate drain, `""` after a clean one | no |
| annotating / consolidating | `mapping.Annotating()`, `mapping.Consolidating()` | no |
| `discover.running`, `discover.pending` | `discover.Running()` (kind name or `""`), `discover.Pending()` (signalled kinds, in kind order) | no |
| `discover.runs` | newest (`-created`) `discover_run` per kind | yes |
| `discover.due` | newest `status = done` run per kind vs `map.version`, only when the map has things | yes |
| `discover.proposals` | counts of `projection` / `reflection` with `status = proposed` and `deleted_at = ''` | yes |
| `policy.wave` | `reconcile.WaveEnabled()`: whether `KALAIDO_AUTO_WAVE` was non-empty at process start | constant per process |
| `reconcile.*` | `reconcile.Status()`: one locked snapshot of the wave worker's `running`, `lastStarted`, `lastError`, `lastCompleted` | no |

In-flight flags and the reconcile snapshot are process memory: after a restart every worker reads as idle, the reconcile block collapses to `{running: false}`, and `lastDrainError` is empty. That is what makes the interrupted rules in § 3–4 fire. `annotated` counts annotation rows regardless of their fragment's `deleted_at`, while `pendingAnnotation` counts only live fragments, so `annotated + pendingAnnotation` can exceed `fragments`.

## 3. The map axis

`map.state` is the first matching rule:

| Order | State | Rule |
|---|---|---|
| 1 | `empty` | `fragments = 0` |
| 2 | `consolidating` | `mapping.Consolidating()` |
| 3 | `annotating` | `pendingAnnotation > 0` and `mapping.Annotating()` |
| 4 | `unannotated` | `pendingAnnotation > 0` |
| 5 | `folding` | `unconsolidated > 0` |
| 6 | `settled` | otherwise |

`lastRun` is present when any `map_run` row exists and carries `interrupted: true` when that row's `status` is `running` while `Consolidating()` is false — a consolidation the process did not finish (the row is created `running` before the model call and finished `done` or `error`, `map.md` § 3). `lastRun` surfaces only `id`, `status`, `error`, `model` and `finished`; the row's `pending_in`, `admits`, `merges`, `version_before` and `version_after` are not reported. A map with fragments but no `map_run` reports by the counters alone. `annotating` is only reachable while an annotate drain is live in this process; `unannotated` says nothing about whether a worker will pick the fragments up (`map.md` § 2 for what signals it). `folding` is named after the pre-consolidation state of the rows it counts: annotation rows whose `consolidated_at` is empty.

## 4. The discover axis

For each kind in the fixed order `colours`, `projections`, `reflections` (`discover.KindOrder()`):

- `runs[kind]` = the newest run of that kind, with `interrupted: true` when its `status` is `running` while `discover.Running()` is not that kind. A run in progress in this process therefore never reads as interrupted, and `running` names its kind from the moment the worker takes it — including while it waits for a consolidation to finish and before its row exists (`discover.md` § 2).
- `due` includes the kind when the map has at least one thing **and** either no `status = done` run of that kind exists or the newest `done` run's `map_version` is below the current `map.version`. With no things the check is skipped and nothing is ever due.

`discover.state` is the first matching rule:

| Order | State | Rule |
|---|---|---|
| 1 | `running` | `discover.Running() != ""` (`running` names the kind) |
| 2 | `pending` | `discover.Pending()` is non-empty — at least one kind is signalled and waiting |
| 3 | `never_run` | no `discover_run` row of any kind exists |
| 4 | `due` | `due` is non-empty |
| 5 | `settled` | otherwise |

Consequences of the rules: a run refused before its row exists (empty map, or no colours for projections/reflections, `discover.md` § 2) leaves the axis at `never_run` or `due`; an `error` run counts as a run for `never_run` but not for `due`, so a kind whose only run failed stays `due`; a kind signalled while another is running is reported in `pending` and the axis reads `running`; `proposals` counts every live proposed entity whatever created it, and excludes soft-deleted rows.

## 5. The imports axis

`pending` is the number of `ingest` rows still `pending` — including rows whose processing goroutine died with the process, which nothing resumes (`ingestion.md` § 3). `lastError` is the newest failed import's `error` text and is never cleared by a later success; it is absent only while no `ingest` row has `status = error`.

## 6. The reconcile axis

`reconcile` mirrors `reconcile.Status()`, a snapshot taken under one lock so `running` and `lastStarted` are always read together:

| Field | Set when |
|---|---|
| `running` | `true` from the moment the wave worker takes a signal until the wave returns |
| `lastStarted` | the wall-clock time the most recent wave began; absent until a wave has started in this process |
| `lastError` | the error that ended the most recent wave; cleared to absent by a wave that ends clean |
| `lastCompleted` | the wall-clock time the most recent wave ended without error; absent until one has; not touched by a failed wave |

Times are RFC3339 UTC. Nothing here is stored: the block only ever describes waves run by the current process. What starts a wave (the `POST /api/reconcile` Start, the automatic triggers, the retry timers after a failed wave) and what a wave does are `rotation.md` § 3.

## 7. Policy

`policy.wave` reports whether automatic waves are on: `reconcile.WaveEnabled()`, which is `true` when the `KALAIDO_AUTO_WAVE` environment variable was non-empty when the process started (any value, `0` included). When `false` the only wave is the one the dashboard starts (`rotation.md` § 3). It is the only policy flag.

## 8. The post-import chain

An `ingest` record's processing goroutine (`processIngestRecord`, started by the `ingest` create hook, `ingestion.md` § 3) ends by saving the row `done` or `error`, then — when the row was created with `organize_after` true — calls `startPipeline`, whether or not the import succeeded and even when it ingested nothing. (Without `organize_after` it calls `mapping.SignalAnnotate()` instead: an annotate-only drain with no settle and no discover. Before either, an import that wrote at least one fragment calls `reconcile.EnqueueWave()`, a no-op unless `policy.wave` is on — `rotation.md` § 3.) `startPipeline`:

1. Registers one follow-up on the mapping worker's queue (`mapping.AfterDrain`).
2. Calls `mapping.Signal()` — a **full** drain: annotate every pending fragment, then one map cycle (consolidate, then the settle hooks: colour rematch, then the reconcile trigger; `map.md` § 2–3).
3. When that drain ends, the follow-up receives the drain's error: the first annotate failure, or the failure to resolve the annotate model. A consolidation failure is not part of it — it is logged, recorded on the `map_run` row as `error`, and the drain still returns clean. On a **nil** error the follow-up calls `discover.Signal` for `colours`, `projections`, `reflections`, in that order; the discover worker then runs the pending kinds in that same order, each waiting for any consolidation in progress before it reads the map (`discover.md` § 2). On a non-nil error it returns without signalling: no discover runs, and the only record of the stop is `map.lastDrainError` (and the log).

Follow-ups are taken at the **start** of a drain (`boot-and-workers.md` § 2), so a chain registered while a drain is already running is attached to the drain after it; the `Signal()` in step 2 (a one-slot wake plus the settle flag) guarantees that later drain happens and is full. Two imports completing close together coalesce into one wake and one follow-up list. Nothing about the chain is stored: a restart between the mapping drain and the discover runs drops the discover half, and the status then shows the kinds as `due` (§ 4) rather than `pending`. Discover's own follow-up queue (`discover.AfterDrain`) has no registrant; the chain ends with the discover runs.

## 9. What the organise status does not do

- It kicks nothing: reading it never signals a worker, starts a run or a wave, or touches an `ingest` row. The kicks live on `POST /api/map`, `POST /api/discover` and `POST /api/reconcile` (`map.md` § 5, `discover.md` § 2, `rotation.md` § 3).
- It estimates nothing: no time remaining, no progress fraction; the counts are the raw material.
- It stores nothing, with one side effect: the first read on a fresh workspace creates the empty `kalaidoscope_map` row (`schema.md` § 2).
- It does not evaluate staleness of projections or reflections (`rotation.md` § 1–2) and does not report the colour worker's state: `internal/colour` exposes no in-flight accessor, and the colour axis has none.
- It reads nothing from the request: no filters, no scoping, no conditional responses.
