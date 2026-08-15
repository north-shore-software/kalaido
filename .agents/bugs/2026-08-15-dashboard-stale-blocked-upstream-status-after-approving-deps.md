---
title: "Dashboard shows stale 'blocked upstream' status after approving all upstream dependencies"
status: "open"
author: "human"
created: "2026-08-15"
---

## Summary
Projections needing regeneration continue to display "blocked upstream" status on the dashboard even after all upstream dependencies have been approved.

## Description
When returning to the dashboard after approving all upstream dependencies for a projection, projections that still need regenerating continue to show the "blocked upstream" status text despite no longer being blocked.

## Steps to Reproduce
1. Approve all upstream dependencies for a projection.
2. Return to the dashboard.
3. Observe the status label on projections that still need regenerating.

## Expected Behavior
Status text should update to indicate the projection is ready to regenerate and no longer "blocked upstream".

## Observed Behavior
Status text still says "blocked upstream" even though upstream dependencies have been approved.

## Context / Relevant Code
- Affected files: None explicitly named by user
- Notes: User reported: "when you go back to dashboard after approving all of the upstream deps, the "blocked upstream" text on the ones that do still need regenerating, still says "blockedmupsteeam", even though they're not"
