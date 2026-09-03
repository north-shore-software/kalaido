# Projection Lifecycle — Generated Audit Snapshot

> **Generated:** 2026-09-02, from source at commit `3998ebd`.
> This file is a generated audit snapshot — do not edit it. See `AGENTS.md` § "Generated audit docs". When code described here changes, a stale marker line is prepended above this block; nothing else in the file is ever modified by hand.

**Scope.** The life of one projection: creation, authoring, generation (with its claim row and minimal-diff rewrite), approval, model resolution, update, and deletion. Shared machinery lives in its own docs — the refinement conversation and lens in `refinement.md`, context resolution in `context.md`, staleness and the wave in `rotation.md`, scheduling in `llm-queue-quota.md`; endpoint detail in `api.md` § 5 and § 7, fields in `schema.md`.

---

## 1. Objects and states

A projection is a record holding a `name`, a `status` (`proposed` or `active`), an optional per-entity `model` override, a `current_context_spec`, a `current_lens_id`, `pinned_by` (users), and discover provenance (`origin_run_id`, `brief`). Its output history is a series of `projection_snapshot` rows. A snapshot has four statuses:

| Status | Meaning |
|---|---|
| `generating` | A claim row: generation in progress (§ 4.1). Not output. |
| `pending` | A reviewable candidate. At most one per projection (§ 4.3). |
| `approved` | Published output. |
| `discarded` | A superseded candidate. Not output. Never deleted. |

The **active** snapshot is a derivation: the approved snapshot with the highest `approval_sequence_number` (unique per projection by a partial index). Approval promotes a row in place (same id). Lenses are immutable rows with `parent_lens_id` lineage; old ones are never removed (`refinement.md` § 1).

`proposed` projections are written only by discover (`discover.md` § 5) and become `active` at their first refinement commit. Staleness evaluates `active` entities only.

## 2. Creation

`POST /api/projections` `{name}` (a `windowSpec` in the body → 400). Created `active` with a name and nothing else: no context spec, no lens, no snapshot, no model override. Response `201 {projectionId}`. In rotation terms it is a *draft*: never reported stale, never blocking dependents (`rotation.md` § 2). It cannot generate (§ 4: `ErrLensNotReady`) until a refinement is committed.

## 3. Authoring: refinement → commit

A refinement session (`refinement.md` § 2) is opened on the projection, optionally scoped to one existing snapshot (whose `context_spec` seeds the session) or to an explicit `contextSpec`. Each turn drafts a lens and previews it against the session's pinned context. **Commit** (`refinement.md` § 5) creates the lens row, appends an **approved** snapshot carrying the previewed output as-is (no regeneration), re-points `current_lens_id` and `current_context_spec`, sets `status = active`, and discards any other pending candidate. A commit opened from a still-`pending` chain candidate inherits its `chain_origin` and requests a wave (a no-op while the wave is disabled). Response `200 {snapshotId}`.

## 4. Generation and approval

`POST /api/projections/{id}/candidates` `{preview?}` — body optional. `preview: true` → the result is `pending`; otherwise **approved** immediately (no review step). Before generating, the handler evaluates rotation for this projection; if it is `blockedBy` any upstream → 409 (`upstream dependencies are not up to date; approve them first`); an evaluation error is logged and ignored. Generation runs detached from request cancellation.

### 4.1 Claim

`claimGeneration`: in one transaction, existing `generating` rows for the projection are checked — one younger than 10 minutes → `ErrGenerationInFlight` (409 `A generation for this projection is already running.`); older ones are deleted as stale. A new row is inserted with `status = generating` and `generation_timestamp = now`. The row is the lock and what the UI shows as "generating". On any failure before completion the claim is deleted (if still `generating`). Boot sweeps all leftover claims (`boot-and-workers.md` § 1).

### 4.2 Produce

1. The active lens (`refinement.md` § 6) supplies the prompt and the **lens's** `context_spec`; an empty prompt → `ErrLensNotReady` (409 `This projection's lens is still being prepared — try again in a moment.`).
2. The lens spec is resolved unwindowed (`context.md` § 2–3) and hydrated in full mode as the source block. Resolution errors leave an empty source block silently.
3. `ApplyPrompt(lens, sources)` at `RoleSnapshot` (temperature 0), model per § 5, after `CheckPromptFits` (`ErrContextTooLarge` → 422). Output trimmed.
4. **Minimal-diff rewrite** against the newest approved snapshot: skipped when none exists, when it was produced by a **different lens** (log: generating from scratch), or when the candidate equals it byte-for-byte. Otherwise two more turns on the same conversation — `SnapshotDeltaPrompt(previous)`; a reply of exactly `NO CHANGES` republishes the previous text verbatim; else `SnapshotMergePrompt()` integrates only the bullets. A rewrite failure keeps the raw candidate (logged) unless it was a preemption (the whole generation is retried by workers, or fails the request) or the context died (aborted, nothing persisted).
5. Empty output → error, claim released.
6. `completeClaimedSnapshot`: the claim row is filled in place — `lens_id`, `output`, `context_spec` (the lens's), `resolved_context`, `status`, `model`, `chain_origin` (from the context; set only inside a wave), `generation_timestamp = now` (overwritten) — and every **other** `pending` row for the projection is set `discarded`, in one transaction.
7. If the requested status is approved, `ApproveSnapshot` runs (§ 4.3).

Response `200 {snapshotId}`. Quota → 402 (unreachable in this build, `llm-queue-quota.md` § 1); provider error → its envelope; "not found" in the error text → 404; else 500.

### 4.3 Approval

`POST /api/projections/{id}/candidates/{rid}/approve`: the snapshot must belong to the projection (404 otherwise). `ApproveSnapshot`, in one transaction: a snapshot already carrying an `approval_sequence_number` is a no-op; `generating` → refused (`generation still running`); `discarded` → refused (`candidate was superseded`); empty decoded output → refused (`candidate has no content`) — all three as 422 `ErrNotApprovable`. Otherwise `approval_sequence_number` = highest existing + 1 (1 for the first), `approval_timestamp = now`, `status = approved`, and other pending candidates discarded. Response `200 {snapshotId}`. Approval never triggers generation of dependents (the wave is disabled).

## 5. Model resolution

Every model call for a projection resolves `ResolveRoleFor(role, projection.model)`: the override wins verbatim, else the workspace's role model (`models.md` § 5). Roles used: `snapshot` for generation and the refinement preview; `refinement` for the refinement chat. The concrete model is stamped on every snapshot (`model`) and every assistant message it produced. `SnapshotIsCurrent` (wave dedup, `rotation.md` § 3) treats a snapshot whose `model` differs from the currently effective one as non-current.

## 6. Deletion

`DELETE /api/projections/{id}` → 204. PocketBase cascades: `projection_snapshot` rows, refinement conversations (and their `chat_message` rows), and `refine_proj_snapshot_conversation` rows are deleted. Lens rows are **not** deleted (no cascade relation from lens to projection). Other entities' `current_context_spec` entries naming this projection in `sourceProjectionIds` are **not** scrubbed (unlike colour deletion); resolution simply finds no snapshot for the missing upstream and staleness builds no edge for it.

## 7. Update

`PATCH /api/projections/{id}` `{name?, pinned?, model?}` (a `windowSpec` → 400). `name` replaces; `model` is trimmed and stored (`""` clears the override, no validation against any model table); `pinned` adds or removes the **authenticated** user's id in `pinned_by` — with no auth on the request the field is left unchanged silently. Response `200 {id}`.
