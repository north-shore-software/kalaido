---
title: "One-click reconcile: small-diff auto-approval"
status: "specified"
author: "human"
created: "2026-08-13"
updated: "2026-08-17"
---

## Summary

The user-facing feature is still **one-click reconcile**: one click from the
dashboard brings the whole workspace up to date. Most of it has shipped as
**speculative chain generation** (see "Already shipped" below): "Generate all"
drains the stale set in dependency order, generating every candidate up front —
past unapproved upstreams — so the user click-approves through the chain with
zero waits.

What remains is the last mile of that click-through: most candidates barely
changed, and approving them is rubber-stamping. The remaining implementation
is **auto-approval of projection snapshots, under certain circumstances**,
plus the audit/undo surface that makes silent approval trustworthy.

## Already shipped (context, not scope)

- "Generate all" on the dashboard starts a background wave: dependency-ordered,
  background LLM priority, dedup-guarded, coalesced. Reflections publish
  automatically (including catching up elapsed schedule windows); projections
  get pending candidates, speculatively consuming unapproved upstream
  candidates. Approving a candidate as-is instantly validates its dependents
  (approval promotes the record in place).
- Refining a still-pending chain candidate re-triggers a wave that regenerates
  only its stale downstream subtree.
- Single-item refresh never cascades and always presents its candidate.
- Wave-generated snapshots carry `chain_origin = "generate_all"`.

Deliberately **obviated, not deferred** — do not re-propose: the holding page,
run entity, soft stop, and resumable run state from the earlier version of
this spec all compensated for *waiting between approvals*, and speculation
removed the waiting. "Next" is the next Review row; "resume" is pressing the
button again; progress is the utility bar and rows flipping live.

## Requirements

### 1. Auto-approval policy
- Opt-in per workspace, on `kalaidoscope_config`: an enable toggle (default
  off) and a diff threshold percentage (default 5% when first enabled).
- Applies **only to wave-generated candidates** — eligibility is exactly
  `chain_origin` being set. Single-item refreshes are never auto-approved.
- Evaluated server-side during the wave, at generation time: if the
  candidate's diff against the projection's live approved snapshot is at or
  below the threshold, it is approved before any client sees it, immediately
  validating its speculative dependents (which then evaluate their own diffs
  in turn, in wave order).
- A projection with no prior live snapshot is never auto-approved.
- Reflections are untouched — they already publish without a review gate.

### 2. Diff metric
- Line-based, on the markdown content: changed lines (added + removed) over
  `max(lines in live, lines in candidate)`.
- Computed and **recorded on the snapshot** at generation time, and the same
  number is what review UI shows — users calibrate the threshold against the
  figure the policy actually used.

### 3. Trust surface
- Review shows the candidate's diff percentage ("differs by 4%").
- Auto-approved snapshots are identifiable in the entity's timeline, with the
  recorded diff ratio; the dashboard summarizes recent auto-approvals with
  links.
- **Revert**: any snapshot in a timeline can be made live again, implemented
  as publishing a new approved snapshot carrying the old content (history is
  append-only; the revert is an honest timeline event). Downstream simply
  shows as out of date. An auto-approve mistake is one click to undo.

## Related idea (out of scope)

A second, size-independent auto-approval criterion — approve when the delta is
*additive only*, possibly via an LLM judge rather than the line diff — is
recorded separately in
`one-day-maybe/engine-2026-08-17-auto-approve-additive-only-deltas.md`.

## Dependency

Meaningless without deterministic snapshot generation (temperature 0 for the
snapshot role — the LLM gateway wish): with sampling noise, regenerating an
unchanged projection can produce a >5% diff of pure noise, and the threshold
measures the model's temperature rather than the input's drift. Ship the
snapshot-role parameter policy first, or ship this default-off with the
threshold documented as unreliable until it lands.

## Acceptance Criteria
- [ ] Workspace settings expose the auto-approve toggle (default off) and threshold (default 5%).
- [ ] With auto-approval on, a wave auto-approves chain candidates at or below the threshold server-side; candidates above it, from single-item refreshes, or for first-ever snapshots wait for review.
- [ ] An auto-approved candidate's speculative dependents are validated without regeneration and evaluated for auto-approval in the same wave.
- [ ] The diff ratio is recorded on every wave-generated candidate and shown at review.
- [ ] Auto-approved snapshots are identifiable in timelines and in a dashboard summary of recent auto-approvals.
- [ ] Any timeline snapshot can be reverted to via re-publish; downstream then reads as out of date.
