# Projection Lifecycle — Generated Audit Snapshot

> **Generated:** 2026-09-17, from source at commit `895984c`.
> This file is a generated audit snapshot — do not edit it. See `AGENTS.md` § "Generated audit docs". When code described here changes, a stale marker line is prepended above this block; nothing else in the file is ever modified by hand.

**Scope.** The life of one projection: creation, authoring, generation (its claim row, the three generation modes, joining a generation already running), hand edits of a candidate, approval, model resolution, soft deletion and restore, and update. Shared machinery lives in its own docs — the refinement conversation and lens in `refinement.md`, context resolution and the prompt-size guard in `context.md`, staleness and the reconcile wave in `rotation.md`, the call path and error envelopes in `llm-queue-quota.md`, role resolution in `models.md`; endpoint detail in `api.md` § 5 and § 7, fields in `schema.md` § 2.5, § 2.7, § 2.8 and § 2.10.

**Completeness anchor.** 9 routes registered under `/api/projections` at exactly one site (`server/server.go`, the `// Projections` block in `RegisterRoutes`): `POST /api/projections`, `PATCH /api/projections/{id}`, `DELETE /api/projections/{id}`, `POST /api/projections/{id}/restore`, `POST /api/projections/{id}/candidates`, `POST /api/projections/{id}/candidates/{rid}/approve`, `POST /api/projections/{id}/candidates/{rid}/edit`, `POST /api/projections/{id}/refinements`, `POST /api/projections/{id}/refinements/{rid}/commit`. No record hook (`OnRecord*`/`OnModel*`) is bound on the `projection` or `projection_snapshot` collection anywhere in the binary; both collections have `DisableWriteOperations` set, so every write goes through these routes, the refinement chat, discover, the reconcile wave, or the colour-delete scrub.

---

## 1. Objects and states

A projection is a `projection` row: `name`, `status` (`proposed` | `active`), `description`, `current_context_spec` (JSON; the scope every generation resolves — owned by the entity, the lens carries no copy), `current_lens_id`, `generate_with_model` (per-entity model override, empty = workspace role default), `pinned_by` (users), `created_by_discover_run_id` (empty = human-created), and `deleted_at` (the soft-delete stamp, § 6). Its output history is a series of `projection_snapshot` rows. A snapshot has four statuses:

| Status | Meaning |
|---|---|
| `generating` | A claim row: a generation is running (§ 4.1). Not output. |
| `pending_review` | A finished candidate awaiting the user. At most one per projection, except the pair a hand edit leaves (§ 4.4). |
| `approved` | Promoted at some point. Not necessarily current. |
| `discarded` | A superseded candidate. Not output. Never deleted. |

The **current** output is a derivation: the `approved` snapshot with the highest `approval_sequence_number` (unique per projection by the partial index `idx_projection_snapshot_approval_seq`, `WHERE status = 'approved'`). Approval promotes a row in place (same id). A snapshot also carries `lens_id`, `output`, `context_spec` (the entity's spec at generation), `resolved_context` (the receipt, `context.md` § 5), `generated_by_model`, `generation_trigger` (empty, or `generate_all` for a wave-produced row), `created_from_refinement_id`, `approved_at` and `generated_at`. Lenses are immutable `lens` rows with `parent_lens_id` lineage; none is ever removed (`refinement.md` § 1).

`proposed` projections are written only by discover (`discover.md` § 5): `status = proposed`, `description` = the proposal's message, `current_context_spec` = `{colourIds, sourceProjectionIds}`, `created_by_discover_run_id` set. A projection becomes `active` at creation through the route (§ 2) or at its first refinement commit (§ 3). Staleness evaluates `active`, non-deleted projections only (`rotation.md` § 1); an `active` projection with no approved snapshot is a *draft* — reported with an empty verdict and never blocking dependents (`rotation.md` § 2).

## 2. Creation

`POST /api/projections` binds `{name, description?, windowSpec?}`. A malformed body → 400 `invalid request body`; a non-null `windowSpec` → 400 `windowSpec is only valid for reflections`. The row is created in one transaction with `name` (not validated; empty is accepted), `status = active`, and `description` when its trimmed value is non-empty. Nothing else: no `current_context_spec` (null), no lens, no snapshot, no model override. A save error → 500 `create projection failed`. Response `201 {projectionId}`. Until a refinement is committed the projection cannot generate (§ 4.2: `ErrLensNotReady`).

## 3. Authoring: refinement → commit

**Opening.** `POST /api/projections/{id}/refinements` (`refinement.md` § 2) requires `clientId` (400 `missing clientId`). The projection is loaded live (§ 6); a missing or soft-deleted projection fails the transaction and is reported as 500 `failed to create refinement`. An optional `snapshotId` scopes the session to one snapshot and is stored as `projection_snapshot_id`; the session's starting context is the request's `contextSpec` when present, else that snapshot's `context_spec`, else nothing. The starting context (if any) is persisted as a system message carrying `context_spec` and its resolved `pinned_ids`. Response `201 {refinementId, messages}`. Each turn drafts a lens and previews it against the session's pinned context (`refinement.md` § 3).

**Commit.** `POST /api/projections/{id}/refinements/{rid}/commit` (`refinement.md` § 5): unknown refinement → 404; no drafted lens in the transcript → 400 `no drafted lens found in chat`; the latest lens has no generated preview → 409; the refinement names no parent (directly or through its source snapshot) → 400; a path `{id}` that differs from the resolved parent → 400 `refinement parent target id mismatch`. `CommitRefinement` then runs detached from request cancellation, in one transaction:

1. If the session's source snapshot is still `pending_review`, its `generation_trigger` is inherited (a chain candidate edited mid-review keeps its mark); an approved source contributes nothing.
2. The parent is loaded live; a soft-deleted parent fails the commit (500 `failed to commit refinement`).
3. A `lens` row is created: `prompt` = the drafted lens, `parent_lens_id` = the previous `current_lens_id` when there was one, `created_from_projection_refinement_id` = this refinement.
4. The previewed output is appended **as-is** (no regeneration) as an `approved` snapshot: `lens_id` = the new lens, `context_spec` and `resolved_context` from the transcript, `generated_by_model` = `ResolveRoleFor(snapshot, generate_with_model)` (a resolution error leaves it empty), `generation_trigger` from step 1, `created_from_refinement_id` = this refinement. `ApproveSnapshot` (§ 4.3) then stamps the sequence number and discards every other `pending_review` candidate — including the source candidate the session was opened on.
5. The projection's `current_lens_id` and `current_context_spec` are re-pointed and `status` is set to `active`.

After the transaction `engine.RequestWave` is called, which is `reconcile.EnqueueWave` — a no-op unless automatic waves are enabled (`rotation.md` § 3). Response `200 {snapshotId}`.

## 4. Generation and approval

`POST /api/projections/{id}/candidates`. The body is bound into `GenerateSnapshotRequest` and a bind failure is ignored (an empty request). Of its fields only `preview` is read for projections; `sourceId`, `chatId`, `fragmentIds`, `colourIds`, `messages`, `windowId` and `all` are accepted and unused. `preview: true` → the result is `pending_review`; otherwise it is **approved** on completion with no review step. The projection is loaded live (missing or soft-deleted → 404 `projection not found`). The handler then evaluates rotation for the whole graph (`rotation.md` § 1) and reads this projection's row: `blockedBy` non-empty → 409 `upstream dependencies are not up to date; approve them first`; an evaluation error is logged and generation proceeds. Generation runs on a context detached from request cancellation.

### 4.1 Claim, and joining a live claim

`claimGeneration`, in one transaction: every existing `generating` row for the projection is inspected — one whose `created` is younger than `GenerationClaimTTL` (10 minutes) → `ErrGenerationInFlight`; older ones are deleted as leftovers of a crashed run. A new row is inserted with `projection_id` and `status = generating`, nothing else. That row is the lock and what the UI shows as generating. If the generation fails after the claim, `releaseClaim` deletes the row provided it is still `generating`. Boot deletes every leftover claim (`boot-and-workers.md` § 1).

When the interactive request meets `ErrGenerationInFlight` it does not refuse: `joinGeneration` waits on the request context, capped at the claim TTL, for the live claim to be filled (`AwaitGeneration`: the newest `generating` row is polled every 500 ms; a row that advances to any status other than `generating`/`discarded` is returned as the result; a row that disappears or turns `discarded` → `ErrGenerationAbandoned`; no claim at all → `ErrGenerationAbandoned`). On `ErrGenerationAbandoned` the handler starts a fresh generation of its own. A joined result carries whatever status the other generation requested (a wave produces `pending_review`) — this request's `preview` flag does not apply to it. A join that times out or is cancelled surfaces as 500 `generate projection failed`.

### 4.2 Produce

`GenerateSnapshot`, in order:

1. The active lens (`refinement.md` § 6) supplies the prompt; the scope is the projection's own `current_context_spec`. An empty prompt (no lens, or a `current_lens_id` that does not resolve) → `ErrLensNotReady` (409 `This projection's lens is still being prepared — try again in a moment.`), before any claim.
2. The model is `ResolveRoleFor(snapshot, generate_with_model)` (§ 5); a resolution error → 500. The claim is taken (§ 4.1).
3. The spec is resolved unwindowed and hydrated in full mode as the source block (`context.md` § 2–4). A resolution error, or a spec that resolves to nothing, leaves the source block and the receipt empty silently.
4. `ApplyPrompt(lens, sources)` with zero window bounds, then `CheckPromptFits` (`context.md` § 6; `ErrContextTooLarge` → 422 with the estimate text), then one call at `RoleSnapshot` on the resolved model through the shared call path (`llm-queue-quota.md` § 1). Output is trimmed.
5. The candidate is compared with the newest approved snapshot to choose a mode:

   | Situation | What is stored |
   |---|---|
   | No approved snapshot | The raw candidate (from scratch). |
   | Newest approved snapshot has a different `lens_id` | The raw candidate (from scratch; logged `lens changed since last approval`). |
   | Candidate equals the approved output byte-for-byte | The approved text; the generation is *unchanged*. |
   | Otherwise | **Minimal-diff rewrite**: two more turns on the same conversation — `SnapshotDeltaPrompt(previous)`, and if the reply is exactly `NO CHANGES` the previous text verbatim (*unchanged*), else `SnapshotMergePrompt()` whose result replaces the candidate. A rewrite failure keeps the raw candidate (logged), except a preemption (the error is returned; the wave retries the whole generation, a request reports a generic failure) or a dead context (aborted, nothing persisted). |

6. Empty output → error, claim released.
7. **Speculative settle.** If the result is *unchanged* and the context carries a generation trigger (only the reconcile wave sets one — `rotation.md` § 3), no new row is made: `settleApprovedInPlace` rewrites the current approved snapshot's `context_spec`, `resolved_context`, `generated_by_model` and `generated_at` and discards every other `pending_review` row, in one transaction; the claim is released; the approved row's id is the result. If the newest approved snapshot no longer carries the generating lens, nothing is written and the flow falls through to step 8. An interactive generation that changed nothing still produces a candidate.
8. `completeClaimedSnapshot`: the claim row is filled in place — `lens_id`, `output`, `context_spec` (the projection's current spec), `resolved_context`, `status` (requested), `generated_by_model`, `generation_trigger` (from the context; empty for interactive calls), `created_from_refinement_id` empty, `generated_at = now` — and every **other** `pending_review` row for the projection is set `discarded`, in one transaction.
9. If the requested status is `approved`, `ApproveSnapshot` runs (§ 4.3).

The three callers and what they ask for:

| Caller | Status requested | Trigger on context | Upstream snapshots resolve to (`context.md` § 3) |
|---|---|---|---|
| Route, body omitted or `preview: false` | `approved` | none | latest approved |
| Route, `preview: true` | `pending_review` | none | latest approved |
| Reconcile wave | `pending_review` | `generate_all` | newest row that is neither `generating` nor `discarded` |

Response `200 {snapshotId}`. Error mapping: quota exhausted → 402 (`llm-queue-quota.md` § 5; no quota authorizer is installed in this binary, so unreachable); `ErrLensNotReady` → 409; `ErrGenerationInFlight` → 409 (reachable only from the fresh generation after an abandoned join); `ErrContextTooLarge` → 422; a provider error → its envelope (`llm-queue-quota.md` § 6); any other error whose text contains `not found` → 404; else 500 `generate projection failed`.

### 4.3 Approval

`POST /api/projections/{id}/candidates/{rid}/approve`: `{id}` and `{rid}` are required (400); the snapshot must exist (404 `candidate not found`) and its `projection_id` must equal `{id}` (404 `candidate does not belong to this projection`). The projection itself is not loaded: a soft-deleted projection's candidate approves normally. `ApproveSnapshot`, in one transaction: a snapshot already carrying an `approval_sequence_number` is a no-op (200); `generating` → `generation still running`; `discarded` → `candidate was superseded`; output empty after trimming → `candidate has no content` — each as 422 `ErrNotApprovable`. Otherwise `approval_sequence_number` = highest existing + 1 (1 for the first), `approved_at = now`, `status = approved`, and every other `pending_review` row is set `discarded`. Then `reconcile.EnqueueWave()` (a no-op unless automatic waves are enabled, `rotation.md` § 3). Response `200 {snapshotId}`.

### 4.4 Hand edit of a pending candidate

`POST /api/projections/{id}/candidates/{rid}/edit` binds `{oldText, newText}`; the candidate is resolved as in § 4.3; a bind failure → 400 `invalid request body`; empty `oldText` → 400 `oldText required`. `ApplyEdit` runs detached from request cancellation, projections only, in one transaction:

1. The projection is loaded live (a soft-deleted one → 500 `edit failed`). The candidate must be `pending_review` → else 409 `ErrEditNotPending`.
2. `oldText` must occur exactly once in the candidate's `output`: zero occurrences → `selected text not found in candidate`; more than one → `selected text occurs more than once in candidate`; `oldText == newText` → `edit changes nothing`; a replacement leaving only whitespace → `edit would empty the candidate`. Each → 422 with that text. An empty `newText` deletes the passage.
3. A `fragment` row is created: `type = edit`, `ingested_via = app`, `source` = `edit to projection "<name>" (candidate <rid>)`, `content` = the before/after passages in the edit-fragment format (`prompts.md` § 1), `occurred_at = now`. Its birth hooks fire as for any app-written fragment (`ingestion.md` § 7).
4. The fragment's id is appended (once) to the projection's `current_context_spec.fragmentIds`.
5. A new `pending_review` snapshot is appended: `output` = the candidate's with the passage replaced; `lens_id` and `generated_by_model` copied from the source; `context_spec` = the source's plus the fragment id; `resolved_context` = the source's with the fragment id added to `fragmentIds` and `expandedIds`; `generation_trigger` and `created_from_refinement_id` empty; `generated_at = now`. No model call is made.

The source candidate stays `pending_review`, so two candidates coexist; approving either (§ 4.3) discards the other. Because the approved snapshot's receipt lacks the new fragment, staleness reports it under `newFragmentIds` until the edited candidate, or a later regeneration, is approved (`rotation.md` § 2). Response `200 {snapshotId, fragmentId}`. Any other failure → 500 `edit failed`.

## 5. Model resolution

Every snapshot-producing call for a projection resolves `ResolveRoleFor(role, generate_with_model)`: a non-empty override (trimmed) wins verbatim, with no check against any model table; else the workspace's model for the role (`models.md` § 5). Roles: `snapshot` for generation (§ 4.2), the commit's provenance stamp (§ 3) and the refinement preview leg (`refinement.md` § 3.1); `refinement` for the refinement chat itself. Per-role generation options come from the registry (`models.md` § 1). The concrete model is stamped on every snapshot as `generated_by_model`. `SnapshotIsCurrent`, the wave's dedup guard (`rotation.md` § 3), reads the newest `pending_review`-or-`approved` snapshot and reports it non-current when its `lens_id` differs from `current_lens_id`, when its non-empty `generated_by_model` differs from the model that would be resolved now, or when the spec's current resolution differs from its receipt.

## 6. Deletion and restore

`DELETE /api/projections/{id}` soft-deletes. The row is loaded regardless of liveness (missing → 404); an already-deleted row → 204 with no further effect. If a `generating` claim younger than the claim TTL exists for the projection → 409 `a generation is running for this projection` (an older claim does not count). Otherwise, in one transaction, the projection's id is removed from `sourceProjectionIds` in the `current_context_spec` of every `projection` and `reflection` row whose spec text contains it (rows are matched by a `~` substring filter with no liveness condition; rows whose list did not contain the id are left unsaved), and `deleted_at = now` is stamped. Response 204.

Nothing else is written: `projection_snapshot`, `projection_refinement`, `chat_message` and `lens` rows stay, and snapshots' frozen `context_spec`/`resolved_context` keep any reference to the deleted id. No route hard-deletes a projection; the cascade relations (`schema.md` § 5) are reachable only outside the HTTP surface. While `deleted_at` is set: `PATCH`, generate and refinement-open report 404/500 as stated above; commit and edit fail with 500; approve is unaffected; staleness, the wave, discover's `list_existing` and organize counts exclude the row; and context resolution contributes none of its snapshots to dependents (`context.md` § 3), so a dependent that still pins it simply resolves fewer snapshots.

`POST /api/projections/{id}/restore` loads the row (missing → 404) and clears `deleted_at` when set; a live row is a no-op. References scrubbed at delete time are not re-added. Response `200 {id}`.

## 7. Update

`PATCH /api/projections/{id}` binds `{name?, pinned?, windowSpec?, generateWithModel?}` (`UpdateSynthesisRequest`; absent fields are untouched). A malformed body → 400; the projection is loaded live (missing or soft-deleted → 404 `projection not found`). `name` replaces verbatim (empty accepted); `generateWithModel` is trimmed and stored in `generate_with_model` (`""` clears the override; no validation); a non-null `windowSpec` → 400 `windowSpec is only valid for reflections`, evaluated after `name`/`generateWithModel` are set on the in-memory record but before any save, so nothing persists; `pinned` adds or removes the **authenticated** user's id in `pinned_by` — with no authenticated user on the request the field is left unchanged silently. A save error → 500. Response `200 {id}`.
