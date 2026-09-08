---
title: "Onboarding import route and stage-entry mechanism left unreachable"
status: "open"
author: "agent"
created: "2026-09-08"
---

## Description
`src/features/onboarding/pages/OnboardingImport.tsx` is still registered as the
`onboarding-import` route but nothing navigates to it, and the mechanism that used to
reach it is now dead end to end.

The onboarding landing previously offered an "Import your notes" card whose
`createForImport` transition carried `{ intent: "import" }` into
`KalaidoscopeSetup`, which turned that into `entry: "onboarding-import"` on the
`createKalaidoscope` call. `actions.ts` stored it as `AppStage.entry`, and
`router-listeners.tsx` sent the user to the import page once the workspace existed.

The landing card, the transition, the `intent` field and the `entry` argument were all
removed when the dashboard grew its own import dialog. What is left:

- No transition anywhere targets `onboarding-import`.
- Nothing sets `AppStage.entry`, so `StageEntry` has no producer. `clearStageEntry()`
  in `OnboardingImport.tsx` can now only hit its early return.
- `switchLocalKalaidoscope`'s `entry` parameter is only ever fed from
  `appState.appStage.entry`, i.e. from the same dead source.

Confusingly, the page is still being maintained — it gained a new title, a supported-
formats hint and a new skip label in the same change that orphaned it.

## Steps to Reproduce
1. Grep the app for `"onboarding-import"` and for any `go(...)` targeting it.
2. Note the only hits are the route's own definition and the `StageEntry` type.
3. Grep for writers of `AppStage.entry` / callers passing `entry:` to
   `createKalaidoscope`. There are none.

## Expected Behavior
Either the page is meant to remain part of the flow — in which case a transition into
it needs restoring — or the dashboard import dialog supersedes it, and the page, its
transitions file, the `StageEntry` type, `clearStageEntry` and the `entry` parameter
threaded through `createKalaidoscope` / `openKalaidoscope` /
`switchLocalKalaidoscope` should all be removed together.

## Observed Behavior
The route, page and transitions file exist and are registered; the stage-entry
plumbing exists and compiles; none of it can run.
