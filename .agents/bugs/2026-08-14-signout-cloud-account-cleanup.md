---
title: "Sign out does not clear associated cloud accounts from local settings/dropdown or unselect active cloud scope"
status: "open"
author: "human"
created: "2026-08-14"
---

## Description
When signing out of an account, associated cloud accounts are not cleaned up from local app settings or the selection dropdown, and the current active scope remains selected even if it was a cloud scope for that account.

## Steps to Reproduce
1. Sign into an account that has associated cloud accounts/scopes.
2. Ensure a cloud scope for that account is active/selected.
3. Sign out of the account.
4. Check local app settings, dropdown list, and active scope selection.

## Expected Behavior
- Associated cloud accounts are removed from local app settings upon sign-out.
- Associated cloud accounts are removed from the selection dropdown.
- If the current active scope was a cloud scope for the signed-out account, it is unselected.

## Observed Behavior
- Associated cloud accounts remain in local app settings and the dropdown after sign-out.
- Active cloud scope remains selected even after signing out.

## Context / Relevant Code
- Affected files: None explicitly named by user
- Notes: User noted: "when signing out of your account, we need to remove associated cloud accounts from the local app settings (and the dropdown) - and also unselect the current one if it was a cloud one for that account"
