> **STALE** — code has changed since this document was generated.

# Reflection Lifecycle — Generated Audit Snapshot

> **Generated:** 2026-08-18, from source at commit `f272f1c`.
> This file is a generated audit snapshot — do not edit it. See `AGENTS.md` § "Generated audit docs". When code described here changes, a stale marker line is prepended above this block; nothing else in the file is ever modified by hand.

**Scope.** The life of one reflection: creation, schedule editing, authoring, windowed generation, per-window approval, and deletion. Shared machinery lives in its own docs — window calculation in `windows.md`, lens compilation in `lens-distillation.md`, staleness and waves in `rotation.md`; endpoint detail in `api.md`, fields in `schema.md`. Where behaviour is identical to a projection's (`lifecycle-projection.md`), it is referenced, not repeated.

---

## 1. Objects and states

A reflection extends the projection shape (`name`, `model` override, `current_context_spec`, `current_lens_id`) with `window_spec_versions` — an append-only history of its schedule. Its output is a **time series**: `reflection_snapshot` rows, each either *windowed* (carrying `resolved_window`, `window_key` = `"{start}_{end}"`, and the governing `window_spec_version_number`) or *windowless* (generated when no windows were pending; carrying none of those). Statuses are `"pending"` / `"approved"` as for projections. The active snapshot is derived **per window**: the approved snapshot with the highest `approval_sequence_number` within each `window_key` (partial unique index on `(reflection_id, window_key, approval_sequence_number)`); windowless snapshots form their own series under the empty key.

## 2. Creation

Created bare, as a projection is, plus `window_spec_versions` seeded with **version 1: an empty spec**, effective immediately. An empty spec has no `period`, so a new reflection has no schedule and no pending windows until a real spec version is added. It is a *draft* until its first approved snapshot.

## 3. Schedule editing

A `windowSpec` on PATCH **appends** a new version (`versionNumber` = max + 1, `effectiveFrom` = now); history is never overwritten, and the version governing any instant is the latest one effective by then (`windows.md` § 2). A schedule edit touches nothing else: no lens, no context spec, no distillation request, no staleness flag — its only effect is on future window tiling.

## 4. Authoring: refinement → commit

As for projections (`lifecycle-projection.md` § 3), with the window dimension added:

- A session opened from a **windowed** snapshot seeds the conversation with that snapshot's `window_spec` (when it has a period), alongside the context seeding.
- **Commit** copies `resolved_window`, `window_key`, and `window_spec_version_number` from the source snapshot when it was windowed — the committed snapshot lands in that same window's series and sequences within it. A commit without a windowed source produces a windowless snapshot.
- A lens produced by an updating commit applies **forward only**: nothing regenerates historical windows under the new lens — the worker and waves only ever generate *pending* (never-materialized) windows, and materialized windows are never re-flagged (`rotation.md` § 2).

## 5. Generation

Generation resolves the current lens and its context spec exactly as for projections, plus:

- **Leaf constraint**: a reflection's context must resolve to fragments only; any upstream snapshot in the resolution fails the generation. The constraint is enforced at generation time — nothing prevents *writing* a spec that names projections or reflections.
- **Window selection** (manual route): one pending window by `windowId`, all of them with `all: true`, the single pending window implicitly, or — with zero pending windows — one windowless generation. Multiple pending windows with no selector is an error. Pending windows are computed per `windows.md` § 3.
- Each selected window generates its own snapshot; with `all`, windows generate sequentially and a mid-way failure leaves the earlier snapshots in place.

Status at birth differs from projections in one place: a **reconcile wave generates reflection snapshots directly approved** — reflections publish live everywhere except an explicit `preview: true` request:

| Path | Snapshot status |
|---|---|
| Manual generation, `preview: true` | `pending` |
| Manual generation, `preview` absent/false | `approved` immediately |
| Reconcile wave | `approved` immediately |
| Refinement commit | `approved` immediately |

## 6. Approval

Approval semantics are the projection's (in-place promotion, idempotent), scoped **per window**: the sequence number is max + 1 among approved snapshots of the same reflection *and the same `window_key`*. There is **no HTTP approval surface** for reflection snapshots — the approve route exists only for projections — so a `preview`-generated pending reflection snapshot can never be approved via the API; reflection snapshots become approved only at birth (non-preview generation, wave, commit).

## 7. Staleness

Evaluated entity-level against the single live snapshot (highest approval sequence across **all** windows), per `rotation.md` § 2, plus `pendingWindows` from the tiling calculation. Two consequences worth noting: content changes inside an already-materialized window never re-flag that window; and which snapshot serves as "live" for the context diff depends on approval sequence, not window recency.

## 8. Deletion

As for projections: unconditional hard delete, no downstream check; cascades remove snapshots and refinement conversations (and their messages); lenses survive; downstream consumers' spec entries resolve to nothing thereafter.
