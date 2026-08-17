---
title: "Context picker popup modal has no confirm or OK button"
status: "open"
author: "human"
created: "2026-08-17"
---

## Description
The popup modal version of the context picker lacks a "Confirm" or "OK" button. The only way to dismiss it is via the close 'X' button, which feels counterintuitive when making context selections.

## Steps to Reproduce
1. Open the popup modal version of the context picker.
2. Select context items.
3. Look for a button to apply/confirm the selection.

## Expected Behavior
The modal should provide a explicit "Confirm" or "OK" button to save/apply the selected context items and exit the modal.

## Observed Behavior
No confirm/OK button is present; only the close 'X' button is available.

## Context / Relevant Code
- Affected UI/components: Context picker popup modal
- Notes: Reported during context selection testing.
