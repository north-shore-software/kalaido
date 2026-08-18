---
title: "shadow-section on the chamfered auto-segment button renders nothing"
status: "open"
author: "agent"
created: "2026-08-17"
---

## Description
`app/src/components/kalaido/context-picker/resolution-readout.tsx` puts
`shadow-section` (previously `shadow-cyan` — still a `box-shadow`) on the
"Auto-segment my scope" button, which also has `clip-chamfer`
(a `clip-path`). `clip-path` clips the element's entire rendering, box-shadow
included, so the shadow draws nothing. DESIGN.md §5 documents this exact
failure mode — it is why the magenta primary-button shadow is a
`drop-shadow` filter instead.

## Steps to Reproduce
1. Open the context picker and reach the "Auto-segment my scope" button.
2. Inspect the button: `shadow-section` is applied but no shadow is visible.

## Expected Behavior
Either a visible chamfered shadow (a `drop-shadow` filter tinted by
`--section`) or no shadow class at all.

## Observed Behavior
The `shadow-section` class is dead weight; nothing renders.

## Context / Relevant Code
- `app/src/components/kalaido/context-picker/resolution-readout.tsx` ("Auto-segment my scope")
- DESIGN.md §5 "Shadows" explains the mechanism.
- Note: this button is also the app's third chamfered element and sits inside a
  dialog; de-chamfering it is step 09 of `.agents/plans/design-sync/`.
