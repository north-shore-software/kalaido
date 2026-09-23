> **STALE** — code has changed since this document was generated.

# Colours — Generated Audit Snapshot

> **Generated:** 2026-09-17, from source at commit `895984c`.
> This file is a generated audit snapshot — do not edit it. See `AGENTS.md` § "Generated audit docs". When code described here changes, a stale marker line is prepended above this block; nothing else in the file is ever modified by hand.

**Scope.** Colours as a whole: the colour row and its three sources of membership (prompt, map things, manual examples), the materialised membership join and its precedence, the preview and create-time seeding, the judging worker and its watermark, thing rematching on map settle and on demand, per-colour provider-error recording, and what a delete scrubs. How colour members enter a context is `context.md` § 2; the discover flow that creates thing-backed colours is `discover.md` § 4; route wire detail is `api.md` § 8; the scheduler priorities the worker and preview run at are `llm-queue-quota.md` § 2.1.

**Completeness anchor.** 5 routes registered in `server/server.go` (`POST /api/colours/preview`, `POST /api/colours`, `PATCH /api/colours/{id}`, `DELETE /api/colours/{id}`, `POST /api/colours/{id}/rematch`); 2 collections (`colour`, `colour_fragment`) plus the `view_stream` view; 4 `match_type` values (`manual_negative`, `manual_positive`, `thing`, `prompt`); 1 worker goroutine (`colour.Register` → `loop`, `internal/colour/worker.go`); 1 settle hook (`mapping.OnSettle(colour.OnMapSettled)`); 1 outgoing hook (`colour.OnDrained`, wired to `reconcile.EnqueueWave`).

---

## 1. Objects

**`colour`** (client-readable; `DisableWriteOperations`, so server-written only): `name` (required), `swatch` (number; palette slot, § 1.1), `prompt`, `thing_ids` (JSON string array of map thing ids; written only by the discover colours flow, never on any colour route), `prompt_match_completed_up_to_fragment_id` (relation → `fragment`, max 1, no cascade; the worker's watermark, § 4), `last_provider_error_kind` (§ 4.2), `created_by_discover_run_id` (relation → `discover_run`; empty = human-created), `created`, `updated`. A colour created on `POST /api/colours` gets `name`, `prompt`, `swatch`; one created by discover gets `name`, `swatch`, `thing_ids`, `created_by_discover_run_id` and no prompt (`discover.md` § 4).

**`colour_fragment`** (client-readable, server-written): one row per `(colour_id, fragment_id)` (unique index `idx_colour_fragment_pair`, plus single-column indexes on each relation), `match_type` (select, one of the four values), `created`. Both relations cascade-delete: deleting a colour or hard-deleting a fragment removes its rows. There is no record of which model decided a `prompt` row.

**Membership** = every row whose `match_type != 'manual_negative'`. Every reader applies that rule — `colour.MemberIDs` (used by discover), `llmcontext.FragmentIDsForColours` (context resolution, `context.md` § 2), and the `view_stream` view's `colour_ids` column. A `manual_negative` row is an exclusion; because it occupies the pair's single row it also stops the worker and the thing writer from ever adding the pair back (§ 2).

None of the readers filters soft-deleted fragments at the join: a row for a fragment with `deleted_at` set is still a member here; context resolution drops it afterwards through its own `deleted_at = ''` clause, and `view_stream` selects only live fragments.

### 1.1 Swatch

`colour.NextSwatch(app)` = `count(colour rows) mod 8` (`SwatchCount`), evaluated immediately before the new row is inserted, by both the create route and the discover flow. Nothing enforces uniqueness and nothing ever rewrites the value; the server never reads `swatch` back.

## 2. Match types and precedence

| `match_type` | Written by | Meaning |
|---|---|---|
| `manual_negative` | `SetManual` (create/PATCH examples) | Excluded, whatever else says |
| `manual_positive` | `SetManual` (create/PATCH examples) | Included |
| `thing` | `applyThingRows` (settle hook, `Rematch`, discover create), `MatchPair` (after a clear) | The fragment's annotation cites one of the colour's `thing_ids` |
| `prompt` | worker (§ 4); `SetPromptMatch` at create (§ 5) | The colour role answered YES to the colour's prompt |

One row per pair; when several reasons apply the higher row in this table wins. The precedence is enforced by the writers, not by a constraint:

- `SetManual` inserts when the pair has no row, is a no-op when the row already has the requested type, and otherwise retypes the existing row in place (its `created` is kept).
- `applyThingRows` deletes only rows of type `thing` that are no longer wanted and inserts `thing` only for wanted fragments that hold **no** row of any type; rows of any other type are never touched.
- `SetPromptMatch` and the worker skip any pair that already holds a row of any type.
- `ClearManual` deletes the row only if it is `manual_positive` or `manual_negative`; on a `thing` or `prompt` row it returns without change and without re-deriving. After a delete (or when the pair had no row at all) it calls `MatchPair`, which re-creates a `thing` row when the fragment's annotation cites one of the colour's things. A prompt match is **not** re-judged by a clear; that pair is judged again only after the watermark is reset (§ 5, `Rematch`).

Consequences: a pair judged `prompt` that later gains a thing citation stays `prompt`; a pair holding `thing` is never sent to the model; `Rematch` deletes the `prompt` rows *before* recomputing things, so a pair that was `prompt` and cites a thing comes back as `thing`.

## 3. Thing-backed membership

`rematch(colours)` (serialised by `rematchMu`, shared with `MatchPair`): for each colour, if `thing_ids` is non-empty (an unparseable field reads as empty) the map index is loaded once per call — `mapping.LoadDocument`, `mapping.LoadRows` (every `fragment_annotation` row, including rows of soft-deleted fragments), `mapping.IndexRows` (`map.md` § 4). Each ref in `thing_ids` is resolved with `mapping.ResolveRef` (exact thing id, else normalised name or alias); an unresolvable ref is skipped silently. The wanted set is every fragment whose annotation row cites any resolved thing. `applyThingRows` then diffs as in § 2. A colour with no `thing_ids` gets its `thing` rows deleted and nothing inserted. The first colour whose diff fails aborts the pass; earlier colours keep their writes.

Triggers:

- **`OnMapSettled`** — registered as `mapping.OnSettle(colour.OnMapSettled)`, before `reconcile.OnMapSettled`, so membership is recomputed before the wave that consumes it. The settle callbacks run after every map cycle and at the end of a full annotate drain (`map.md` § 3.2). The hook reads the map version and `count(fragment_annotation)` and compares them with a process-local pair (initialised to −1/−1, so the first settle after boot always proceeds); the stored pair is updated **before** the rematch runs, and when both are unchanged the hook returns without work. A rematch error is logged; the pair is not rolled back, so the failed pass is not retried until the map or the count changes again.
- **`RematchThingsFor(colourID)`** — from `Rematch` (§ 5) and from the discover colours flow immediately after it saves a colour (`discover.md` § 4).
- **`MatchPair`** — one pair, from `ClearManual` only (§ 2). It reads the fragment's first annotation row (no row, or unparseable `things` → no change), resolves the colour's `thing_ids` and the row's citations (`ref`, else `name`) through the current document, and inserts `thing` on the first citation that matches a wanted thing if the pair holds no row.

## 4. Prompt-backed membership (the worker)

`colour.Register(app)` starts `loop` as one goroutine and signals it once on `OnServe` (after `se.Next()`), so a watermark left by a crash or a provider outage resumes at boot. `Signal()` is a capacity-1 channel send that drops when a wake is already pending. Signal sites: `OnRecordAfterCreateSuccess("fragment")` (every fragment birth, imports included — `ingestion.md` § 7), `POST /api/colours` when the saved prompt is non-empty, `Rematch`, and boot.

`drain`: every colour with `prompt != ''`, oldest first, judged with `llm.ResolveRole(RoleColour)` — resolved once per drain, with no per-colour override; a resolution failure ends the drain with nothing written and no marker. Calls run under `context.Background()` at the role's default priority, Idle (`llm-queue-quota.md` § 2.1). Colours are drained in sequence; `usage.ErrExhausted` from any colour ends the whole drain at once (later colours wait for the next signal), any other colour error is remembered as the drain's error and the next colour is still attempted.

`drainColour`: renders the few-shot blocks once per colour — the fragments of the colour's 20 newest `manual_positive` rows and 20 newest `manual_negative` rows (newest by the link row's `created`), loaded by id with no `deleted_at` filter, so a soft-deleted example still renders. Then pages **live** fragments (`deleted_at = ''`) in `(created, id)` order, 200 at a time, starting strictly after the watermark fragment (`created > wm.created`, or equal `created` and `id > wm.id`); a watermark whose fragment no longer exists starts from the beginning. For each fragment on the page with no `colour_fragment` row of any type for this colour: `prompts.ColourEvalPrompt(prompt, positives, negatives, target)` (`prompts.md` § 2) via `usage.GenerateOnce`; `llmq.ErrPreempted` retries the same judgment until it completes; a YES per `prompts.ParseYesNo` inserts a `prompt` row. After each page the watermark is set to the page's last fragment id and the colour saved, whether or not anything was written. An empty page ends the colour.

Failure posture: any judging error other than preemption stamps the marker (§ 4.2) and ends this colour's drain with the watermark at the last **completed page** — `prompt` rows already inserted from the partial page persist and are skipped next time; the NO-judged pairs of that page are judged again. An insert or save error ends the colour likewise. There is no per-fragment retry count, no error row, and no back-off beyond the scheduler's.

### 4.1 Drained hook

`loop` counts the `prompt` rows each drain wrote; when the count is greater than zero it runs every function registered with `colour.OnDrained`. Server wiring registers `reconcile.EnqueueWave` (`rotation.md` § 3 for what the wave does with the request). A drain that only advanced watermarks, or that failed, fires nothing.

### 4.2 Provider error marker

The worker has no request to fail, so a `*llm.ProviderError` of kind `auth` or `quota` (`llm-queue-quota.md` § 6) is written to the colour's `last_provider_error_kind` — only when the stored value differs — and the drain of that colour stops. Any other error kind, a non-`ProviderError` (including `usage.ErrExhausted` from the local quota), and a model-resolution failure leave the field untouched. The next successful judgment for that colour clears it (a write only when it is non-empty). Ollama never produces `ProviderError`s (`models.md` § 6), so the field is only ever set under Gemini. The preview route never writes it.

## 5. Routes

All five are registered in `RegisterRoutes` (`server/server.go`). `findColour` reads `{id}` from the path: empty → `400 "missing id"`; unknown → `404 "colour not found"`. Every route binds a named struct from `internal/api/colours.go`; a body that fails to bind is `400 "invalid request body"`.

- **`POST /api/colours/preview`** `{prompt, positiveExamples?, negativeExamples?}` (`PreviewColourRequest`; example values are fragment ids, loaded by id with no `deleted_at` filter, unknown ids dropped silently). Loads the 20 newest live fragments (`deleted_at = ''`, `-created`; a query error is `500 "failed to fetch fragments"`), resolves `RoleColour` (`500 "no model configured for colour matching"`), requires an `http.Flusher` (`500 "streaming unsupported"`), then commits `200` with `text/event-stream`, `Cache-Control: no-cache`, `Connection: keep-alive` and flushes before any judgment. One goroutine per fragment calls `usage.GenerateOnce` under the request context with `llmq.WithPriority(Interactive)`; there is no preemption retry. A YES sends `data: <fragment record JSON>\n\n` and flushes, in completion order, not creation order. A per-fragment error drops that fragment (logged unless the request context is already cancelled); a marshal error skips the fragment; a write error ends the handler silently. Zero matches, or zero fragments in the workspace, is an empty stream. Nothing is written to the database; no marker is set.
- **`POST /api/colours`** `{name, prompt, fragmentIds?, positiveExamples?, negativeExamples?}` (`CreateColourRequest`). `name` blank after trim → `400 "name is required"`. `swatch` is taken from `NextSwatch` (§ 1.1; error `500`), then the row is saved with trimmed `name` and `prompt` (`500 "failed to save colour"`). Each `fragmentIds` entry — the preview's matches, judged by the same prompt — goes through `SetPromptMatch` (a `prompt` row unless the pair already has one); a failure (including a relation error for an id that is not a fragment) is logged and that id skipped, with no effect on the response. Examples are applied (§ 5.1; failure → `500 "failed to save examples"`, with the colour and any seeded rows already committed). If the saved prompt is non-empty the worker is signalled. `reconcile.EnqueueWave()` is called unconditionally. `thing_ids` and `swatch` are not on the wire. Response `200 {colourId}`.
- **`PATCH /api/colours/{id}`** `{name?, prompt?, positiveExamples?, negativeExamples?, clearExamples?}` (`UpdateColourRequest`; `name` and `prompt` are pointers). Examples are applied first (§ 5.1; failure → `500` before any rename or prompt change is saved). `name` is applied only when present and non-blank after trim; an absent or blank name is ignored silently. `prompt`, when present, is trimmed and stored even if blank; `promptChanged` is true when the trimmed value differs from the stored one (so clearing a prompt counts as a change). The row is saved (`500 "failed to save colour"`); if `promptChanged`, `Rematch` runs (`500 "failed to restart matching"`) and then `reconcile.EnqueueWave()`. A PATCH that only changes examples enqueues no wave and signals no worker. Response `200 {colourId, name, prompt}` from the saved record.
- **`POST /api/colours/{id}/rematch`** — no body is read. `Rematch` (`500 "failed to restart matching"`), `reconcile.EnqueueWave()`, `202` with no content.
- **`DELETE /api/colours/{id}`** — in one transaction: for each of `projection` and `reflection`, every row whose `current_context_spec` matches `~ <colourId>` (substring match; no `deleted_at` filter, so soft-deleted entities are scrubbed too) has the id removed from `colourIds` and, if the list shrank, the whole spec re-serialised into `current_context_spec` (a row whose spec fails to parse is skipped silently); then the colour is deleted, cascading its `colour_fragment` rows. A failure anywhere rolls the transaction back → `500 "failed to delete colour"`. Not scrubbed: `lens.context_spec`, the frozen `context_spec` of every `projection_snapshot` / `reflection_snapshot`. No wave is enqueued and no worker signalled. Response `204`.

**`Rematch(colourID)`** (`internal/colour/worker.go`): loads the colour (a lookup failure is returned to the caller), deletes every `prompt` row of the colour, sets `prompt_match_completed_up_to_fragment_id` to empty and saves, runs `RematchThingsFor` (§ 3), then `Signal()`s the worker. Manual rows survive; the worker only re-judges the colour if its prompt is non-empty.

### 5.1 Applying examples

`applyExamples(positive, negative, clear)` writes negatives first (`SetManual … manual_negative`), then positives (`manual_positive`, so a fragment named in both lists ends up `manual_positive`), then clears (`ClearManual`, § 2). Each write is sequential and the first error aborts the rest; earlier writes stay. Example ids are not checked against the `fragment` collection by the handler: an id that is not a fragment fails PocketBase's relation validation on save, which the route reports as `500 "failed to save examples"`. On create the clear list is always nil.

## 6. Cross-subsystem effects

- Context resolution (`context.md` § 2) reads membership live at each generation; a snapshot's pinned receipt freezes the member set at that moment, so membership changes surface as staleness (`rotation.md` § 1). Writers that change membership ask for a wave explicitly: create, a prompt-changing PATCH, the rematch route (all via `reconcile.EnqueueWave()`), and a drain that wrote at least one `prompt` row (§ 4.1). Thing rematches from the settle hook rely on `reconcile.OnMapSettled`, registered after the colour hook, rather than enqueueing themselves; a PATCH that only changes examples requests nothing.
- `view_stream` (`schema.md` § 2.17) exposes, per live fragment, `colour_ids` = the JSON array of its member colour ids (every `colour_fragment` row except `manual_negative`); the palette slot is the colour's own `swatch`.
- Discover reads every colour in created order with `MemberIDs` and `ThingIDs` for its run context and `list_existing` (`discover.md` § 3.1, § 3.4); its colours flow creates thing-backed colours and calls `RematchThingsFor` so they have members before the run continues (`discover.md` § 4). Its projection and reflection proposals write `colourIds` into `current_context_spec`, which is what the delete-time scrub (§ 5) cleans.
- The worker's judging calls share the LLM scheduler and usage quota with everything else (`llm-queue-quota.md` § 1, § 5); `boot-and-workers.md` § 2 lists the worker alongside the other signal-driven loops.
