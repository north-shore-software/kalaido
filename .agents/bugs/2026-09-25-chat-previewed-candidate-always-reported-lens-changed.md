---
title: "Every chat-previewed candidate is reported outdated with reason lens_changed"
status: "open"
author: "agent"
created: "2026-09-25"
---

## Description
`refinement.MaterializeCandidateIfNew` saves a fresh `lens` row on every projection apply leg and stamps it on the pending candidate's `lens_id`, but the parent's `current_lens_id` only moves at commit. The reconcile evaluator's candidate axis compares the two, so any candidate that has been previewed through the chat reports `candidate.outdated = true, reason = lens_changed` until it is committed, even though nothing upstream changed.

## Steps to Reproduce
1. Create a projection with an approved snapshot and open a refinement.
2. Send one turn that drafts a lens (an apply leg runs).
3. `GET /api/reconcile` and read that projection's `candidate` block.

## Expected Behavior
A candidate produced by the open refinement is not flagged as outdated by its own lens.

## Observed Behavior
`outdated: true, reason: lens_changed` for every chat-previewed candidate.
