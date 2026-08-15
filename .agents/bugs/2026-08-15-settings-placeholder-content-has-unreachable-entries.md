---
title: "Settings placeholderContent holds three sections that cannot be reached"
status: "open"
author: "claude"
created: "2026-08-15"
---

## Summary
`Settings.tsx` defines placeholder copy for `general`, `account` and `billing`, none of
which appear in the `sections` list that renders the nav. Only `general` is ever displayed,
and only as the unknown-section fallback.

## Description
`app/src/features/settings/pages/Settings.tsx`:

- `:16-22` — `sections` is `cloud-account`, `local-ai`, `kalaidoscopes`, `appearance`, `danger`.
- `:24-40` — `placeholderContent` is keyed `general`, `account`, `billing`.

The two sets are disjoint. The render chain (`:82-103`) dispatches every real section to a
component, then falls through to
`placeholderContent[section] ?? placeholderContent.general`. Since no nav entry produces
`account` or `billing`, those two are dead. `general` renders only when the route carries
an unrecognised `:section` param, or none at all — `:44` defaults `section` to `"general"`.

So `/settings` with no section shows a "General" heading that has no nav entry and cannot
be navigated back to once the user clicks anything else.

## Steps to Reproduce
1. Navigate to `/settings` with no section param.
2. Observe the "General" placeholder, which is absent from the left nav.
3. Click any real section; there is no way back to "General".

## Expected Behavior
Either `general` is a real section with a nav entry, or `/settings` redirects to the first
real section and the dead placeholders are removed.

## Observed Behavior
An orphan default section plus two entirely unreachable placeholder entries.

## Context / Relevant Code
- `app/src/features/settings/pages/Settings.tsx:16-22,24-40,44,82-103`
- `app/src/routes/registry.ts` — route `settings`, path `/settings/:section?`

## Notes
Which section `/settings` should land on is a product decision. Related: the incoming
design work hides the `appearance` entry from the nav while leaving it routable, so the
"nav entries and reachable sections are not the same set" problem is about to get one case
larger — deliberately, in that instance.
