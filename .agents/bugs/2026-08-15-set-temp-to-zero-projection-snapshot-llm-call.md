---
title: "Set temperature to 0 for projection snapshot creation Generate LLM call"
status: "open"
author: "human"
created: "2026-08-15"
---

## Summary
The LLM call for generating a projection snapshot should have its temperature set to 0.

## Description
When creating a projection snapshot, the generate LLM call does not have its temperature set to 0. It needs to be set to 0.

## Steps to Reproduce
1. Trigger creation/generation of a projection snapshot.
2. Observe the temperature parameter passed in the generate LLM call.

## Expected Behavior
Temperature should be set to 0 for projection snapshot creation LLM calls.

## Observed Behavior
Temperature is not set to 0 during projection snapshot creation LLM calls.

## Context / Relevant Code
- Affected files: None explicitly named by user
- Notes: User reported: "set temp to 0 for a projection snapshot creation Generate LLM call"
