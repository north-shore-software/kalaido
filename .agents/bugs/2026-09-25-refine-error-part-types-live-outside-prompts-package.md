---
title: "refine_error / refine_lint part types and SSE names are literals outside internal/prompts"
status: "open"
author: "agent"
created: "2026-09-25"
---

## Description
The project rule is that every model-facing or wire-identifier string for chat parts lives in `internal/prompts`. `internal/refinement/chat.go` writes `data-refine_error` and `data-refine_lint` part types and the `refine_error` / `refine_lint` / `lens` SSE data names as inline string literals. The client reads the same strings, so a rename on either side breaks silently.

## Steps to Reproduce
1. Grep `internal/refinement/chat.go` for `"data-refine_` and `"refine_`.

## Expected Behavior
Constants in `internal/prompts` next to the other `*PartType` names, referenced from `chat.go`.

## Observed Behavior
Inline literals in the call site.
