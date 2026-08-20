# Reflection Window Calculation — Generated Audit Snapshot

> **Generated:** 2026-08-18, from source at commit `f272f1c`.
> This file is a generated audit snapshot — do not edit it. See `AGENTS.md` § "Generated audit docs". When code described here changes, a stale marker line is prepended above this block; nothing else in the file is ever modified by hand.

**Scope.** How a reflection's schedule windows are defined, versioned, tiled, and identified. Only reflections have windows. Consumers of this calculation: pending-window listing in rotation, window selection on the generate route, and the reconcile wave.

---

## 1. The window spec

A spec has five string fields: `mode`, `startTime`, `endTime`, `period`, `duration`. The engine reads exactly two of them: **`period`** — parsed as a Go duration string (e.g. `"24h"`, `"168h"`); missing, unparseable, or non-positive means *no schedule* — and **`startTime`** (RFC3339), used only as a tiling anchor fallback (§ 3). `mode`, `endTime`, and `duration` are stored and round-tripped but never read by any engine code path.

## 2. Versioning

`window_spec_versions` on the reflection is an append-only array of `{versionNumber, effectiveFrom, spec}`:

- A new reflection is seeded with version 1 = an empty spec, effective at creation.
- Every schedule edit appends a version: `versionNumber` = max existing + 1, `effectiveFrom` = now (UTC RFC3339). Nothing is ever overwritten or removed.
- The **governing version** at any instant is the one with the latest `effectiveFrom` that is not after that instant; versions with unparseable `effectiveFrom` are skipped. All current callers ask for the governing version at *now*.
- Every windowed snapshot records the `window_spec_version_number` (and the spec itself) that governed its generation.

Note: tiling always uses the *currently governing* spec for the entire pending range — a window whose time span was historically covered by an older version still tiles, and is stamped, under the current one.

## 3. Tiling: computing pending windows

Pending windows are the schedule slots that have fully elapsed but never received an approved snapshot. Calculation:

1. **Resume point** = the end of the latest approved windowed snapshot: the maximum `resolved_window.end` over approved snapshots that have a `window_key`. (Approval *sequences* count per window and say nothing about which window is newest, so recency is taken from the recorded window bounds, not the sequence.) When no approved windowed snapshot exists: the spec's `startTime`; when that is unset or unparseable: the reflection's `created` time.
2. **Tile forward** one `period` at a time from the resume point: window *i* spans `[resume + (i−1)·period, resume + i·period)` for `i = 1 … floor((now − resume) / period)`. Windows are contiguous, fixed-width, and only fully elapsed ones exist — there is never a partial window ending at *now*.
3. A reflection whose governing spec has no `period` has no pending windows, ever (including one still on its seeded empty version 1).

## 4. Window identity

Two identifiers coexist for the same window:

- **Pending-window `id`** (wire): hex md5 of `reflectionID + start + end` over the RFC3339 strings — opaque, deterministic, minted only while the window is pending. It is what `windowId` on the generate route must match.
- **`window_key`** (stored): the readable `"{start}_{end}"` RFC3339 pair, written on the snapshot at generation and used for per-window approval sequencing and resume-point scans.

Nothing links the two except recomputation; the md5 id is never stored.

## 5. Consequences of the resume-point rule

- **Approving out of order erases history.** If several windows are pending and a *later* one is generated and approved first, the resume point jumps past the earlier ones — they cease to be pending and can never be tiled again. There is no backfill mechanism: a window wholly before the resume point is permanently unreachable.
- Generating a window only *materializes* it when approved: a pending (`preview`) windowed snapshot does not move the resume point — only approval does.
- Changing `period` re-tiles only forward of the resume point; existing windows keep the bounds they were generated with, whatever the current spec says.
- Windowless snapshots (generated when nothing was pending) carry no `window_key` and never affect the resume point.
