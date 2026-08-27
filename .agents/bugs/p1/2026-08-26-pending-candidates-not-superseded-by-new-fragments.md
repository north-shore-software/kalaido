---
title: "Pending candidates are never invalidated or regenerated when new in-scope fragments arrive"
status: "open"
author: "agent"
created: "2026-08-26"
---

## Description

Once a pending candidate exists for a projection, nothing in the lifecycle reacts to new
in-scope fragments landing afterwards. The candidate's `resolved_context` is frozen at
generation time, so it goes stale in place:

- Approving it produces a live snapshot that is immediately stale again (the new fragments were
  never consumed), forcing a second generate/review cycle.
- Nothing regenerates or supersedes the candidate; when the reconcile wave *does* run it
  generates a fresh candidate alongside the old one instead of replacing it (see
  `2026-08-26-concurrent-generations-pile-up-pending-candidates.md` for the pileup/race side).
- The UI compounds this: `getProjectionStatus` gives a pending candidate precedence over
  staleness ("a pending candidate to review trumps everything"), so the projections list showed
  "Review candidate" with no staleness signal at all while the candidate pointed at outdated
  content. Observed 2026-08-26: three wholeScope projections shared one new fragment; only the
  candidate-less one showed "1 new · stale", the other two showed only "Review candidate" for
  candidates that predated the fragment.

A display-level mitigation is in place (2026-08-26): the projections-list card now shows
"N new since candidate · stale" under the Review button, computed as rotation
`newFragmentIds` minus the candidate's `resolved_context.fragmentIds`
(`app/src/features/projections/pages/Projections.tsx`,
`.../components/projection-card.tsx`). The detail/review pages and the rotation queue still
have no such signal, and the candidate itself remains outdated.

## Steps to Reproduce

1. Generate a candidate for a wholeScope projection (leave it pending).
2. Ingest a new fragment that is in scope.
3. Observe: the pending candidate is unchanged; `GET /api/rotation` reports the fragment as new;
   approving the candidate yields an approved snapshot that is instantly stale.

## Expected Behavior

A pending candidate whose resolved context no longer matches the current resolved scope should
be treated as outdated: either superseded by a regeneration (replacing, not stacking), or
clearly surfaced as outdated everywhere it is offered for review — and approval flows should
not present it as if it brings the projection up to date.

## Observed Behavior

Candidate rows keep `status='pending'` with their original `resolved_context` indefinitely;
review UI offered them as the projection's current action while staleness was hidden; approval
of such a candidate (e.g. `vo88388jo329u92` on projection `y9cjy1a540g802d` would have) leaves
the projection stale.

## Update (2026-08-27)
Partially mitigated: a new generation now supersedes the old pending (at most one pending per target), the detail side rail shows "N new since candidate" with a Refresh button even while a candidate exists, and approving a stale candidate leaves staleness visible because approval discards siblings and the rotation plan is refetched on snapshot changes. Auto-regeneration of an outdated pending candidate remains unimplemented.
