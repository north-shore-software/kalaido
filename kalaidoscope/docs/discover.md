> **STALE** — code has changed since this document was generated.

# Discover — Generated Audit Snapshot

> **Generated:** 2026-09-17, from source at commit `895984c`.
> This file is a generated audit snapshot — do not edit it. See `AGENTS.md` § "Generated audit docs". When code described here changes, a stale marker line is prepended above this block; nothing else in the file is ever modified by hand.

**Scope.** The discover flows: the `discover_run` record and its states, the guards a run must pass, the tool loop shared by every flow, the reads it exposes over the map and the colours, the three flow kinds and their fixed order, what each proposes versus creates as real rows, the coverage measure each uses, the rhythm detection and cover lines that feed the reflections flow, how runs are kicked and retried, and how a proposal is handed on. Prompt and tool text is inventoried in `prompts.md` § 2–3; the worker's place among the others is `boot-and-workers.md` § 2; the map it reads is `map.md` § 4; the colour membership it reads is `colours.md` § 3; the status a client reads to see whether a run is due, pending or interrupted is `organize.md` § 4; the post-import chain that kicks it is `organize.md` § 8.

**Completeness anchor.** 3 flow kinds registered in the `flows` map of `internal/discover/flow.go` (`colours`, `projections`, `reflections`); 1 route (`POST /api/discover`, `server/server.go`); 1 collection (`discover_run`); 10 distinct tool names declared in `internal/prompts/discover.go` — 5 shared (`read_thing`, `read_fragment`, `list_existing`, `coverage`, `finish`) and 5 flow-specific (`create_colour`, `read_colour`, `propose_projection`, `rhythms`, `propose_reflection`), every one of which appears in § 3–6.

---

## 1. The run

`discover_run` (server-written; `DisableWriteOperations`): `kind` (`colours` | `projections` | `reflections`), `status` (`running` → `done` | `error`), `error`, `map_version` (the things-document version the run read), `generated_by_model` (the `RoleMap` model resolved at start, no override), `rounds` (model calls made), `fragment_reads` (fragment-body reads spent), `outputs` (JSON `[{kind, id, name, status?}]` — every row the run created or proposed, `status` present only for proposals), `summary` (the closing note, § 3). The row is created only after the guards in § 2 pass, so a refused run leaves no record. Progress (`rounds`, `fragment_reads`, `outputs`) is saved after every round; a save failure is logged and the loop continues. A process death mid-run therefore leaves a `running` row with partial `outputs`; nothing at boot or later resumes, sweeps or finishes it (the organise status reports such a row as interrupted, `organize.md` § 4).

Every row a run writes carries `created_by_discover_run_id` (relation to `discover_run`). Proposed projections and reflections additionally carry `status = "proposed"` and `description` = the proposal's opening message.

## 2. Kick, worker, guards, and order

**Kick.** `POST /api/discover` binds `{kind}`: a body that fails to bind → `400 invalid request body`; a `kind` that is not one of the three flow keys → `400 unknown discover kind`; else `discover.Signal(kind)` and `202` with no body. The signal is asynchronous: the response says nothing about whether the run will pass its guards. `Signal` itself silently ignores an unknown kind (the handler is the only caller that checks first). The post-import chain also signals all three kinds, in order, from a `mapping.AfterDrain` callback that fires only when the mapping drain ended without error (`organize.md` § 8). No hook, interval or settle callback signals discover.

**Worker.** `discover.Register` (boot, `server/server.go`) starts one goroutine (`boot-and-workers.md` § 2). `Signal` marks the kind in a pending set and sends on a 1-slot wake channel (a second signal while the token is unconsumed is dropped, which loses nothing: the pending set is what the loop reads). Each wake: take the `AfterDrain` follow-ups registered so far (none are registered anywhere in the binary), take **every** pending kind at once in the fixed order **colours → projections → reflections** (so the later flows can scope by colours the first one just created), and run each with `Run`. While a kind runs, `Running()` returns it; `Pending()` lists the kinds still marked pending in kind order (both are read by `organize.md` § 4). A kind signalled during a run is picked up on the next wake. A failed run is logged (`discover: <kind>: <err>`) and the next kind still runs; the last error is what the follow-ups receive.

**`Run(flow)`.** In order: resolve the `RoleMap` model (`models.md`); `mapping.WaitSettled()`, which blocks while a consolidation is integrating (the mutex held by `integrate`, `map.md` § 3) — it does not wait for the settle hooks that run after integration (thing rematch, `colours.md` § 3); build the run **context** — one `Reader` over a snapshot of the things document and every `fragment_annotation` row (§ 3.3) plus every colour's membership indexed against those rows (§ 3.4). Then the guards, each ending the run **before any row exists**: no things on the map → error `discover: the map is empty`; for `projections` and `reflections` only (`scopesByColour`), no colour row at all → `discover: no colours exist yet`. Then the run row is created, `runLoop` executes under `llmq.Background` priority (`llm-queue-quota.md` § 2.1), and `finishRun` writes `done`, or `error` plus `error` = the error text, and saves progress once more.

## 3. The tool loop

`runLoop` first computes the flow's `Existing` list (a database error here fails the run), then opens with the flow's system prompt and one user turn: the flow's initial block (§ 4–6), then `What already exists:` + § 3.1, then `Coverage now:` + § 3.2 in the flow's measure. The advertised tools are the five shared tools followed by the flow's own. Up to **30 rounds** (`maxRounds`, counted as model calls in `rounds`); each round is one `usage.GenerateWithToolCalls` at `RoleMap` with the role's options (`models.md`), wrapped in `retryPreempted`: a preempted call is retried without limit, a `ProviderError` of kind quota or transient is retried up to **6** times (7 attempts), any other error ends the run as `error`. The assistant text plus `[You called: a, b]` (omitted when there were no calls) is appended to the transcript. A round with no tool calls saves progress and ends the run `done` with no `summary`. Otherwise the calls are dispatched in order and their results joined with blank lines as the next user turn:

| Tool | Result |
|---|---|
| `read_thing {ids}` (a bare `id` is also accepted) | One card per ref (§ 3.3), at most 10 per call; more → the first 10 plus a note; an empty list → an empty result |
| `read_fragment {id}` | The fragment rendered as a `FragmentBlock` (type, source, id, content); budget **12 per run** (`fragment_reads`); when spent → `Fragment read budget exhausted (12 per run)…`; an unknown id → `No fragment with id "…".` without spending; the lookup has no live filter, so a soft-deleted fragment is readable |
| `list_existing` | Recomputes § 3.1 from the database (a database error fails the run); the result also becomes the base for later `coverage` calls |
| `read_colour {ids}` | One card per ref (§ 3.4), at most 10 per call; dispatched for every flow, advertised only by projections and reflections |
| `coverage` | § 3.2 over the run's covered set and the latest `list_existing` result |
| `finish {summary}` | Ends the run after this round; `summary` = the round's assistant text, or the tool argument when that text is blank |
| flow tool | The flow's `Dispatch` (§ 4–6); a rejection comes back as `Rejected: <reason>` and the run continues; a returned `Output` is appended to `outputs` |
| any other name | `Rejected: no tool named "…"` (from the flow's `Dispatch`) |

A `Dispatch` that returns a Go error (collection lookup, save, rematch) ends the run as `error` after the rows already written stay. After the 30th call, any tool calls it made are still dispatched and saved, but their results are never sent and the run ends `done` without a `summary`. When `finish` shares a round with other calls, those calls are executed and their results discarded.

### 3.1 `list_existing`

Every `colour` (created order; description `prompt: <prompt>; built on <thing names>` with either half omitted when empty, unresolvable `thing_ids` dropped; fragments = `MemberIDs`, i.e. every `colour_fragment` link except `manual_negative`), then every live `projection` and `reflection` (`deleted_at = ''`, created order, any status; description = the row's `description`; fragments = its `current_context_spec` resolved now with no window, a resolution error counted as zero). A row with `status = proposed` carries the note `proposed by this run` when its `created_by_discover_run_id` is this run, else `proposed by an earlier run, not yet opened`. Each line is `- <kind> "<name>" (<id>) [<note>]: <description> — <n> fragments`; nothing at all → `Nothing exists yet.` Counts are live at call time, so colours and proposals made earlier in the run appear.

### 3.2 `coverage`

Two measures, chosen by flow. Both report `<hit> of <total> annotated fragments (<pct>%)` over the run's rows and up to 10 gaps, sorted by uncovered count descending (ties in no defined order).

- **Colours flow** (`coverage`): covered = the fragment ids of every entity in the latest existing list (colours included) ∪ every id this run marked covered. Gaps are **things** on the map with at least one uncovered citing row (`Least covered things:` `id · name · u of n fragments uncovered`).
- **Projections and reflections flows** (`colourCoverage`): covered = the fragment ids of existing **projections and reflections only** ∪ this run's covered set — a colour is what gets covered, not a cover. Gaps are **colours** with at least one uncovered annotated member (`Colours least covered:`).

The run's covered set grows only through the flow tools (§ 4–6); reads never mark anything covered.

### 3.3 The reader (`read_thing`, `read_fragment`)

`Reader` holds, for the whole run, one things document with its version, every `fragment_annotation` row in created order (`FragmentID`, `Date`, `Title`, `Summary`, `Things`), and the thing → row-index map built by `mapping.IndexRows` (each citation resolved by ref, else by name, deduplicated per row; unresolvable citations dropped). A row's `Date` is the fragment's `occurred_at` as `YYYY-MM-DD`, looked up over live fragments only: an annotation row whose fragment has been soft-deleted stays in the set, undated. A thing ref resolves by id, else by normalised name or alias (`mapping.ResolveRef`).

A thing card: `id · name · kind [· aka aliases]`, the blurb, `<n> fragments[, first_seen to last_seen]` (n = citing rows; the span from the document), `Relationships:` in both directions as `From (id) kind To (id)`, then either `No annotated fragments cite it.` or a `Timeline:` month histogram (`YYYY-MM: count`, `undated` for rows without a date) and `Fragments (k of n, spread over time):` — up to 30 rows sampled evenly across the citing set as `date · title · summary (fragmentId)`. An unknown ref → `No thing matches "…".`

The same type serves the summaries chat through `NewChatReader` — budget **12 per turn**, chat wording on exhaustion — and `ChatReadTools`, where both tools take an `ids` array and `read_fragment` reads each id until the budget ends the list (`chat.md` § 5).

### 3.4 Colours in the run context

At run start every colour is loaded in created order with: its `thing_ids` resolved through the document (unresolvable refs dropped, names kept for display), `Members` = `MemberIDs`, `RowIdx` = the members that have an annotation row (sorted row indexes), and the first/last dated row among them. `ByColour` maps colour id → `RowIdx`. A colour ref resolves by id, else by case-insensitive exact name; blank refs are skipped. A **ubiquitous colour** is one whose annotated members exceed 40 % of all rows when there are at least 20 rows (§ 6.3).

The colours block on the initial turn is `Colours (id · name · built on · fragments · span):` with one line per colour, `<id> · <name>[ · built on a, b] · <members> fragments[ · first to last]`. A colour card (`read_colour`) is that line, then `None of its fragments is annotated yet.` when `RowIdx` is empty, else a month `Timeline:` of the annotated members and `Fragments (k of n, spread over time):` — up to 30 sampled annotated rows. An unknown ref → `no colour with id "…"`. This index is built once per run: a colour created by the same run is visible to `list_existing` (database) but not to `read_colour`, the colours block, ubiquity, cover lines or `colourCoverage`.

## 4. The colours flow (creates)

Tool `create_colour {name, thingIds}` (both required). Initial turn: the narrative (or `(no narrative yet)`), `Things, heaviest first (id · name · kind · fragments · span · what it is):` listing every thing whose document `fragments` count is ≥ 5 (`worklistFloor`) heaviest first (else `(nothing on the map reaches the floor yet)`), `Relationships:`, guidance.

Rejections, in order: unreadable arguments (`the arguments could not be read`); blank name (`name is required`); empty `thingIds` (`give at least one thing id`); then per ref, an unresolvable one (`No thing matches "…".`) or a **ubiquitous** thing (§ 6.3). Refs are canonicalised to ids and deduplicated. Then a `colour` row is saved with `name`, `swatch` = (current colour count mod 8, `colour.NextSwatch`), `thing_ids` (JSON array of ids), `created_by_discover_run_id` — **no prompt** — followed by `colour.RematchThingsFor` so `colour_fragment` rows exist immediately (`colours.md` § 3); its `MemberIDs` are marked covered; `outputs` gets `{kind: colour, id, name}`; the result is `Created colour "<name>" (id: …, <n> members).` Colours are real rows the moment they are saved; nothing is proposed and no later step revisits them.

## 5. The projections flow (proposes)

Tools `read_colour {ids}` and `propose_projection {name, message, colourIds?, sourceProjectionIds?}` (only `name` and `message` are declared required). Initial turn: the narrative, the colours block (§ 3.4), `Relationships:`, guidance — no things list.

Rejections, in order: unreadable arguments; blank name or message (`name and message are both required`); a colour ref that resolves to nothing (`no colour with id "…"`); a ubiquitous colour; a `sourceProjectionIds` entry (trimmed, deduplicated) that is not a live `projection` row — missing or soft-deleted alike → `no projection with id "…"` (rows proposed earlier in this run qualify); neither colours nor sources (`give at least one of colourIds or sourceProjectionIds`). Then `insertProposed` saves a `projection` with `name`, `status = proposed`, `description = message`, `current_context_spec = {colourIds, sourceProjectionIds}` (each omitted when empty), `created_by_discover_run_id`; no fragments are pinned, no lens, no snapshot, no refinement. The union of the colours' current members is marked covered; `outputs` gets `{kind: projection, status: proposed}`; the result `Proposed projection "<name>" (id: …, <n> fragments in scope).` counts only the colours' members (sources contribute nothing to `n`).

## 6. The reflections flow (proposes)

Tools `read_colour {ids}`, `rhythms {grain, thingIds?}` (`grain` required, enum `week`|`month`) and `propose_reflection {name, message, thingIds, colourIds, cadence, startTime}` (all six declared required; `cadence` enum `daily`|`weekly`|`monthly`|`quarterly`). Initial turn: the narrative, the colours block, the month-grain rhythms block (§ 6.2), guidance.

`rhythms`: unreadable arguments → rejection; with `thingIds`, every ref must resolve (first failure → `No thing matches "…".`) and the block is restricted to those things; `grain` is lower-cased and anything other than `week` is treated as `month`.

### 6.1 Proposal

Checks, in order, each a rejection: unreadable arguments; blank name/message; `cadence` (case-insensitive) not one of `daily`, `weekly`, `monthly`, `quarterly`; `startTime` not parseable as `YYYY-MM-DD`, RFC3339 or `YYYY-MM` (the parsed instant is floored to midnight UTC of that day; `YYYY-MM` gives the 1st); a start after now; a start whose whole periods to now exceed 1000 (`engine.MaxGridWindows`); an unresolvable thing; no things (`give the rhythm's things as thingIds`); a ubiquitous thing; an unresolvable colour; no colours (`give at least one colourId`); a ubiquitous colour; and the **cover floor**: over the rhythm's rows (§ 6.2 — the rows citing every named thing), the rows held by any of the named colours must be at least 50 % of them, else `those colours hold <h> of the <t> fragments about <things>; a scope must hold most of the rhythm` followed by up to 3 covering colours (`Colours that do: …`) or `No colour covers it, so it cannot be proposed in this run; name it at finish`. A rhythm with no rows passes the floor (0 ≥ 0).

The schedule is built in Go, never taken from the model: `period` = `24h` / `168h` / `720h` / `2160h` for the four cadences, `duration = period`, `startTime` = the floored start as RFC3339; `window_spec_versions` = `[{versionNumber: 1, effectiveFrom: <start>, spec}]`, i.e. one version **effective from the start** so every grid window since then is pending once a lens exists (`windows.md` § 2–3, `lifecycle-reflection.md` § 2). The `reflection` row is saved as in § 5 with `current_context_spec = {colourIds}` — the things are evidence only and are not stored. The colours' members are marked covered; `outputs` gets `{kind: reflection, status: proposed}`; the result is `Proposed reflection "<name>" (id: …, <n> fragments in scope, holding <h> of <t> about <things>, <cadence> from <YYYY-MM-DD>).`

### 6.2 Rhythm detection (`rhythm.go`)

Computed from the run's annotation rows, never asked of the model. A dated row falls in a bucket at a grain: **month** (calendar month; ordinal `year*12 + month − 1`, start = the 1st) or **week** (Monday of its week; ordinal = weeks since the epoch's Monday). Undated rows count toward `Total` but no bucket.

**Singles.** Every thing on the map with ≥ 5 citing rows (`worklistFloor`; restricted to the given things when `thingIds` was passed) gets: `Total` rows, `ActiveBuckets` (distinct buckets), `SpanBuckets` (first to last ordinal inclusive), `First`/`Last` bucket starts, `Onset` = the start of the first run of ≥ 3 consecutive buckets, else the first bucket, and a `Ubiquitous` flag (§ 6.3). Singles are not filtered by activity; after sorting, at most 25 are kept.

**Pairs.** Eligible things are the non-ubiquitous singles above the floor; for every row citing two or more of them, each pair (sorted ids) accumulates that row — with `thingIds`, only pairs containing at least one given thing. Pairs with fewer than 3 active buckets are dropped; after sorting, at most 25 are kept.

**Ordering** (`sortRhythms`, stable): active buckets desc, then regularity (`Active / Span`, 0 when the span is 0) desc, then `Total` desc, then first thing id asc.

**Cards.** `Name (id)[ with Name (id)] · <total> fragments`, then either ` · undated` (no dated row: the card ends here, with no cover line or buckets) or ` · <active> of <span> <grain>s active, <first> to <last> · onset <onset>[ · ubiquitous: not a rhythm, do not propose on it]`, the **cover line**, and up to 12 evenly sampled active buckets as `<start>: <count> · <title of the first row seen in that bucket>`. The block heads the two lists `Rhythms at the <grain> grain (things, most sustained first):` / `(pairs of things cited together, most sustained first):`, with `(no thing reaches the floor yet)` / `(no pair is cited together in three or more buckets)` when empty.

**Cover line.** Over the rhythm's rows (a single's citing rows; for a pair, the rows citing both), every non-ubiquitous colour holding at least one of them, ranked exact carriers first (a colour whose resolved `thing_ids` include every thing of the rhythm), then by rows held desc, then id asc; the top 3 render as `covered by: <name> (<id>[, built on it]) <held> of <total> · …`, followed by `<k> in no colour` when some rows are held by none. No carrier → `no colour covers it: not proposable in this run`.

### 6.3 Ubiquity

The one rule, `ubiquitousRows(n)`: false when there are fewer than 20 rows, else true when `n` exceeds 40 % of all rows. For a thing, `n` = its citing rows; for a colour, `n` = its annotated members. A ubiquitous thing is flagged on its rhythm card, excluded from pairing, and rejected as a scope by the colours flow (`… is cited across most of the workspace; it is the cast, not a rhythm, and cannot be a reflection's scope`) and by the reflections proposal. A ubiquitous colour is rejected as a scope by the projections and reflections flows (`colour … holds most of the workspace; that is the cast, not a rhythm, and it cannot be a scope on its own`) and never appears on a cover line or in a cover-floor suggestion.

## 7. What discover does not do

- It never generates output, drafts a lens, or opens a refinement; a proposal is an ordinary live `projection` / `reflection` row that the client recognises by `status = proposed` and `description`. No backend route reads or acts on proposals as such: the row leaves `proposed` only when a refinement commit on it sets `status = active` (`refinement.md` § 5, `lifecycle-projection.md` § 3, `lifecycle-reflection.md` § 4), or it is soft-deleted like any other row (`lifecycle-projection.md` § 6, `lifecycle-reflection.md` § 8). Until then it is invisible to staleness, which evaluates `status = 'active'` rows only (`rotation.md` § 1), and is counted by the organise status (`organize.md` § 4).
- It never deletes or edits an existing entity, never creates colours outside the colours flow, and never re-runs on its own; each run is one kick, and the only automatic kick is the post-import chain (`organize.md` § 8).
- It never pins fragments or things: a proposal's scope is colours (and, for projections, source projections), so it grows with the colours.
- It never reads fragment bodies beyond the 12-read budget, never sees a prompt-colour's rule beyond the prompt text in `list_existing`, and never refreshes its colour index or map snapshot during a run.
- It never records a refused run (§ 2 guards, model resolution or snapshot-load failures) and never cleans up a run interrupted by process death.
