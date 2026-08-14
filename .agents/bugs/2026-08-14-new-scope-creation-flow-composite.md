---
title: "Composite Bug Report: New Scope / Kaleidoscope Creation Flow"
status: "open"
author: "human"
created: "2026-08-14"
---

## Description
This composite bug report covers issues in the New Scope / Kaleidoscope Creation flow:
1. **Incorrect Default Scope Type after Sign In**: When arriving at the "New Kaleidoscope" page via the sign-in path (clicking sign in on initial onboarding), "Cloud" should be selected by default rather than "Local".
2. **Missing User Identity Context**: When creating a new cloud scope while already logged in, the UI does not show *who* (which user/account) you are currently logged in as.
3. **Missing Local Ollama Status & Warnings**: When "Local Ollama" is selected on the new local scope page, the app should check Ollama status and show an "Ollama running" checkmark if active, or a download link if not. It should also display a warning that AI calls won't work until Ollama is set up (without blocking scope creation).

## Steps to Reproduce

### 1. Default Option after Sign In
1. On initial onboarding, click "Sign in".
2. Complete sign-in and proceed to the "New Kaleidoscope" page.
3. Observe the default selected option (Cloud vs Local).

### 2. Logged-In User Identity
1. Log into an account.
2. Navigate to create a new cloud scope.
3. Observe the page for user identity / account indicator.

### 3. Local Ollama Status & Warning
1. Go to the new local scope creation page.
2. Select "Local Ollama".
3. Observe the status indicators, download link, and warning messaging.

## Expected Behavior
- **Default Selection**: "Cloud" should be selected by default on the New Kaleidoscope page when coming from the sign-in path.
- **User Identity Display**: Clear display showing the logged-in account/user identity when creating a cloud scope.
- **Local Ollama Support**: Display "Ollama running" tick mark if Ollama is running, a download link if not running, and a non-blocking warning that AI calls require setup before working.

## Observed Behavior
- **Default Selection**: "Local" is selected by default instead of "Cloud".
- **User Identity Display**: Does not show who the user is logged in as.
- **Local Ollama Support**: Lacks Ollama running check, download link, and non-blocking setup warning.

## Context / Relevant Code
- Affected files: None explicitly named by user
- Human Context / User Braindumps:
  - *"if you arrive on the "new kqlaidoscope" page from the "I just signed in" path (you clicked sign in on initial onboarding page) - "Cloud" should be the default selected option, not local"*
  - *"when creating a new cloud scope, if you're already logged in, we should show \*who\* you are logged in as"*
  - *"when "local ollama" is selected on the new local scope page, we should show a "ollama running" tick (after checking), and a download link if it isn't - and a warning that AI calls won't work until it's set up (doesn't block creation)"*
