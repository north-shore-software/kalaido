---
title: "Projection remains in need of regeneration and blocked upstream after regenerating and approving"
status: "open"
author: "human"
created: "2026-08-15"
---

## Summary
After adding a fragment, a projection showing "2 new things" was regenerated and approved, but it immediately returned to showing "blocked upstream" and needing regeneration.

## Description
User added a new fragment. One of the projections indicated "2 new things". The user regenerated the projection and approved the output. However, after approval, the projection still indicated it needed regeneration and reported being "blocked upstream". User raised whether multiple regeneration events were generated.

## Steps to Reproduce
1. Add a new fragment that affects a projection (displaying multiple new items, e.g., "2 new things").
2. Regenerate the projection.
3. Approve the regenerated snapshot.
4. Observe the projection status after approval.

## Expected Behavior
Regenerating and approving the projection should resolve the stale state and clear the "blocked upstream" / regeneration needed status.

## Observed Behavior
The projection still displays "blocked upstream" and remains in need of regeneration after being regenerated and approved.

## Context / Relevant Code
- Affected files: None explicitly named by user
- Notes: User reported: "i added a new fragment. one of the projections said 2 new things, and then I regenerated it and approbed. and then it said blocked upstream, and was still in need of regeneration. did it somehow have 2 regneration events? or what?"
