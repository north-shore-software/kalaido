---
title: "Add Ollama status check indicator, download link, and non-blocking warning on New Local Scope page"
status: "open"
author: "human"
created: "2026-08-14"
---

## Description
When "Local Ollama" is selected on the new local scope page, the UI should check if Ollama is running and display an "Ollama running" tick mark if active, or a download link if it is not. A warning should also inform the user that AI calls won't work until Ollama is set up, without blocking scope creation.

## Steps to Reproduce
1. Navigate to the new local scope page.
2. Select "Local Ollama" as the option.
3. Observe the interface status indicator and warnings.

## Expected Behavior
- Display an "Ollama running" checkmark after checking system status if running.
- Display a download link for Ollama if it is not running.
- Show a warning that AI calls will not work until set up, while still allowing creation.

## Observed Behavior
- Missing running check/indicator, download link, and warning message when "Local Ollama" is selected.

## Context / Relevant Code
- Affected files: None explicitly named by user
- Notes: User noted: "when \"local ollama\" is selected on the new local scope page, we should show a \"ollama running\" tick (after checking), and a download link if it isn't - and a warning that AI calls won't work until it's set up (doesn't block creation)"
