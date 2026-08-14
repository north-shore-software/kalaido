---
title: "Composite Bug Report: Sign In / Sign Up Page & Authentication State"
status: "open"
author: "human"
created: "2026-08-14"
---

## Description
This composite bug report covers issues identified on the Sign In / Sign Up page and authentication state management:
1. **Redundant UI Controls & Unnecessary Signup Field**: The sign in/up page has a toggle at the top for "sign in" and "sign up", but also includes a redundant link underneath for "sign up". Additionally, the signup form asks for "Name", which is unnecessary (email is sufficient).
2. **Broken Social Logins**: The "Log in with Google" and "Log in with GitHub" buttons on the sign up/in page are not hooked up and do not work.
3. **Incomplete Sign-Out State Cleanup**: Signing out of an account does not remove associated cloud accounts from local app settings or the scope selector dropdown, and fails to unselect the active scope if it was a cloud scope for that account.

## Steps to Reproduce

### 1. Sign In / Sign Up Page Cleanups
1. Navigate to the sign in/up page.
2. Observe both the top toggle and the link underneath for "sign up".
3. View the signup fields and observe the "Name" input field.

### 2. Google / GitHub Social Logins
1. Navigate to the sign in/up page.
2. Click on "Log in with Google" or "Log in with GitHub".

### 3. Sign-Out State Cleanup
1. Sign into an account with associated cloud accounts/scopes.
2. Ensure a cloud scope for that account is selected as the active scope.
3. Sign out of the account.
4. Check local app settings, dropdown list, and active scope selection.

## Expected Behavior
- **Sign In/Up Form**: Remove the redundant "Sign Up" link underneath (keep only the top toggle). Remove the "Name" field on signup so only email is required.
- **Social Logins**: Google and GitHub login buttons should be properly hooked up and functional.
- **Sign-Out Cleanup**: Signing out should clear associated cloud accounts from local app settings and dropdowns, and unselect the active scope if it belonged to the signed-out account.

## Observed Behavior
- **Sign In/Up Form**: Displays both a top toggle and a redundant link underneath for sign up; collects "Name" during signup.
- **Social Logins**: Neither Google nor GitHub login button works.
- **Sign-Out Cleanup**: Associated cloud accounts remain in local settings/dropdown and active cloud scope remains selected after sign-out.

## Context / Relevant Code
- Affected files: None explicitly named by user
- Human Context / User Braindumps:
  - *"the sign in/up page has a toggle at the top for "sign in" and "sign up", but it also has a link underneath for "sign up". we don't need both. also, we don't need Name, which is collected on signup. email is enough."*
  - *"on the sign up/in page, there are buttons for log in with google and github, but neither is hooked up and actually works"*
  - *"when signing out of your account, we need to remove associated cloud accounts from the local app settings (and the dropdown) - and also unselect the current one if it was a cloud one for that account"*
