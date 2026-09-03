# Discover — Generated Audit Snapshot

> **Generated:** 2026-09-03, from source at commit `f67e51c`.
> This file is a generated audit snapshot — do not edit it. See `AGENTS.md` § "Generated audit docs". When code described here changes, a stale marker line is prepended above this block; nothing else in the file is ever modified by hand.

**Scope.** The discover flows: the run record and its states, the guards a run must pass, the tool loop shared by every flow, the reads it exposes over the map and the colours, the three flow kinds and their fixed order, what each proposes versus creates as real rows, the coverage measure each uses, the rhythm detection and cover lines that feed the reflections flow, and how runs are kicked and retried. Prompt and tool text is inventoried in `prompts.md` § 2–3; the worker's place among the others is `boot-and-workers.md` § 2; the map it reads is `map.md`; the status a client reads to see whether a run is due or interrupted is `organize.md` § 4.

**Completeness anchor.** 3 flow kinds registered in `internal/discover/flow.go` (`colours`, `projections`, `reflections`); 1 route (`POST /api/discover`); 1 collection (`discover_run`); 5 shared tools + 5 flow tool definitions (`prompts.md` § 3), one of which (`read_colour`) two flows share.

---

## 1. The run

`discover_run` (client-readable, server-written): `kind`, `status` (`running` → `done` | `error`), `error`, `map_version` (the document version the run read), `model`, `rounds`, `fragment_reads`, `outputs` (JSON `[{kind, id, name, status?}]` — what the run created or proposed), `summary` (the model's closing note from `finish`, or its final text). Progress is saved after every round, so an interrupted run leaves a `running` row with partial `outputs`; nothing resumes or cleans it (the organise status reports it as interrupted, `organize.md` § 4).

Entities a run writes carry `origin_run_id`; proposed projections and reflections also carry `brief` (the proposed opening message) and `status = "proposed"`.

## 2. Kick, worker, guards, and order

`POST /api/discover` `{kind}` → 400 for an unknown kind, else `discover.Signal(kind)` → 202. The post-import chain signals all three kinds after a clean mapping drain (`organize.md` § 7). The worker drains pending kinds in the fixed order **colours → projections → reflections** (so later flows can scope by the colours just created), one `Run` each; a run's error is logged and recorded on its row and the next kind still runs. The last error is passed to follow-up callbacks (none are registered). While a run executes, `Running()` names its kind; `Pending()` lists the kinds signalled but not yet started.

`Run(flow)`: resolves `RoleMap` (no override); `mapping.WaitSettled()` so a consolidation in progress lands first; builds the run **context** — a `Reader` over one snapshot of the document and rows (§ 3.3) plus every colour's membership indexed against those rows (§ 3.4). Two guards then apply **before any run row exists**, so a refused run leaves no record: an empty map (no things) → `the map is empty`; for the projections and reflections flows, no colour at all → `no colours exist yet`. Then the run row is created, the loop runs at **Background** priority, and the row is finished.

## 3. The tool loop

`runLoop` opens with the flow's system prompt and one user turn: the flow's initial block, then `What already exists:` (§ 3.1) and `Coverage now:` (§ 3.2, in the flow's measure). Up to **30 rounds**; each round is one `GenerateWithToolCalls` at `RoleMap` (temperature 0), retried on preemption and up to 6 times on quota/transient errors. The assistant text plus `[You called: …]` is appended; a round with no tool calls ends the run (`done`, no summary). Tool calls are dispatched in order and their results joined as the next user turn:

| Tool | Result |
|---|---|
| `read_thing {ids}` | Up to 10 thing cards (§ 3.3); more → truncated with a note |
| `read_fragment {id}` | The fragment's full `FragmentBlock`; budget **12 per run** (`fragment_reads`); exhausted → a fixed message; an unknown id does not spend the budget |
| `list_existing` | Recomputed § 3.1 |
| `read_colour {ids}` | Up to 10 colour cards (§ 3.4); dispatched by the loop for every flow, advertised only to projections and reflections |
| `coverage` | § 3.2 over the latest `list_existing` result |
| `finish {summary}` | Ends the run after this round; `summary` = the assistant text, else the tool argument |
| flow tool | The flow's `Dispatch`; a rejected call returns `Rejected: <reason>` as an ordinary result and the run continues |
| unknown | `Rejected: no tool named …` |

A `Dispatch` that returns a Go error (database failure) ends the run as `error`. Reaching 30 rounds ends it as `done` without a summary.

### 3.1 `list_existing`

Every `colour` (description: `prompt: …; built on <thing names>` — either half omitted when empty; members = `MemberIDs`, every link except `manual_negative`), then every `projection` and `reflection` regardless of status (description = `brief`; fragments = its `current_context_spec` resolved now, unwindowed; a note when `status = proposed`: `proposed by this run` or `proposed by an earlier run, not yet opened`). Fragment counts are live at call time.

### 3.2 `coverage`

Two measures, chosen by flow. Both report `hit of total annotated rows (pct%)` and up to 10 gaps sorted by uncovered count.

- **Colours flow** (`coverage`): covered = every existing entity's fragment ids (colours included) ∪ every id this run marked covered. Gaps are **things** with uncovered citing rows.
- **Projections and reflections flows** (`colourCoverage`): covered = the fragment ids of existing **projections and reflections only** ∪ this run's covered set; a colour is what gets covered, not a cover. Gaps are **colours**, measured over their annotated members.

### 3.3 The reader (`read_thing`, `read_fragment`)

`Reader` holds one document, all rows, and the thing → rows index for the whole run. A thing card: header (id, name, kind, aliases), blurb, citing count and span, relationships (both directions), a month histogram of citing rows (`undated` bucket for rows without a date), and up to 30 rows sampled evenly across the citing set. The same reader type serves the summaries chat with a **12 per turn** budget and chat-specific wording (`chat.md` § 5).

### 3.4 Colours in the run context

At run start every colour is loaded in created order with: its `thing_ids` resolved through the map (unresolvable refs dropped), its members, the subset of members that have annotation rows (as row indexes), and the first/last dated row among them. A colour is resolved by id, else by case-insensitive exact name. A **ubiquitous colour** is one whose annotated members exceed 40 % of all rows when there are ≥ 20 rows. A colour card (`read_colour`) shows the colour line (`id · name · built on … · N fragments · span`), a month histogram of its annotated members, and up to 30 sampled rows; a colour with no annotated member says so. The colours block on the initial turn is one line per colour in the same shape. This index is built once per run: a colour the same run creates is visible to `list_existing` (which reads the database) but not to the colour index.

## 4. The colours flow (creates)

Tool `create_colour {name, thingIds}`. Rejections: unreadable arguments; blank name; no things; an unresolvable ref; a **ubiquitous** thing (§ 6.3). Refs are canonicalised to ids and deduplicated. Creates a `colour` row with `name`, `thing_ids`, `origin_run_id` — **no prompt** — then `RematchThingsFor` so membership exists immediately, marks the members covered, and records `{kind: colour}` in `outputs`. Colours are real rows the moment they are created; nothing is proposed. Initial turn: narrative, things with ≥ 5 fragments heaviest first, relationships, guidance.

## 5. The projections flow (proposes)

Tools `read_colour` and `propose_projection {name, message, colourIds, sourceProjectionIds}`. Initial turn: narrative, the colours block, relationships, guidance — no things list. Rejections, in order: unreadable arguments; blank name or message; a colour ref that resolves to nothing; a ubiquitous colour; a `sourceProjectionIds` entry that is not an existing `projection` row (proposed ones from this run qualify, since they are rows); a scope with neither colours nor sources. Writes a `projection` with `status = proposed`, `brief = message`, `current_context_spec = {colourIds, sourceProjectionIds}`, `origin_run_id`; no fragments are pinned, no lens, no snapshot, no window. Marks the colours' current members covered; `outputs` entry `{kind: projection, status: proposed}`; the result reports the member count as the scope size.

A proposed entity is invisible to staleness (`rotation.md` evaluates `status = active` only) and becomes `active` when a refinement is committed on it (`refinement.md` § 5). Nothing else changes the status; the only other exit is `DELETE`.

## 6. The reflections flow (proposes)

Tools `read_colour`, `rhythms {grain, thingIds?}` and `propose_reflection {name, message, thingIds, colourIds, cadence, startTime}` (all six declared required). Initial turn: narrative, the colours block, the month-grain rhythms block (§ 6.2), guidance.

### 6.1 Proposal

Checks, in order, each a rejection: unreadable arguments; blank name/message; unknown cadence (not one of `daily`, `weekly`, `monthly`, `quarterly`); `startTime` not parseable as `YYYY-MM-DD`, RFC3339, or `YYYY-MM`; a start in the future; a start whose periods to now exceed 1000 (`engine.MaxGridWindows`); an unresolvable thing; no things; a ubiquitous thing; an unresolvable colour; no colours; a ubiquitous colour; and the **cover floor**: the rows of the rhythm (§ 6.2, the rows citing every named thing) held by any of the named colours must be at least 50 % of those rows, else the rejection names up to 3 colours that would cover it (`no colour covers it` when none does). The schedule is built in Go: `period` = `24h`/`168h`/`720h`/`2160h`, `duration = period`, `startTime` = the start floored to midnight UTC; `window_spec_versions` = one version **effective from that start** (so every grid window since is pending once a lens exists, `lifecycle-reflection.md` § 2). Writes a `reflection` row as in § 5 with `current_context_spec = {colourIds}` — the things are evidence only and are not stored. Marks the colours' members covered; the result reports scope size, rows held of rows total, cadence and start.

### 6.2 Rhythm detection (`rhythm.go`)

Computed from annotation rows, never asked of the model. Rows are bucketed by their date at a grain: **month** (calendar month) or **week** (ISO week, Monday start). For every thing with ≥ 5 citing rows (`worklistFloor`) that is on the map, and every **pair** of non-ubiquitous such things cited in the same row: `Total` rows (undated included), `ActiveBuckets` (distinct dated buckets), `SpanBuckets` (first to last inclusive), `First`/`Last` bucket starts, and `Onset` = the start of the first run of ≥ 3 consecutive active buckets, else the first active bucket.

Ordering (`sortRhythms`): active buckets desc, then regularity (`Active/Span`) desc, then `Total` desc, then first thing id. Singles are not filtered by activity; pairs with fewer than 3 active buckets are dropped. Singles keep at most 25, pairs at most 25. The initial turn carries the month-grain block; `rhythms` recomputes at either grain (anything but `week` is month), optionally restricted to given things (singles among them, and pairs including at least one). Each card shows the things, total, `active of span <grain>s`, first/last/onset, a `ubiquitous` flag, the **cover line**, and up to 12 evenly sampled active buckets with their count and the title of the first row seen in that bucket; a rhythm with no dated row shows `undated`.

**Cover line.** For the rhythm's rows, every non-ubiquitous colour holding at least one of them, ranked exact carriers first (a colour built on every thing of the rhythm), then by rows held, then id; the top 3 are listed as `name (id[, built on it]) held of total`, followed by the count of rows no colour holds. No carrier → `no colour covers it: not proposable in this run`.

### 6.3 Ubiquity

A thing is ubiquitous when there are ≥ 20 rows and it is cited in more than 40 % of them. Ubiquitous things are flagged on their card, excluded from pairing, and rejected as a scope by the colours and reflections flows. A ubiquitous colour (§ 3.4) is rejected as a scope by the projections and reflections flows and never appears on a cover line.

## 7. What discover does not do

- It never generates output, drafts a lens, or opens a refinement; a proposal is handed to the client through the `proposed` status and `brief`.
- It never deletes or edits an existing entity, never creates colours outside the colours flow, and never re-runs on its own; each run is one kick.
- It never pins fragments: a proposal's scope is colours (and, for projections, source projections), so it grows with the colours.
- It never reads fragment bodies beyond the 12-read budget, and never sees prompt-colour rules beyond the prompt text in `list_existing`.
