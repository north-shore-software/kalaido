# Organize — Generated Audit Snapshot

> **Generated:** 2026-09-03, from source at commit `f67e51c`.
> This file is a generated audit snapshot — do not edit it. See `AGENTS.md` § "Generated audit docs". When code described here changes, a stale marker line is prepended above this block; nothing else in the file is ever modified by hand.

**Scope.** The organise pipeline end to end: the derived status behind `GET /api/organize` — its axes, every state and the rule that selects it, which facts come from rows and which from the workers' in-flight flags, how a crash leftover is reported as interrupted, the surfaced policy flags, and what the status does not do — and the post-import chain that sequences mapping then discover after an import. Readers of the status (the onboarding splash) are out of scope. The workers it observes are described in `map.md`, `discover.md`, and `boot-and-workers.md`; the import that starts the chain is `ingestion.md` § 3.

**Completeness anchor.** 1 route (`GET /api/organize`, `server/server.go`); 1 evaluator (`organize.Evaluate`, `internal/organize/status.go`); 6 map states and 5 discover states (`internal/api/organize.go`); 5 in-flight accessors read (`mapping.Annotating`, `mapping.Consolidating`, `mapping.LastDrainError`, `discover.Running`, `discover.Pending`); 1 chain (`ingest.startPipeline`, `internal/ingest/pipeline.go`).

---

## 1. The route and the response

`GET /api/organize` → `organize.Evaluate` → `200` with:

```
{fragments, imports: {pending, lastError?},
 map: {state, version, annotated, pendingAnnotation, unfolded, lastRun?, lastDrainError?},
 discover: {state, running?, pending[], due[], runs: {<kind>: RunInfo}, proposals: {projections, reflections}},
 policy: {wave}}
```

`RunInfo` = `{id, status, error?, model?, rounds?, mapVersion?, finished, interrupted?}`; `finished` is the row's `updated` time in RFC3339 UTC whatever its status. Any database error aborts the evaluation → `500`. No body is read; the request's context and clock are accepted and unused.

## 2. Where each fact comes from

| Fact | Source | Survives restart |
|---|---|---|
| `fragments` | count of `fragment` with `deleted_at = ''` | yes |
| `imports.pending`, `imports.lastError` | `ingest` rows: count of `status = pending`; `error` of the newest `status = error` row | yes |
| `map.version`, thing count | `mapping.LoadDocument` — **creates the `kalaidoscope_map` singleton if absent** | yes |
| `map.annotated`, `map.unfolded` | counts of `fragment_annotation`, all and `folded = false` | yes |
| `map.pendingAnnotation` | `mapping.PendingCount`: live fragments without an annotation row | yes |
| `map.lastRun` | newest `map_run` row | yes |
| `map.lastDrainError` | `mapping.LastDrainError()`: the first error of the last annotate drain, empty after a clean one | no |
| annotating / consolidating | `mapping.Annotating()`, `mapping.Consolidating()` | no |
| `discover.running`, `discover.pending` | `discover.Running()`, `discover.Pending()` (kind order) | no |
| `discover.runs` | newest `discover_run` per kind | yes |
| `discover.due` | newest `status = done` run per kind vs `map.version` | yes |
| `discover.proposals` | counts of `projection` / `reflection` with `status = proposed` | yes |
| `policy.wave` | the compile-time `reconcile.WaveEnabled()` | constant |

In-flight flags are process memory: after a restart every worker reads as idle, which is what makes the interrupted rules in § 3–4 fire.

## 3. The map axis

`map.state` is the first matching rule:

| Order | State | Rule |
|---|---|---|
| 1 | `empty` | `fragments = 0` |
| 2 | `consolidating` | `mapping.Consolidating()` |
| 3 | `annotating` | `pendingAnnotation > 0` and `mapping.Annotating()` |
| 4 | `unannotated` | `pendingAnnotation > 0` |
| 5 | `folding` | `unfolded > 0` |
| 6 | `settled` | otherwise |

`lastRun` is present when any `map_run` exists, and `interrupted` when that run is `running` while `Consolidating()` is false — a consolidation the process did not finish. A map with fragments but no `map_run` reports `settled` or `folding` by the counters alone. `annotating` is only reachable while a drain is live in this process; an `unannotated` map is not being worked on until something signals the worker (`map.md` § 2).

## 4. The discover axis

For each kind in the fixed order `colours`, `projections`, `reflections`:

- `runs[kind]` = the newest run of that kind, with `interrupted` when it is `running` while `discover.Running()` is not that kind.
- `due` includes the kind when the map has at least one thing **and** either no `done` run of that kind exists or the newest `done` run's `map_version` is below the current map version. With no things, nothing is ever due.

`discover.state` is the first matching rule:

| Order | State | Rule |
|---|---|---|
| 1 | `running` | a run is executing now (`running` names the kind) |
| 2 | `pending` | at least one kind is signalled and waiting |
| 3 | `never_run` | no `discover_run` row of any kind exists |
| 4 | `due` | `due` is non-empty |
| 5 | `settled` | otherwise |

Consequences of the rules: a run refused before its row exists (empty map, or no colours for projections/reflections, `discover.md` § 2) leaves the axis at `never_run` or `due`; an `error` run counts as a run for `never_run` but not for `due`, so a kind whose only run failed stays `due`; `proposals` counts every proposed entity whatever run made it.

## 5. The imports axis

`pending` is the number of `ingest` rows still `pending` — including rows whose processing goroutine died with the process, which nothing resumes (`ingestion.md` § 3). `lastError` is the newest failed import's message and is never cleared by a later success.

## 6. Policy

`policy.wave` reports whether the speculative reconcile wave is compiled in (`rotation.md` § 3; `false` in this build). It is the only policy flag.

## 7. The post-import chain

An `ingest` record with `organize_after` set starts the chain when its processing goroutine finishes — whether or not the import succeeded (`ingestion.md` § 3). `startPipeline`:

1. Registers one follow-up on the mapping worker's queue.
2. Calls `mapping.Signal()` — a **full** drain: annotate every pending fragment, then one map cycle (consolidate and settle hooks, `map.md` § 2–3).
3. When that drain ends, the follow-up receives the drain's first error. On a **clean** drain it calls `discover.Signal` for `colours`, `projections`, `reflections`, in that order; the discover worker then runs them in that same order (`discover.md` § 2). On an errored drain it does nothing: no discover runs, and the only record of the stop is `map.lastDrainError`.

Follow-ups are taken at the **start** of a drain (`boot-and-workers.md` § 2), so a chain registered while a drain is already running is attached to the drain after it; its `Signal()` guarantees that later drain happens. Two imports completing close together coalesce into one wake and one follow-up list. Nothing about the chain is stored: a restart between the mapping drain and the discover runs drops the discover half, and the status then shows the kinds as `due` (§ 4) rather than pending.

## 8. What the organise status does not do

- It kicks nothing: reading it never signals a worker, starts a run, or touches an `ingest` row.
- It estimates nothing: no time remaining, no progress fraction; the counts are the raw material.
- It stores nothing, with one side effect: the first read on a fresh workspace creates the empty `kalaidoscope_map` row (`schema.md` § 4).
- It does not evaluate staleness of projections or reflections (`rotation.md`) and does not report colour-worker state; the colour axis has no accessor.
