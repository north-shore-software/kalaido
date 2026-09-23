> **STALE** — code has changed since this document was generated.

# Reflection Window Calculation — Generated Audit Snapshot

> **Generated:** 2026-09-17, from source at commit `895984c`.
> This file is a generated audit snapshot — do not edit it. See `AGENTS.md` § "Generated audit docs". When code described here changes, a stale marker line is prepended above this block; nothing else in the file is ever modified by hand.

**Scope.** How a reflection's schedule windows are defined, versioned, enumerated on a grid, identified in memory and on rows, assembled into the series (grid + backfilled + already-generated), which of them are pending or stale, and which window a refinement or a generate call defaults to. Only reflections have windows. The code is `internal/engine/windowspec.go`, `windows.go`, the window half of `reflections.go`, and `MaterializeBackfill` in `backfill.go`; the wire types are `internal/api/context.go` (`WindowSpec`, `WindowSpecVersion`), `status.go` (`Window`) and `windows.go` (`WindowInfo`, `ReflectionWindowsResponse`, `BackfillRequest`, `BackfillResponse`). Consumers, each described in its own doc: schedule creation and editing (`lifecycle-reflection.md` § 2, § 3), window selection for a generate call and the per-window claim/approval chains (`lifecycle-reflection.md` § 5.1, § 5.2, § 6), the windows and backfill routes and the background pending-window pass (`lifecycle-reflection.md` § 9, `api.md` § 6), the freshness verdict (`rotation.md` § 2.1) and the wave (`rotation.md` § 3), refinement seeding and the window re-apply leg (`refinement.md` § 2, § 4), context resolution's window clause and the receipt diff (`context.md` § 2.1, § 5), and discover's reflection proposals (`discover.md` § 6.1). Column definitions and indexes are in `schema.md` § 2.6, § 2.9, § 2.18.

**Completeness anchor.** `api.WindowSpec` has exactly 5 fields (`mode`, `startTime`, `endTime`, `period`, `duration`); the window calculation is exactly 19 functions plus one constant — the 13 functions and `MaxGridWindows` of `internal/engine/windows.go`, the 3 of `windowspec.go`, `SeriesWindows` and `PendingWindows` in `reflections.go`, and `MaterializeBackfill` in `backfill.go` — and every one of them is named in this document.

---

## 1. The window spec

`api.WindowSpec` has five string fields, wire names `mode` (omitempty), `startTime`, `endTime` (omitempty), `period`, `duration`. The engine reads **three**: `period` — a Go duration string (`"24h"`, `"168h"`); empty, unparseable, or non-positive means *no schedule*; `duration` — a Go duration; empty, unparseable or non-positive means **tumbling** (`duration = period`, via `parseDurationOr`); `startTime` — RFC3339, the grid origin (§ 3); unparseable is treated as absent (`parseRFC3339` returns the zero time). `mode` and `endTime` are read by no Go code: they are stored inside the version entry, round-tripped, and never evaluated.

Validation lives in the handlers (`validateWindowSpec`, run by both the create and the update handler; `lifecycle-reflection.md` § 2, § 3). A spec whose `period`, `duration` and `startTime` are all empty is valid (unscheduled) — `mode` and `endTime` do not count toward that test, so a spec carrying only `mode` fails the period check. Otherwise `period` must parse as a positive duration, `duration` if non-empty must parse as a positive duration, and `startTime` if non-empty must parse as RFC3339; each failure is a `400` with the message `windowSpec.period must be a positive duration such as "168h"`, `windowSpec.duration must be a positive duration such as "168h"`, or `windowSpec.startTime must be RFC3339`. A `windowSpec` sent for a projection is `400 windowSpec is only valid for reflections` on both routes.

Discover builds specs itself (`buildReflectionSpec`, `discover.md` § 6.1) from a cadence word and a start date: `daily`→`24h`, `weekly`→`168h`, `monthly`→`720h`, `quarterly`→`2160h`; the start is parsed as `2006-01-02`, RFC3339 or `2006-01` and floored to midnight UTC; a start after now, and a start whose elapsed span holds more than `MaxGridWindows` (1000) periods, are refused. The resulting spec is `{startTime, period, duration = period}`; `mode` and `endTime` are never set.

## 2. Versioning

`window_spec_versions` on the reflection row is a JSON array of `api.WindowSpecVersion` — `{versionNumber, effectiveFrom, spec}`. `LoadWindowSpecVersions` unmarshals it and ignores any error, so an unparseable value reads as no versions (unscheduled). `AppendWindowSpecVersion(versions, spec, effectiveFrom)` returns the array with one entry added: `versionNumber` = highest existing number + 1 (1 when none), `effectiveFrom` = the given instant rendered UTC RFC3339. Nothing ever overwrites or removes an entry. Three sites append:

- **Create** (`handleCreate`) always writes version 1, with or without a `windowSpec` in the body (an absent spec is stored as an all-empty spec). `effectiveFrom` = now, except when `startTime` parses as RFC3339 *and* lies before now, in which case `effectiveFrom` = `startTime`.
- **Discover** proposals write version 1 with `effectiveFrom` = the floored start date.
- **Update** (`handleUpdate`, `windowSpec` present) appends `versionNumber` max+1 with `effectiveFrom` = now. When the new spec's `startTime` is empty and a governing version exists at now, the governing version's `startTime` is copied into the new spec before it is appended; an all-empty spec sent to unschedule therefore still carries the inherited `startTime` (and no `period`, so it is unscheduled). The update triggers no generation and no window enumeration itself.

**Governing version.** `GoverningVersion(versions, at)` returns the entry with the latest `effectiveFrom` that is not after `at`; entries whose `effectiveFrom` fails RFC3339 parsing are skipped; among equal `effectiveFrom` values the earliest in array order wins (the comparison is strictly-after). Every caller passes now: `CurrentGridWindows`, `DefaultRefinementWindow`, `MaterializeBackfill`, and the update handler's `startTime` inheritance. No governing version (none, or all in the future) means unscheduled; so does a governing version whose `spec.period` is the empty string — all three engine callers check `Period == ""` before enumerating anything.

**Lower bound.** `versionLowerBound(v)` is the later of `effectiveFrom` and `spec.startTime` (each parsed with `parseRFC3339`; unparseable is the zero time, which is never "later"): the instant from which that version produces windows.

## 3. Tiling: the grid and pending windows

`GridWindows(reflectionID, spec, lowerBound, now)`:

- `period` must parse positive, else nil. `duration` = `parseDurationOr(spec.duration, period)`.
- `origin` = `startTime`; when zero, `lowerBound`; when that is also zero, nil.
- Grid point *k* (k ≥ 1) falls at `origin + k·period`. The first *k* is 1, or, when `lowerBound` is after `origin`, `⌊(lowerBound − origin)/period⌋ + 1` — the smallest grid point strictly after `lowerBound`.
- Window *k* ends at grid point *k* and starts `duration` earlier, raised to `origin` when it would fall before it (first-window truncation). Enumeration stops at the first grid point after `now`, so only windows ending **after** `lowerBound` and **at or before** `now` are produced, oldest first.
- Whenever the list exceeds `MaxGridWindows` (1000) the oldest entry is dropped, so at most the 1000 newest windows are returned.

The three shapes follow from `duration` vs `period`: equal — tumbling, contiguous, one per elapsed period; longer — overlapping look-backs, truncated at the origin while it is inside them; shorter — gapped, the `duration` before each grid point with the remainder uncovered.

`CurrentGridWindows(rec, now)` = the grid of the version governing now, from that version's lower bound; nil when unscheduled. Because a later version is effective from the moment of its edit, a cadence change never re-enumerates history: an earlier version's windows stay in the series only through their approved snapshots (§ 6).

**Pending windows.** `PendingWindows(app, rec, now)` = the series (§ 6) filtered to windows with neither an approved snapshot nor a generation in flight, oldest first. It feeds the background pending-window pass (`lifecycle-reflection.md` § 9) and the windowless branch of the status evaluator (§ 6, `rotation.md` § 2.1).

## 4. Window identity

A window on the wire is `api.Window{id, start, end}`. `newWindow(reflectionID, start, end)` renders both bounds UTC RFC3339 and sets `id` = `WindowID`.

- `WindowID(reflectionID, w)` = hex MD5 of `reflectionID + start + end` as strings. It is stable across evaluations and distinct per reflection for the same bounds. It is the `id` the API hands out (`windows[].id`, `currentWindowId`, `pendingWindows[].id`, `staleWindows[].id`) and accepts (`windowId` on generate, matched against the series' ids — `lifecycle-reflection.md` § 5.1). Besides `newWindow`, it is computed in `SeriesWindows` for a window arriving with an empty `id`, and in the refinement-open handler for a client-supplied `window`, where it is hashed over the client's strings as sent, without normalisation (`refinement.md` § 2).
- `WindowKey(w)` = `"{start}_{end}"`. It is the in-memory join key of `SeriesWindows` and is served as `key` on the windows route; it is stored nowhere.
- **On rows**, a window is its bounds: `window_start` / `window_end` DateFields on `reflection_snapshot` (both empty for a windowless snapshot) and on `reflection_window` (both required). `setSnapshotWindow(rec, w)` writes them through `WindowBounds` (which parses each string with `types.ParseDateTime`, yielding zero values on a nil window or a parse failure); a nil window leaves the row windowless. `SnapshotWindow(rec)` reads them back through `newWindow`, so a window read from a row always carries canonical bounds and the canonical `id`; nil when either bound is zero. `setSnapshotWindow` is called by the generation claim (`claimGeneration`), the snapshot writer (`applySnapshotSpec`, reflections only) and backfill materialisation (§ 6.1); `SnapshotWindow` by `SeriesWindows`, approval sequencing (`nextApprovalSequence`) and the post-approval discard.
- **Per-window scoping of snapshot queries** (`statusSnapshotFilter`, used for approval chains, claims, discards and the staleness lookup): a nil window adds `window_start = ''` (PocketBase's literal empty matches empty-or-null), a window adds `window_start = {:ws} && window_end = {:we}` with the `WindowBounds` values. The uniqueness of an approval chain is `idx_reflection_snapshot_approval_seq` on `(reflection_id, window_start, window_end, approval_sequence_number)` where `status = 'approved'`; backfill rows are unique on `(reflection_id, window_start, window_end)`.

Because row scoping goes through `WindowBounds` while `id`/`key` are string-derived, a client-formatted window with the same instant matches the same rows but is a different `id` and `key` in memory from the grid's rendering of it.

## 5. Consequences of the lower-bound rule

- A version whose `startTime` is later than its `effectiveFrom` produces nothing before `startTime`; one whose `startTime` is earlier produces windows only from `effectiveFrom` onward — except version 1 created with a past `startTime`, whose `effectiveFrom` *is* that start, so every grid window from then to now is pending ("summarize from <date>"). Discover's version 1 has the same shape (`effectiveFrom` = start).
- An edit that leaves `startTime` empty inherits the governing origin, so the new version's windows stay phase-aligned with those already generated; only a version that moves the origin can produce a first window truncated at the new origin.
- A version 2+ with an inherited past `startTime` starts at its `effectiveFrom`; a window that straddles that edit instant is produced (its end is after the lower bound) with its full `duration`, reaching back before the edit.
- A reflection with a valid spec whose first grid point after the lower bound has not yet passed has no grid windows: `PendingWindows` is empty, staleness reports nothing owed, and the default window falls back to the trailing window (§ 7). The reconcile wave additionally treats "scheduled but no grid windows" as not-yet-scheduled for its windowless fallback (`rotation.md` § 3).

## 6. The series

`SeriesWindows(app, rec, now)` returns `[]WindowState` — `api.Window` plus `Key`, `HasApproved`, `Generating`, `Backfilled`, `LensID` — merged by `WindowKey` from three sources, in this order; the first occurrence of a key fixes the window (bounds and `id`, filled by `WindowID` when empty), later occurrences only update flags:

1. `CurrentGridWindows` (§ 3), `Backfilled = false`.
2. Every `reflection_window` row for the reflection, ordered by `window_start`, `Backfilled = true` (OR'd onto a window the grid already produced).
3. Every `reflection_snapshot` row for the reflection with `window_start != ''` and `status` `approved` or `generating`. An approved row sets `HasApproved` and, when its `approval_sequence_number` is ≥ the highest seen for that window, sets `LensID` to its `lens_id`. A generating row sets `Generating` — claim rows carry their bounds from insertion, and no age check is applied here (a claim past `GenerationClaimTTL` still counts). `pending_review` and `discarded` rows contribute nothing, and a snapshot from an older schedule version keeps its window in the series through its approved row.

Both lookups discard their errors: a failed query yields a series without that source. Output is sorted stably by `start` then `end` (string order of the UTC RFC3339 bounds).

The windows route (`lifecycle-reflection.md` § 9) serves each state as `WindowInfo{id, start, end, key, hasApproved, generating, backfilled, stale, lensOutdated}`: `lensOutdated` = `HasApproved && LensID != reflection.current_lens_id`, computed in the handler; `stale` = the window's `id` appears in `staleWindows` of a fresh full status evaluation for this reflection — when that evaluation errors, no window is marked stale.

**Per-window staleness.** The status evaluator (`rotation.md` § 2.1) reads the same series. It only reaches the windowed evaluation for a reflection that has at least one approved snapshot of any kind, and only uses it when some series window `HasApproved`; then every window with neither `HasApproved` nor `Generating` is a pending window, and for each approved window the latest approved snapshot in that window's chain has its `resolved_context` diffed against the reflection's `current_context_spec` resolved inside that window (`context.md` § 2.1, § 5) — only new fragment ids count, upstream snapshot ids are not compared for windowed reflections; a window with any new fragment is a stale window. A reflection whose approved snapshots are all windowless is evaluated the windowless way with `PendingWindows` appended. The wave generates exactly `pendingWindows` then `staleWindows` (`rotation.md` § 3); a generate call with no `windowId` takes pending, lens-outdated and stale windows as candidates (`lifecycle-reflection.md` § 5.1).

### 6.1 Backfill materialisation

`MaterializeBackfill(app, rec, from, now)`, called only by `POST /api/reflections/{id}/backfill` (`lifecycle-reflection.md` § 9):

- Requires a governing version at now with a non-empty `period` (else `reflection <id> is not scheduled`) that parses positive (else `reflection <id> has no period`); the handler turns both into `500 backfill failed`.
- `covered` = the version's lower bound; `from` must be strictly before it, else `ErrBackfillOutOfRange` (`backfill start must be before the windows already on the grid`, a `400`).
- The grid origin (`startTime`, else `covered`) is shifted back by `⌊(origin − from)/period⌋ + 1` whole periods — to an instant strictly before `from` and within one period of it — and `GridWindows` is enumerated with the shifted spec from `lowerBound = from` to `now = covered`. Backfilled windows are therefore phase-aligned with the grid, end strictly after `from` and at or before `covered`; the first one may begin before `from` (it is truncated only at the shifted origin), and a window ending exactly at `covered` belongs to the backfill, not the grid.
- No windows (a span shorter than one period) returns `nil, nil` — a `200` with no rows written.
- Each window is written as a `reflection_window` row: `reflection_id`, `window_start`, `window_end` (via `setSnapshotWindow`); no version number or key is stored. When a save fails, the row is looked up by `(reflection_id, window_start, window_end)`: found means already materialised and the window is kept in the result; not found returns the save error (`500`). Re-running the same range is thus a no-op that still returns the windows.
- Materialisation is permanent and independent of generation: rows are removed only by the `reflection_id` cascade on hard delete; soft delete leaves them. The returned windows are what the route reports; generation of them is the pending pass the handler kicks afterwards.

## 7. Default refinement window

`DefaultRefinementWindow(rec, now)`: nil when unscheduled (no governing version at now, or `period` empty). Otherwise the **last** window of the governing version's grid from its lower bound — the most recently completed grid point. When that grid is empty (the first grid point after the lower bound has not passed): a trailing window ending at `now` in UTC truncated to the minute and starting one `duration` earlier (`duration` = `parseDurationOr(spec.duration, parseDurationOr(spec.period, 0))`), raised to `startTime` when that is later; nil when the resulting start is not before the end, or when neither `duration` nor `period` parses positive. Its bounds and `id` come from `newWindow`.

It is used in three places: the refinement-open handler when the request names no `window` (`refinement.md` § 2), the windows route's `currentWindowId` (empty when nil), and the generate handler's fallback when no window is pending, stale or lens-outdated (`lifecycle-reflection.md` § 5.1), where a nil result means a windowless generation.

`ParseWindowPart(w)` — nil when either bound is empty, else the window as given — is defined in `windows.go` and has no caller in the binary; transcript `window` parts are read by `chat.ResolveContextSpecs`, `llmcontext.LatestPinnedAndSpec` and the refinement re-apply handler directly (`refinement.md` § 4, `context.md` § 2.1).
