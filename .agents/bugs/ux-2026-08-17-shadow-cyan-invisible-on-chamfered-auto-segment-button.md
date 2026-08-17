---
title: "shadow-cyan on the chamfered auto-segment button renders nothing"
status: "open"
author: "agent"
created: "2026-08-17"
---

## Description
`app/src/components/kalaido/context-picker/resolution-readout.tsx:207` puts
`shadow-cyan` (a `box-shadow`) on an element that also has `clip-chamfer`
(a `clip-path`). `clip-path` clips the element's entire rendering, box-shadow
included, so the shadow draws nothing. DESIGN.md §5 documents this exact
failure mode — it is why the magenta primary-button shadow is a
`drop-shadow` filter instead.

## Steps to Reproduce
1. Open the context picker and reach the "Auto-segment my scope" button.
2. Inspect the button: `shadow-cyan` is applied but no shadow is visible.

## Expected Behavior
Either a visible chamfered shadow (via `drop-shadow`, e.g.
`drop-shadow-[4px_4px_0_rgb(34_211_238/0.28)]`) or no shadow class at all.

## Observed Behavior
The `shadow-cyan` class is dead weight; nothing renders.

## Context / Relevant Code
- `app/src/components/kalaido/context-picker/resolution-readout.tsx:207`
- DESIGN.md §5 "Shadows" explains the mechanism.
- Note: this button is also the app's third chamfered element and sits inside a
  dialog; whether it should be chamfered/shadowed at all is a separate design
  ruling (diff S4 in the DESIGN.md↔code reconciliation).
