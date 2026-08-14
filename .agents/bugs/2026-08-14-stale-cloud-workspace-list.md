---
title: "Cloud workspace list is never pruned — deleted and other-account workspaces linger"
status: "open"
author: "human"
created: "2026-08-14"
---

## Description
`availableKalaidoscopes` only ever grows. `upsertAvailableKalaidoscopes`
(`app/src/hooks/app-state-actions.ts:26`) merges incoming records into the
existing list and never removes anything, so the cloud registry is treated as
additive when it is actually authoritative. Anything that disappears server-side
stays on screen indefinitely, and the list is persisted, so it survives restarts.

## Steps to Reproduce

### A. Workspace deleted server-side
1. Sign in and open `/onboarding/cloud` so the workspace list loads.
2. Delete one of those workspaces from the cloud registry.
3. Reload the page. The deleted workspace is still listed, and clicking it fails.

### B. Account switch
1. Sign in as account A, which owns at least one cloud workspace, and visit
   `/onboarding/cloud`.
2. Sign out and sign in as account B, which owns none.
3. Account A's workspaces are still listed under account B, and cannot be opened.

## Expected Behavior
`listCloudKalaidoscopes` is the source of truth for `type === "cloud"` entries.
After a successful load, cloud workspaces absent from the response should be
dropped from both app state and the persisted `availableKalaidoscopes` setting.
Local workspaces belong to the device and must be left alone.

## Observed Behavior
Cloud entries accumulate and are never removed. In case B this also masks the
genuinely-empty state: `workspaces.length === 0` is false, so account B never
sees the "No cloud workspaces yet" empty state that describes its real situation.

## Context / Relevant Code
- `app/src/hooks/app-state-actions.ts:26` — `upsertAvailableKalaidoscopes`, merge-only.
- `app/src/features/onboarding/pages/CloudWorkspaces.tsx` — calls the upsert, then
  persists the merged list.
- `app/src/api/cloud/user.ts` — `listCloudKalaidoscopes`, the authoritative source.
- `app/src/lib/cloud-sign-out.ts` — added for the creation-flow fix; drops cloud
  entries on sign-out, which covers case B *only* when the user signs out through
  the app. A session that expires, or a token cleared another way, still leaves
  the stale list behind. Case A is not covered at all.

## Notes
A pruning `setAvailableKalaidoscopes` on successful load would fix both cases and
make `cloud-sign-out.ts`'s clearing step a belt-and-braces measure rather than
the only defence. Care needed: prune only on a *successful* list, never on an
error, or an offline launch would wipe the user's workspaces from the list.
