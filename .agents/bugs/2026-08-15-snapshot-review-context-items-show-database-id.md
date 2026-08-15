---
title: "Context items in projection snapshot review show database ID instead of projection name"
status: "open"
author: "human"
created: "2026-08-15"
---

## Summary
When reviewing a new projection snapshot, context items that are another projection show up as their database ID instead of their projection name.

## Description
In the projection snapshot review view, context items representing other projections display raw database IDs rather than human-readable projection names or titles.

## Steps to Reproduce
1. Open a new projection snapshot review where context items include another projection.
2. Look at the context items section in the review view.

## Expected Behavior
Context items that are projections should display their projection name/title.

## Observed Behavior
Context items show up as their database ID.

## Context / Relevant Code
- Affected files: None explicitly named by user
- Notes: User reported: "when you review a new projection snapshot, the context items - if they are another projection - show up as their database ID"
