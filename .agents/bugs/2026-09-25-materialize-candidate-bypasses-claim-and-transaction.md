---
title: "MaterializeCandidateIfNew appends a pending candidate outside the claim machinery and without a transaction"
status: "open"
author: "agent"
created: "2026-09-25"
---

## Description
When a refinement is not bound to a pending candidate, `refinement.MaterializeCandidateIfNew` appends a new `pending_review` snapshot via `AppendSnapshot` with no generation claim and no `discardOtherPending`, so a projection can hold two `pending_review` rows (every other writer keeps at most one). When it is bound, it rewrites the candidate with plain `app.Save` calls outside a transaction and creates a `lens` row before the snapshot save; a mid-way failure leaves an orphan lens row and the save error is discarded. Lens rows created this way are never installed on the projection and nothing prunes them.

## Steps to Reproduce
1. Open a refinement on a projection that already has a pending candidate from a wave, then bind a second refinement to the approved snapshot and run an apply leg.
2. Count `projection_snapshot` rows with `status = pending_review` for that projection.

## Expected Behavior
At most one pending candidate per projection; candidate rewrites atomic with their lens row.

## Observed Behavior
Two pending rows; `FindPendingCandidate` picks the newest by `created`. Orphan `lens` rows accumulate.
