---
title: "refine-reflection route falls through to the onboarding section accent"
status: "open"
author: "agent"
created: "2026-09-17"
---

## Description
`sectionForRoute` in `app/src/routes/registry.ts` maps `reflections` and `new-reflection` to the `reflections` section, but `refine-reflection` is not listed, so it hits the `default` branch and is styled as `onboarding`.

## Steps to Reproduce
1. Open a kalaidoscope and go to Reflections.
2. Open a reflection and click Refine (`/reflections/:id/refine`).
3. Look at the section accent (selection colour, focus rings, sidebar highlight).

## Expected Behavior
The refine screen wears the reflections hue (violet), like the reflections list and `/reflections/new`.

## Observed Behavior
The refine screen wears the onboarding accent.
