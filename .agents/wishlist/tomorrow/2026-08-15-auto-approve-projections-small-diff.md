---
title: "Auto-approve projections when diff is below a certain percentage threshold"
status: "open"
author: "human"
created: "2026-08-15"
---

## Summary
Projections require manual approval regardless of how minor the diff is; user suggested an "auto-approve" feature when the diff percentage is below a threshold.

## Description
There is currently no auto-approval mechanism for projections when generated changes are minimal. User suggested adding an auto-approve capability for projections when the diff is less than a specified percentage.

## Steps to Reproduce
1. Regenerate a projection resulting in a very small percentage diff.
2. Observe that manual review/approval is still required.

## Expected Behavior
Ability to auto-approve projections when the diff percentage is below a set threshold.

## Observed Behavior
All projection diffs require manual approval regardless of percentage change.

## Context / Relevant Code
- Affected files: None explicitly named by user
- Notes: User reported: "maybe we need an "auto-approve" for projetions when the diff is less than a certain percentage"
