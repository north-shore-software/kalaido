# Reflection Window Calculation — Generated Audit Snapshot

> **Generated:** 2026-09-02, from source at commit `3998ebd`.
> This file is a generated audit snapshot — do not edit it. See `AGENTS.md` § "Generated audit docs". When code described here changes, a stale marker line is prepended above this block; nothing else in the file is ever modified by hand.

**Scope.** How a reflection's schedule windows are defined, versioned, enumerated on a grid, identified, assembled into the series (grid + backfilled + already-generated), and which window a refinement or a generate call defaults to. Only reflections have windows. Consumers: staleness (`rotation.md` § 2.1), the generate and windows routes and the background pass (`lifecycle-reflection.md` § 5, § 9), refinement seeding (`refinement.md` § 2), and context resolution's window clause (`context.md` § 2.1).

---

## 1. The window spec

A spec has five string fields: `mode`, `startTime`, `endTime`, `period`, `duration`. The engine reads **three**: `period` — a Go duration (`"24h"`, `"168h"`); missing, unparseable, or non-positive means *no schedule*; `duration` — a Go duration; missing or invalid means **tumbling** (`duration = period`); `startTime` — RFC3339, the grid origin (§ 3). `mode` and `endTime` are validated nowhere, stored, round-tripped, and never read. The handlers' validation (`lifecycle-reflection.md` § 2) accepts an all-empty spec; otherwise requires a positive `period`, a positive `duration` if given, and RFC3339 `startTime` if given.

## 2. Versioning

`window_spec_versions` on the reflection is an append-only array of `{versionNumber, effectiveFrom, spec}`:

- Creation appends version 1 with `effectiveFrom` = `startTime` if that is in the past, else now. Discover proposals set `effectiveFrom` = the rhythm's onset date (`discover.md` § 6.1).
- Every schedule edit appends a version: `versionNumber` = max existing + 1, `effectiveFrom` = now (UTC RFC3339); an empty `startTime` inherits the governing version's. Nothing is ever overwritten or removed.
- The **governing version** at an instant is the one with the latest `effectiveFrom` not after that instant; versions with unparseable `effectiveFrom` are skipped. All callers ask for the governing version at *now*. A reflection whose only versions are in the future has no governing version and is treated as unscheduled.

The **lower bound** of a version is the later of its `effectiveFrom` and its `startTime`: the instant from which it produces windows.

## 3. Tiling: the grid and pending windows

`GridWindows(spec, lowerBound, now)`: grid point *k* (k ≥ 1) falls at `origin + k·period`, where `origin` = `startTime`, else `lowerBound`; window *k* ends at grid point *k* and starts `duration` earlier, truncated to `origin` (first-window truncation). Only windows ending **after** `lowerBound` and **at or before** `now` are produced, oldest first. At most 1000 windows (`MaxGridWindows`) are kept — the newest ones. A spec with no period yields nothing.

`CurrentGridWindows(rec, now)` = the governing version's grid from its lower bound. Because later versions are effective from the moment of the edit, a cadence change never re-enumerates history: the old version's windows stay in the series only through their approved snapshots (§ 6).

**Pending windows** = series windows (§ 6) with no approved snapshot and no generation in flight, oldest first.

## 4. Window identity

- `WindowKey(w)` = `"{start}_{end}"` (RFC3339 UTC bounds). It is what snapshots are filed under (`window_key`), what the approval-sequence index is scoped by, and what a generation claim locks.
- `WindowID(reflectionID, w)` = hex MD5 of `reflectionID + start + end`. It is the `id` the API hands out and accepts (`windowId`, `currentWindowId`); stable across evaluations, distinct per reflection for the same bounds.

Bounds are always rendered `UTC` `RFC3339` by `newWindow`; a window arriving from a client with different formatting produces a different key.

## 5. Consequences of the lower-bound rule

- A version whose `startTime` is later than its `effectiveFrom` starts nothing before `startTime`; one whose `startTime` is earlier back-fills from `effectiveFrom` only — unless it is version 1 created with a past `startTime`, whose `effectiveFrom` *is* that start, so the whole history is pending.
- The first window after an edit may be shorter than `duration` (truncated at the origin) only when the origin itself moved; an inherited `startTime` keeps phase.
- A reflection with a valid spec but whose first grid point has not yet passed has no grid windows: generation falls back to the trailing default window (§ 7), and staleness reports no pending windows.

## 6. The series

`SeriesWindows(rec, now)` merges, keyed by `WindowKey`, in this order: the current grid (§ 3); every `reflection_window` row (explicit backfills, flagged `backfilled`); every `reflection_snapshot` with a non-empty `window_key` and status `approved` or `generating` — approved ones set `hasApproved` and record the lens of the highest-sequence approval; generating ones set `generating` (matched by `resolved_window`, or by key alone for a claim row that has no `resolved_window` yet). A window that exists only as an approved snapshot (from an older schedule version) is therefore still in the series. Output is sorted by start, then end. `pending` and `discarded` snapshots contribute no windows.

### 6.1 Backfill materialisation

`MaterializeBackfill(rec, from, now)`: requires a governing version with a period (else error); `from` must be **before** the version's lower bound (`ErrBackfillOutOfRange`). The grid origin is shifted back by whole periods so the backfilled windows align with the existing grid, and `GridWindows` is enumerated from `from` to the lower bound. Each window is written as a `reflection_window` row (`window_key`, `start`, `end`, `window_spec_version_number`); a duplicate (unique on reflection + key) is tolerated. Materialisation is permanent and independent of whether generation later succeeds.

## 7. Default refinement window

`DefaultRefinementWindow(rec, now)`: nil for an unscheduled reflection. Otherwise the **last** grid window (the most recently completed grid point). Before the first grid point has passed: a trailing window of one `duration` ending at `now` truncated to the minute, starting no earlier than `startTime`; nil if that is empty. It is the window a new refinement targets by default, the `currentWindowId` in the windows route, and the window a generate call falls back to when nothing is owed.
