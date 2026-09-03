# Map — Generated Audit Snapshot

> **Generated:** 2026-09-03, from source at commit `f67e51c`.
> This file is a generated audit snapshot — do not edit it. See `AGENTS.md` § "Generated audit docs". When code described here changes, a stale marker line is prepended above this block; nothing else in the file is ever modified by hand.

**Scope.** The workspace map: the per-fragment annotation worker and its pending set, the two ways it is woken, the aggregate loop and when it consolidates, what a consolidation rewrites, the things document and its version and run records, the kick route, the in-flight flags it exposes, and the settle callbacks other subsystems subscribe to. Who consumes the map — colours (`colours.md` § 3), discover (`discover.md`), summaries chat (`chat.md` § 5), the organise status (`organize.md`) — is described there. Model text is inventoried in `prompts.md` § 2. Worker mechanics are indexed in `boot-and-workers.md` § 2.

**Completeness anchor.** 1 route (`POST /api/map`); 3 collections (`kalaidoscope_map`, `fragment_annotation`, `map_run`); 2 goroutines in `internal/mapping/worker.go` + `aggregate.go`; 2 signals (`Signal`, `SignalAnnotate`); 2 model prompts (`AnnotatePrompt`, `ConsolidatePrompt`), each with one JSON retry.

---

## 1. Objects

- **The document** (`kalaidoscope_map`, singleton, server-written): `body` is one JSON document `{things[], relationships[], narrative}`; `version` increments per consolidation; `consolidated_at`; `fragments` and `annotated` counters. Created with `version 0` on first load by whichever reader comes first. A body that is empty, `{}`, `null`, unparseable, or lacks a `things` key parses as an **empty** document without error.
- **A thing**: `{id, name, aliases[], kind, blurb, fragments, first_seen?, last_seen?, exemplar_ids[]}`. `kind` ∈ `person`, `organisation`, `place`, `project`, `topic`, `other` (`organization`/`company`/`org` normalise to `organisation`; anything else to `other`). Ids are minted server-side: `t_` + 8 lower-case base32 chars from 5 random bytes. `fragments`, `first_seen`, `last_seen`, `exemplar_ids` (≤ 5) are recomputed at every consolidation from citations, never taken from the model.
- **A relationship**: `{from, to, kind}` by thing id.
- **An annotation row** (`fragment_annotation`, one per fragment, unique on `fragment_id`, client-readable): `title`, `summary`, `things` (exactly the model's citations: `{ref}` or `{name, kind, note}`), `decisions`/`questions`/`conclusions` (`[{text, refs[]}]`), `grounded_count` (things shown to the model), `folded` (consumed by a consolidation), `model`. A legacy `annotation` field is kept and never read.
- **A run** (`map_run`): one per consolidation model call — `status` (`running`/`done`/`error`), `error`, `model`, `pending_in`, `admits`, `merges`, `version_before`, `version_after`.

## 2. Annotation (the worker drain)

**Pending set** = every fragment with `deleted_at = ''` that has no annotation row, ordered non-imports first (`origin != "import"`), then by `source_time` ascending.

**Two signals, one channel.** `SignalAnnotate()` wakes the worker for an annotate-only drain. `Signal()` sets a "settle wanted" flag and then wakes it; the flag is consumed at the start of the next drain, which then ends with one map cycle (§ 3.2). Because the channel holds one wake, several signals coalesce into one drain, and a full request is never lost to coalescing — but a `Signal()` that lands while a drain is already running is honoured by the drain *after* it. Callers: `SignalAnnotate` — every non-import fragment create (`ingestion.md` § 7), an ingest completion without `organize_after` (`ingestion.md` § 3), and boot when any fragment is pending; `Signal` — `POST /api/map` (§ 5) and the post-import chain (`organize.md` § 7).

The drain resolves `RoleAnnotate` once (a resolution failure ends the drain before any work, without a cycle), then loops: recompute the pending set, drop fragments that failed earlier in this drain, stop when empty. Up to 100 fragments are annotated concurrently. Each `annotateOne`:

1. Loads the current document (fresh per fragment, so later fragments in a drain see things admitted by a consolidation the aggregate loop ran meanwhile).
2. Prompt = `AnnotatePrompt(doc, FragmentBlock)`; the map block lists only things with ≥ 2 fragments (`annotateInlineFloor`), relationships among them, and the narrative; an empty map gets a one-line notice. `grounded_count` records how many things were shown.
3. One call at `RoleAnnotate` (temperature 0), retried on preemption and up to 6 times on quota/transient errors. An unparseable reply gets **one** retry with `MapJSONRetryNudge` appended to the conversation; still unparseable → the fragment fails for this drain.
4. Saves the annotation row with `folded = false`.

A failure marks the fragment failed for the rest of the drain (it is retried on the next signal); `usage.ErrExhausted` stops dispatching further fragments. After the loop — success or not — a full drain runs one **cycle** (§ 3.2); an annotate-only drain ends here and leaves the rows for the aggregate loop. The drain's first error is stored as `LastDrainError` (an error-free drain clears it) and passed to the follow-up callbacks (`organize.md` § 7). While the loop runs, `Annotating()` reports true.

## 3. Aggregation

### 3.1 When consolidation is due

The aggregate loop ticks every 10 s. It queries unfolded annotation rows (`folded = false`, newest first): none → not due; more than 50 → due; otherwise due when the newest unfolded row is older than 1 minute. When not due the loop only refreshes the document's `fragments` (live fragment count) and `annotated` (annotation row count) counters, saving only if they changed. Boot does not trigger a consolidation; the first tick does if rows are waiting.

### 3.2 A cycle

`cycle` = `integrate` (under the aggregate mutex, with `Consolidating()` reporting true: `consolidate` then `refreshCounters`) followed by every settle hook, outside the mutex. `WaitSettled` lets readers (discover) block until no integration is in progress.

### 3.3 Consolidation

Skipped silently when no unfolded rows exist. Otherwise:

1. Loads **all** annotation rows (`LoadRows`: every row, dated by its fragment's `source_time` day where the fragment is live — a row whose fragment is soft-deleted or has no source time gets an empty date — sorted by date), and the current document.
2. Creates a `map_run` (`running`, model, `pending_in` = unfolded count, `version_before`).
3. Prompt = `ConsolidatePrompt(doc, rows)`: the current map as JSON (or a first-run notice) and **every** row (`--- id · date · title ---`, summary, citations). One call at `RoleMap` (temperature 0), same retry policy as annotation; one JSON retry with `ConsolidateJSONRetryNudge`. Failure → run `error` with the message; nothing else changes and the rows stay unfolded (the next tick retries).
4. `finishDocument` post-processes the model's document: things without an `id` get one minted (`admits`); every thing's `kind` normalised and `aliases` non-nil; counters reset; things present before and absent now count as `merges` (they are gone — no tombstone, no alias check); relationships resolved by id **or exact name/alias** to ids, dropping self-links, unresolvable ends, and duplicates; then every row's citations (by `ref`, else `name`) are resolved against the new document to bump `fragments`, `first_seen`/`last_seen` (from the row's date), and the first 5 `exemplar_ids`.
5. In one transaction: `version + 1`, `consolidated_at = now`, body saved; every previously-unfolded row set `folded = true`.
6. Run set `done` with `admits`, `merges`, `version_after`.

Consolidation is a whole-document rewrite: the model returns the entire map every time, and whatever it omits is gone. Citations in old rows that no longer resolve simply stop counting. A run row left at `running` means the process died mid-call, or the error write itself failed; nothing cleans it up.

## 4. Reads exposed to other packages

- `LoadDocument` → the parsed document and its version.
- `LoadRows` → every annotation row as `{FragmentID, Date, Title, Summary, Things}` sorted by date (soft-deleted fragments' rows included, undated).
- `ResolveRef(doc, ref)` → a thing by id, else by normalised name or alias (lower-cased, whitespace-collapsed, trailing punctuation stripped).
- `IndexRows(doc, rows)` → thing id → row indexes citing it.
- `PendingCount` → the size of the pending set (§ 2).
- In-flight flags: `Annotating()`, `Consolidating()`, `LastDrainError()` — process memory, reset at boot.
- `WaitSettled()`, `OnSettle(fn)`, `Signal()`, `SignalAnnotate()`, `AfterDrain(fn)`.

## 5. The kick route

`POST /api/map` → `mapping.Signal()` → **202** with no body. Nothing is validated and nothing is returned about the resulting drain; progress is observable as `fragment_annotation` rows and the document's counters over the realtime channel, and as the map axis of `GET /api/organize` (`organize.md` § 3).

## 6. What the map does not do

- No re-annotation: a fragment is annotated once; an edited fragment keeps its old row. `grounded_count` exists for a thin-tail re-annotation pass that has no implementation.
- No per-fragment integration: rows are folded only by a full consolidation.
- No deletion handling: a soft-deleted fragment's row stays, keeps citing things, and is still sent to the consolidation prompt.
- No automatic map cycle for fragments that arrive outside an import: their annotate-only drain leaves the rows unfolded until the aggregate loop's due rule picks them up.
