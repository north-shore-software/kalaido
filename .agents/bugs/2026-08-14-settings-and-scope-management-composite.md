---
title: "Composite Bug Report: Settings & Scope Management"
status: "open"
author: "human"
created: "2026-08-14"
---

## Description
This composite bug report covers issues identified across Settings and Scope Management:
1. **Missing Scope Actions on 'Manage Kaleidoscopes' Page**: The "Manage Kaleidoscopes" page lacks any functionality to remove/delete scopes or perform other scope management tasks.
2. **Misplaced 'Local AI' Settings Tab**: The "Local AI" tab in settings feels misplaced now that AI provider configuration is managed per scope. Local AI settings should be inlined directly into individual "Manage Kaleidoscope" items.
3. **Cannot Add Account Scopes from Settings Sign-In**: When signing in from the settings page, there is no mechanism or option to add the signed-in account's scopes to the local dropdown selection.
4. **Outdated Content on Connections Page**: The "Connections" page contains a confusing mix ("mishmash") of controls and elements for features and concepts that no longer exist in the app.
5. **Gemini Model Selector & Advanced Settings Toggle**: The Gemini "model select" box is currently a plain text box instead of a dropdown. Model selection and advanced options should be hidden behind an "Advanced" section toggle, asking only for the API key by default.

## Steps to Reproduce

### 1. Scope Removal & Management Actions
1. Navigate to "Manage Kaleidoscopes".
2. Attempt to find options to delete or manage individual scopes.

### 2. Misplaced Local AI Tab
1. Open settings.
2. Observe the standalone "Local AI" tab alongside per-scope provider settings.

### 3. Account Scope Import via Settings
1. Open settings while signed out/local.
2. Sign into an account from settings.
3. Look for a way to import/add account scopes to the local scope dropdown.

### 4. Obsolete Connections Page Content
1. Navigate to the "Connections" page.
2. Review the displayed feature controls and integrations.

### 5. Gemini Model Selector & Advanced Layout
1. Open Gemini provider configuration settings.
2. Observe the "model select" input type and field visibility.

## Expected Behavior
- **Scope Management**: Provide controls to remove scopes and manage scope-level settings.
- **Local AI Settings**: Inline Local AI settings into the individual "Manage Kaleidoscope" scope items; remove standalone "Local AI" tab.
- **Settings Sign-In Flow**: Allow users signing in from settings to easily add account scopes to the local scope dropdown.
- **Connections Page**: Clean up outdated/deprecated controls and display only active features.
- **Gemini Configuration**: Convert model select to a dropdown menu and place model configuration behind an "Advanced" section toggle (show API key prompt by default).

## Observed Behavior
- **Scope Management**: No way to remove scopes or perform scope management.
- **Local AI Settings**: Separate "Local AI" tab exists in global settings despite per-scope provider structure.
- **Settings Sign-In Flow**: No option to add account scopes to local dropdown after sign-in.
- **Connections Page**: Contains outdated options for non-existent features.
- **Gemini Configuration**: Model selection is a plain text box and shown by default alongside API key.

## Context / Relevant Code
- Affected files: None explicitly named by user
- Human Context / User Braindumps:
  - *"manage kalaidoscopes page doesn't have any way to remove a scope, or anyting else."*
  - *"the "local AI" tab in settings feels misplaced now that provider is per scope. it probably should just get inlined into the manage kalaidoscope items"*
  - *"if you sign in from settings, there's no way to then add the scopes in your account to the local dropdown"*
  - *"the conections page is a weird mishmash of stuff that doesn't exist really any more?"*
  - *"the gemini "model select" box is just a textbox - we need a dropdown. also, let's put all of that behind "advanced" - by default let's just ask for api key"*
