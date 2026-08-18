---
title: "Reflections should not regenerate for an in-progress window"
status: "open"
author: "human"
created: "2026-08-17"
---

## Description
Reflections should not regenerate for an in-progress window, but they currently seem to do so.

## Steps to Reproduce
1. Work with or update content in an in-progress window.
2. Observe if reflections trigger/regenerate.

## Expected Behavior
Reflections do not regenerate while a window is in-progress.

## Observed Behavior
Reflections seem to regenerate even for in-progress windows.

## Context / Relevant Code
- Affected UI/components: Reflection engine / window lifecycle
- Notes: Reported during reflection behavior observation.
