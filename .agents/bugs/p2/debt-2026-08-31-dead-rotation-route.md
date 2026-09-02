---
title: "Dead /rotation route left behind after nav removal"
status: "open"
author: "agent"
created: "2026-08-31"
---

## Description
`src/features/rotation/pages/Rotation.tsx` is still registered in the router (`src/routes/registry.ts`) but is unreachable from any UI. The "Rotation" entry was removed from the left nav (`src/components/layout/nav-sidebar.tsx`), and the dashboard (`src/features/dashboard/pages/Main.tsx`) reimplements the same freshness/needs-action view inline via `NeedsActionSection`/`NeedsRow` rather than linking out to `/rotation`. `Rotation.transitions.ts` only defines an outgoing transition (`tweakCandidate` → `projection-review`); nothing transitions into the route anymore.

## Steps to Reproduce
1. Search the app for any `RouteLink`/`go(...)` call targeting the rotation route or its transitions.
2. Note there are none outside the route's own definition.

## Expected Behavior
Either the route is intentionally kept as a still-reachable deep link (in which case something should link to it), or it's dead code that should be removed along with its page/transitions files.

## Observed Behavior
The route, page component, and transition file all still exist and are exported/registered, but nothing in the app currently navigates to them.
