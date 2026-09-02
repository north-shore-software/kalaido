# Discover — Generated Audit Snapshot

> **Generated:** 2026-09-02, from source at commit `3998ebd`.
> This file is a generated audit snapshot — do not edit it. See `AGENTS.md` § "Generated audit docs". When code described here changes, a stale marker line is prepended above this block; nothing else in the file is ever modified by hand.

**Scope.** The discover flows: the run record and its states, the tool loop shared by every flow, the reads it exposes over the map, the three flow kinds and their fixed order, what each proposes versus creates as real rows, the rhythm detection that feeds the reflections flow, and how runs are kicked and retried. Prompt and tool text is inventoried in `prompts.md` § 2–3; the worker's place among the others is `boot-and-workers.md` § 2; the map it reads is `map.md`.

**Completeness anchor.** 3 flow kinds registered in `internal/discover/flow.go` (`colours`, `projections`, `reflections`); 1 route (`POST /api/discover`); 1 collection (`discover_run`); 5 shared tools + 4 flow tools (`prompts.md` § 3).

---

## 1. The run

`discover_run` (client-readable, server-written): `kind`, `status` (`running` → `done` | `error`), `error`, `map_version` (the document version the run read), `model`, `rounds`, `fragment_reads`, `outputs` (JSON `[{kind, id, name, status?}]` — what the run created or proposed), `summary` (the model's closing note from `finish`, or its final text). Progress is saved after every round, so an interrupted run leaves a `running` row with partial `outputs`; nothing resumes or cleans it.

Entities a run writes carry `origin_run_id`; proposed projections and reflections also carry `brief` (the proposed opening message) and `status = "proposed"`.

## 2. Kick, worker, and order

`POST /api/discover` `{kind}` → 400 for an unknown kind, else `discover.Signal(kind)` → 202. The ingest pipeline signals all three kinds after a mapping drain (`ingestion.md` § 4). The worker drains pending kinds in the fixed order **colours → projections → reflections** (so later flows can scope by the colours just created), one `Run` each; a run's error is logged and recorded on its row and the next kind still runs. The last error is passed to follow-up callbacks.

`Run(flow)`: resolves `RoleMap` (no override); `mapping.WaitSettled()` so a consolidation in progress lands first; builds a `Reader` over one snapshot of the document and rows; an empty map (no things) is an error (`the map is empty`) before any run row exists; creates the run row; runs the loop at **Background** priority; finishes the row.

## 3. The tool loop

`runLoop` opens with the flow's system prompt and one user turn: the flow's initial block, then `What already exists:` (§ 3.1) and `Coverage now:` (§ 3.2). Up to **30 rounds**; each round is one `GenerateWithToolCalls` at `RoleMap` (temperature 0), retried on preemption and up to 6 times on quota/transient errors. The assistant text plus `[You called: …]` is appended; a round with no tool calls ends the run (`done`, no summary). Tool calls are dispatched in order and their results joined as the next user turn:

| Tool | Result |
|---|---|
| `read_thing {ids}` | Up to 10 thing cards (§ 3.3); more → truncated with a note |
| `read_fragment {id}` | The fragment's full `FragmentBlock`; budget **12 per run** (`fragment_reads`), exhausted → a fixed message |
| `list_existing` | Recomputed § 3.1 |
| `coverage` | § 3.2 over the latest `list_existing` result |
| `finish {summary}` | Ends the run after this round; `summary` = the assistant text, else the tool argument |
| flow tool | The flow's `Dispatch`; a rejected call returns `Rejected: <reason>` as an ordinary result and the run continues |
| unknown | `Rejected: no tool named …` |

A `Dispatch` that returns a Go error (database failure) ends the run as `error`. Reaching 30 rounds ends it as `done` without a summary.

### 3.1 `list_existing`

Every `colour` (description: `prompt: …; built on <thing names>`, members = `MemberIDs`), then every `projection` and `reflection` regardless of status (description = `brief`; fragments = its `current_context_spec` resolved now, unwindowed; a note when `status = proposed`: `proposed by this run` or `proposed by an earlier run, not yet opened`). Fragment counts are live at call time.

### 3.2 `coverage`

Covered = the union of every existing entity's fragment ids and every id this run marked covered (colour members on creation, proposal scopes). Reports `hit of total rows (pct%)` and the 10 things with the most uncovered citing rows.

### 3.3 The reader (`read_thing`, `read_fragment`)

`Reader` holds one document, all rows, and the thing → rows index for the whole run. A thing card: header, blurb, citing count and span, relationships (both directions), a month histogram of citing rows (`undated` bucket for rows without a date), and up to 30 rows sampled evenly across the citing set. The same reader type serves the summaries chat with a **12 per turn** budget and chat-specific wording (`chat.md` § 5).

## 4. The colours flow (creates)

Tool `create_colour {name, thingIds}`. Rejections: blank name; no things; an unresolvable ref; a **ubiquitous** thing (§ 6.3). Refs are canonicalised to ids and deduplicated. Creates a `colour` row with `name`, `thing_ids`, `origin_run_id` — **no prompt** — then `RematchThingsFor` so membership exists immediately, marks the members covered, and records `{kind: colour}` in `outputs`. Colours are real rows the moment they are created; nothing is proposed.

## 5. The projections flow (proposes)

Tool `propose_projection {name, message, thingIds, fragmentIds, colourIds, sourceProjectionIds}`. Rejections: blank name or message; any unresolvable thing ref, unknown fragment, colour, or projection id; a scope with nothing in it. Scope: `fragmentIds` = the union of every row citing the things plus the explicit fragments; `colourIds`; `sourceProjectionIds` (which may name projections proposed earlier in the same run). Writes a `projection` with `status = proposed`, `brief = message`, `current_context_spec = {fragmentIds, colourIds, sourceProjectionIds}`, `origin_run_id`; no lens, no snapshot, no window. Marks the fragments covered; `outputs` entry `{kind: projection, status: proposed}`.

A proposed entity is invisible to staleness (`rotation.md` evaluates `status = active` only) and becomes `active` when a refinement is committed on it (`refinement.md` § 5). Nothing else changes the status; the only other exit is `DELETE`.

## 6. The reflections flow (proposes)

Tools `rhythms {grain, thingIds?}` and `propose_reflection {name, message, thingIds, fragmentIds, colourIds, cadence, startTime}`.

### 6.1 Proposal

Rejections: blank name/message; unknown cadence (not one of `daily`, `weekly`, `monthly`, `quarterly`); `startTime` not parseable as `YYYY-MM-DD`, RFC3339, or `YYYY-MM`; a start in the future; a start whose periods to now exceed 1000 (`engine.MaxGridWindows`); unresolvable or ubiquitous things; unknown fragments or colours; an empty scope (`sourceProjectionIds` is not accepted here). The schedule is built in Go: `period` = `24h`/`168h`/`720h`/`2160h`, `duration = period`, `startTime` = the start floored to midnight UTC; `window_spec_versions` = one version **effective from that start** (so every grid window since is pending once a lens exists, `lifecycle-reflection.md` § 2). Writes a `reflection` row as in § 5 with `current_context_spec = {fragmentIds, colourIds}`.

### 6.2 Rhythm detection (`rhythm.go`)

Computed from annotation rows, never asked of the model. Rows are bucketed by their date at a grain: **month** (calendar month) or **week** (ISO week, Monday start). For every thing with ≥ 5 citing rows (`worklistFloor`), and every **pair** of non-ubiquitous such things cited in the same row: `Total` rows, `ActiveBuckets` (distinct buckets), `SpanBuckets` (first to last inclusive), `First`/`Last` bucket starts, and `Onset` = the start of the first run of ≥ 3 consecutive active buckets, else the first active bucket. Undated rows count toward `Total` only.

Ordering: rhythms below 3 active buckets sort last; then by regularity (`Active/Span`) desc, `Total` desc, first thing id. Pairs with fewer than 3 active buckets are dropped; singles keep at most 25, pairs at most 25. The initial turn carries the month-grain block; `rhythms` recomputes at either grain, optionally restricted to given things (and the pairs including them). Each card shows up to 12 evenly sampled buckets with count and one title.

### 6.3 Ubiquity

A thing is ubiquitous when there are ≥ 20 rows and it is cited in more than 40 % of them. Ubiquitous things are flagged on their card, excluded from pairing, and rejected as a scope by the colours and reflections flows (not by the projections flow).

## 7. What discover does not do

- It never generates output, drafts a lens, or opens a refinement; a proposal is handed to the client through the `proposed` status and `brief`.
- It never deletes or edits an existing entity, and never re-runs on its own; each run is one kick.
- It never reads fragment bodies beyond the 12-read budget, and never sees prompt-colour rules beyond the prompt text in `list_existing`.
