# Colours — Generated Audit Snapshot

> **Generated:** 2026-09-02, from source at commit `3998ebd`.
> This file is a generated audit snapshot — do not edit it. See `AGENTS.md` § "Generated audit docs". When code described here changes, a stale marker line is prepended above this block; nothing else in the file is ever modified by hand.

**Scope.** Colours as a whole: the colour row and its three sources of membership (prompt, map things, manual examples), the materialised membership join and its precedence, the preview and create-time seeding, the judging worker and its watermark, thing rematching on map settle and on demand, per-colour provider-error recording, and what a delete scrubs. How colour members enter a context is `context.md` § 2; the discover flow that creates thing-backed colours is `discover.md` § 4; route wire detail is `api.md` § 8.

**Completeness anchor.** 5 routes (`POST /api/colours/preview`, `POST /api/colours`, `PATCH /api/colours/{id}`, `DELETE /api/colours/{id}`, `POST /api/colours/{id}/rematch`); 2 collections (`colour`, `colour_fragment`) plus the `view_stream` view; 4 `match_type` values; 1 worker goroutine (`internal/colour/worker.go`); 1 settle hook (`colour.OnMapSettled`).

---

## 1. Objects

**`colour`** (client-readable, server-written): `name` (required), `colour_value` (stored, never read by the server), `prompt`, `thing_ids` (JSON string array; written only by discover), `prompt_matched_through` (watermark, § 4), `last_provider_error_kind` (§ 4.2), `origin_run_id` (the discover run that created it; empty = human-created).

**`colour_fragment`** (client-readable, server-written): one row per `(colour_id, fragment_id)` (unique index), `match_type`, `model` (the model that decided a `prompt` row; empty otherwise). Both relations cascade-delete.

**Membership** = every row whose `match_type != 'manual_negative'`. All readers (`colour.MemberIDs`, `llmcontext.FragmentIDsForColours`, `view_stream`) apply that rule; a `manual_negative` row is an exclusion that also blocks the worker from ever judging that pair.

## 2. Match types and precedence

| `match_type` | Written by | Meaning |
|---|---|---|
| `manual_negative` | user examples (create/PATCH) | Excluded, whatever else says |
| `manual_positive` | user examples | Included |
| `thing` | rematch (settle hook, handlers, discover) | The fragment's annotation cites one of the colour's `thing_ids` |
| `prompt` | worker; create-time seeding | The colour role answered YES to the colour's prompt |

One row per pair; when several reasons apply the higher row in this table wins, enforced by the writers: `SetManual` overwrites any existing row's type (and clears `model`); `applyThingRows` only deletes/inserts rows of type `thing` and never touches other types; `SetPromptMatch` and the worker skip pairs that already hold any row. A pair judged `prompt` that later gains a thing citation therefore **stays** `prompt` (the thing writer sees a row and leaves it). `ClearManual` deletes a manual row and re-derives the pair mechanically via `MatchPair` — a `thing` row comes back if the citation exists; a prompt match is **not** re-judged until the next rematch.

## 3. Thing-backed membership

`rematch(colours)` (serialised by a mutex): for each colour with `thing_ids`, resolve each ref through `mapping.ResolveRef` (id, name, or alias; unresolvable refs are skipped silently), collect every annotation row citing those things, and `applyThingRows`: delete `thing` rows whose fragment is no longer wanted, insert `thing` rows for wanted fragments that hold no row. Colours without `thing_ids` get their stale `thing` rows removed.

Triggers: `OnMapSettled` after every map cycle — skipped when the map version and annotation-row count are both unchanged since the last hook run (process-local watermark, so the first cycle after boot always rematches); `RematchThingsFor` from `Rematch` (§ 5) and from the discover colours flow on creation.

Soft-deleted fragments are not filtered here: their annotation rows still cite things, so their `thing` rows persist (and are excluded downstream by context resolution).

## 4. Prompt-backed membership (the worker)

`drain` runs on every signal (fragment birth, colour create with a prompt, `Rematch`, boot): every colour with a non-empty `prompt`, oldest first, judged with the model `ResolveRole(RoleColour)` (no per-colour override) at Idle priority.

`drainColour`: renders the few-shot blocks once — the 20 newest `manual_positive` and 20 newest `manual_negative` rows' fragments — then pages **live** fragments (`deleted_at = ''`) in `(created, id)` order, 200 at a time, from just after the watermark fragment (a watermark whose fragment no longer exists restarts from the beginning). For each fragment with no existing row for this colour: `ColourEvalPrompt(prompt, positives, negatives, target)`; a YES (`ParseYesNo`) inserts a `prompt` row with the model name. After each page the watermark advances to the page's last fragment id and the colour is saved. A prompt edit or `Rematch` resets the watermark to empty (§ 5).

Failure posture: `ErrPreempted` retries the same judgment; any other call error aborts this colour's drain (the watermark keeps the last completed page); `usage.ErrExhausted` aborts the whole drain; other errors continue to the next colour.

### 4.2 Provider error marker

The worker has no request to fail, so a `ProviderError` of kind `auth` or `quota` is stamped on the colour as `last_provider_error_kind` (only when it changes); any other kind leaves the field alone. The next successful judgment clears it. Ollama never produces classified errors (`models.md` § 6), so this field is only ever set by Gemini.

## 5. Routes

- **`POST /api/colours/preview`** `{prompt, positiveExamples[], negativeExamples[]}` (fragment ids): judges the 20 **newest** live fragments concurrently at **Interactive** priority against the draft prompt and streams each YES as an SSE `data: <fragment record JSON>` event; the 200 and headers are sent before any judgment so zero matches is an empty stream. Per-fragment failures are dropped (logged unless the client disconnected). The model is resolved before the stream opens (500 if none). Nothing is written.
- **`POST /api/colours`** `{name, prompt, fragmentIds[], positiveExamples[], negativeExamples[]}`: `name` required (400). Saves the colour (name and prompt trimmed); each `fragmentIds` entry — the preview's matches — is recorded as a `prompt` row (skipping pairs that already hold one) with the current colour model; examples applied (§ 5.1); if the prompt is non-empty the worker is signalled. `thing_ids` are not on the wire. Response `200 {colourId}`.
- **`PATCH /api/colours/{id}`** `{name?, prompt?, positiveExamples[], negativeExamples[], clearExamples[]}`: examples applied first; a blank `name` is ignored; a `prompt` value is trimmed and, if it differs from the stored one, triggers `Rematch`. Response `200 {colourId, name, prompt}`.
- **`POST /api/colours/{id}/rematch`**: `Rematch` → 202.
- **`DELETE /api/colours/{id}`**: in one transaction, scrubs the colour id from every `projection` and `reflection` whose `current_context_spec` contains it (the id is removed from `colourIds`; the entity's lens `context_spec` and every snapshot's frozen spec are **not** touched), then deletes the colour (rows cascade). 204.

`Rematch(colourID)`: deletes every `prompt` row of the colour, clears the watermark, recomputes `thing` rows, signals the worker. Manual rows survive.

### 5.1 Applying examples

Negatives are written first, then positives (a fragment named in both ends up `manual_positive`), then clears. Each write is `SetManual` (insert or retype) or `ClearManual` (delete + `MatchPair`). Example ids are not validated against the `fragment` collection; a bad id fails the save with a relation error → 500.

## 6. Cross-subsystem effects

- Context resolution (`context.md` § 2) reads membership live; a snapshot's `resolved_context` freezes the members at generation time, so membership changes surface as staleness (`rotation.md`).
- `view_stream` (`schema.md`) exposes each live fragment's colours as the 0–7 index of each member colour ordered by creation (index = row number mod 8).
- Discover's `list_existing` describes a colour by its prompt and the names of its things, with its current member count (`discover.md` § 3).
