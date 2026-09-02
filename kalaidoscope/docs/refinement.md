# Refinement — Generated Audit Snapshot

> **Generated:** 2026-09-02, from source at commit `3998ebd`.
> This file is a generated audit snapshot — do not edit it. See `AGENTS.md` § "Generated audit docs". When code described here changes, a stale marker line is prepended above this block; nothing else in the file is ever modified by hand.

**Scope.** The refinement conversation shared by projections and reflections: how a session is opened and seeded, how each chat turn drafts a lens through a tool call and then executes it as a preview, the window-reapply turn, what a commit installs, and the lens row itself. Entity-agnostic; the per-entity consequences of a commit are in `lifecycle-projection.md` § 3 and `lifecycle-reflection.md` § 4. Transcript hydration and mention expansion are in `context.md` § 5–7; the model-facing text is inventoried in `prompts.md` § 2; routes in `api.md` § 7 (turns via § 4).

**Completeness anchor.** 4 routes (`POST /api/{projections,reflections}/{id}/refinements`, `POST …/{rid}/commit`) in `server/server.go`; the chat route dispatches to `HandleChatForRefinement` when the conversation id belongs to a `refine_*_snapshot_conversation` row; 2 tools advertised to the refinement model (`update_lens`, `suggest_name`); 1 fabricated tool (`apply_result`).

---

## 1. Objects

- A **refinement conversation** is a row in `refine_proj_snapshot_conversation` or `refine_refl_snapshot_conversation`: the parent (`projection_id` / `reflection_id`), for projections optionally the snapshot it was opened from (`projection_snapshot_id`), and the client's `external_conversation_id` (unique). Its messages are `chat_message` rows keyed by `refine_proj_conversation_id` / `refine_refl_conversation_id`.
- A **lens** is an immutable `lens` row: `prompt` (JSON string), `context_spec` (JSON), `parent_lens_id` (the lens it replaced on the parent, audit lineage only — nothing reads back through it), and exactly one of `created_from_proj_refinement_id` / `created_from_refl_refinement_id`. The collection has read and write disabled for API clients. Lens rows are never modified or deleted; deleting a parent entity does not cascade to its lenses.
- The **drafted lens** during a session is not a row: it lives on the transcript as the `input.lens` of the newest `tool-update_lens` assistant part. A lens row is created only at commit.

## 2. Opening a session (`POST …/{id}/refinements`)

Body `{clientId, snapshotId?, window?, contextSpec?}`; `clientId` required (400 otherwise). In one transaction:

1. The conversation row is created with `external_conversation_id = clientId`. Projections: `projection_id = {id}`; if `snapshotId` is given it is stored and the snapshot loaded (404-as-500 if missing). Reflections: `reflection_id = {id}`, parent loaded; `snapshotId` is **ignored**.
2. The seeded context spec is chosen: the body's `contextSpec` if present; else the source snapshot's `context_spec` (projections); else the parent's `current_context_spec` (reflections). Projections opened without `snapshotId` and without `contextSpec` are seeded with **no** spec.
3. Reflections only: the target window is the body's `window` if both bounds are set, else `DefaultRefinementWindow` (`windows.md` § 5) — nil for an unscheduled reflection. Its id is recomputed server-side.
4. If any of spec/window exists, one **system** message is persisted with a `context_spec` part, a `window` part, and — when a spec exists — a `pinned_ids` part resolved now under that window (`context.md` § 5).
5. Reflections with a `current_lens_id`: an **assistant** message is persisted carrying a `data-lens_seed` marker, a `tool-update_lens` part with the current lens text, and, if the chosen window has an approved snapshot, a `tool-apply_result` part with that snapshot's output. This makes the first turn see the standing lens (via `LensEcho`) and gives the preview a starting output. A reflection with no lens, or a projection, gets no seed turn.

Response `201 {refinementId, messages}` — the seeded messages with their persisted ids; the client must display these rather than reconstruct them, or the next turn duplicates them (`ExtractNewMessages` dedupes by id only). A session seeded with context but no user turn cannot be committed (§ 5).

## 3. A drafting turn (`POST /api/chat` routed to a refinement)

`HandleChat` first looks the request's `id` up in `refine_proj_snapshot_conversation`, then `refine_refl_snapshot_conversation`; a hit dispatches here. Then:

1. Stored messages are loaded; incoming messages whose ids are unknown are the new ones. `ResolveContextSpecs` stamps `pinned_ids` on any new system message that changes spec or window. New messages are persisted with an empty `model`.
2. **Re-apply check** (§ 4): if the new messages contain no `user` message and a system message with a bounded `window` part, the turn is a window re-apply and the lens-writer is not consulted.
3. The transcript is hydrated (`context.md` § 4–7) and prefixed with `RefinementSystemPrompt`. The model is `ResolveRoleFor(RoleRefinement, parent.model)` — a refinement has no model of its own; the parent is found by `projection_id`/`reflection_id`, else via the source snapshot. `CheckPromptFits` refuses with 422 before the call.
4. `usage.Stream` with tools `update_lens` (`lens` required, `suggested_name`) and `suggest_name` (`name`). Quota exhaustion → 402; classified provider error → its envelope (`llm-queue-quota.md` § 6); other errors → 500. All of these occur before the SSE stream opens.
5. The turn streams as an AI-SDK UI-message stream. Each tool call is persisted as a `tool-<name>` part **as it arrives** (the assistant row is created on first write and rewritten in place), then the final text + tool parts are written. The assistant row's `model` is the refinement model.
6. The **lens** is the `lens` argument of the turn's last `update_lens` call. If none (a clarifying question, or an unchanged lens), the stream finishes; the preview keeps its prior output.
7. **Lint:** if `engine.LensCountPin` finds a totality count phrase in the lens (`N in total`, `total of N`, `N total`, `all N`, digits or number words up to twenty), a `data-refine_lint {match}` part is streamed and persisted. The apply still runs; nothing is redrafted.
8. **Apply leg** (§ 3.1) against the transcript's latest `pinned_ids` and `window`.

### 3.1 The apply leg

`streamApplyLeg` executes the drafted lens exactly as a future regeneration would (`engine.ApplyDraftLens`):

- Source block = full-mode hydration of the pinned ids (`context.md` § 4); empty when nothing is pinned.
- Model = `ResolveRoleFor(RoleSnapshot, parent.model)`; failure → `data-refine_error {kind: apply_failed}`.
- A fabricated tool call named `apply_result` is streamed: `tool-input-start`, then `{"output":"` and JSON-escaped text deltas as the model produces them, then `"}` and a `tool-input-available` carrying the authoritative trimmed output.
- The prompt is `ApplyPrompt(lens, sources, windowStart, windowEnd)` at `RoleSnapshot` options (temperature 0), streamed via `usage.GenerateStreamMsgs`. `CheckPromptFits` is applied to it. Empty output is an error.
- **Always from scratch**: the minimal-diff rewrite used by production regeneration (`lifecycle-projection.md` § 4.2) is never applied to a preview.
- On failure a `data-refine_error {kind, message}` part is streamed and persisted instead: `quota_exhausted`, `context_too_large` (with the guard's text), or `apply_failed` (`generating the preview failed — send another message to retry`). The turn keeps its lens part; the preview keeps the last successful output; a commit of this lens is refused (§ 5).
- On success the `tool-apply_result {output}` part is appended to the **same** assistant message as the `tool-update_lens` part and the row rewritten.

The lens-writing model never sees `apply_result` (`context.md` § 7). The refinement model and the apply model are different roles and may be different models.

## 4. Window re-apply (reflections)

A send with only a new bounded `window` system part re-executes the standing lens against that window:

- The lens is the newest `tool-update_lens` on the transcript. If none exists yet, the stream just finishes (the window is on the transcript and the first drafting turn will use it).
- A fabricated assistant turn is streamed and persisted: a `data-window_reapply {start, end}` part, a **replayed** `tool-update_lens` part (same input, id suffixed `-reapply`) so the lens/output pairing invariant holds, then the apply leg (§ 3.1) with the new window. The row's `model` is empty.
- `Flatten` drops any message carrying `data-window_reapply`, so the lens-writer never sees these turns.

## 5. Commit (`POST …/{id}/refinements/{rid}/commit`)

1. The conversation is loaded (404 if missing). `ExtractDraftedLensAndSpec` scans assistant messages newest-first for the first one carrying a non-empty `tool-update_lens`; the `tool-apply_result` on **that same message** is the output. Messages without a lens part are skipped (a clarify turn); an apply part never exists without its lens.
2. Refusals: no lens on the transcript → 400 (`no drafted lens found in chat`, also the zero-turn seeded-session case); lens without output → 409 (`the latest lens has no generated preview — send another message to regenerate`).
3. Parent id from the conversation row, else via the source snapshot; missing → 400. A path `{id}` that disagrees with it → 400.
4. `engine.CommitRefinement` runs detached from request cancellation, in one transaction:
   - Projections only: if the source snapshot is still `pending`, its `chain_origin` is carried forward (an edit mid click-through keeps the chain mark; refining an approved snapshot does not).
   - A `lens` row is created: `prompt`, `context_spec` = the transcript's latest spec, `parent_lens_id` = the parent's previous `current_lens_id` (if any), the refinement relation.
   - Projections only: an **approved** `projection_snapshot` is appended — `lens_id` = the new lens, `output` = the previewed output, `context_spec` and `resolved_context` = the transcript's latest spec and pinned ids, `model` = `ResolveRoleFor(RoleSnapshot, parent.model)`, `created_from_refinement_id`, the carried `chain_origin` — then approved (`ApproveSnapshot`: next sequence number, discards other pending candidates). Reflections publish **nothing**: the previewed window was a sample.
   - The parent's `current_lens_id`, `current_context_spec` are re-pointed and `status` set to `active` (a discover-proposed entity becomes active here).
5. After the transaction: if a chain origin was carried, `RequestWave()` is called (a no-op while the wave is disabled, `boot-and-workers.md` § 2). Reflections: `RunPendingWindows` starts background generation of every window the series owes, as approved, at background priority (`lifecycle-reflection.md` § 5).
6. Response `200 {snapshotId}` — the new snapshot id for projections, `""` for reflections.

The refinement conversation and its messages are not deleted or closed by a commit; further turns on the same conversation continue from the installed lens's transcript, and a second commit creates another lens.

## 6. Active-lens resolution

`engine.resolveActiveLens` loads the parent's `current_lens_id` row and decodes `prompt` and `context_spec`. A parent without a lens (never committed) has an empty prompt; generation refuses it with `ErrLensNotReady`. Generation executes the **lens's** `context_spec`, not the parent's `current_context_spec` — the two are set together at commit and can diverge only through the colour-delete scrub (`colours.md` § 6), which rewrites the parent's spec but not the lens's.
