---
title: "No import button available when fragments exist (>0 fragments)"
status: "open"
author: "human"
created: "2026-08-17"
---

## Description
No import button is available if you already have >0 fragments (it is currently only present in the fragment stream empty state).

## Steps to Reproduce
1. Ensure workspace has >0 fragments.
2. Attempt to find or access the import button.

## Expected Behavior
An import button/option should remain accessible even when fragments exist (>0 fragments).

## Observed Behavior
The import button is only present in the fragment stream empty state, so users with >0 fragments cannot access import functionality.

## Context / Relevant Code
- Affected UI/components: Fragment stream empty state, Add note dialog, Connections page
- Notes: This will be handled by adding it to the add note dialog, and when the connections page comes back.
