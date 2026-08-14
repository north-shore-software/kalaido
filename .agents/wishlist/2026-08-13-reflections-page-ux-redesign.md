---
title: "Redesign Reflections Page UX & Layout"
status: "idea"
author: "human"
created: "2026-08-13"
---

## Summary
Rethink and simplify the Reflections page layout and navigation structure. Move away from the complex 3-pane layout towards a clearer mental model, such as nesting timed snapshots under reflection sub-entries in the navigation sidebar.

## Motivation / Use Case
The current 3-pane Reflections interface (navigation sidebar, main content / refine panel, right-hand timeline and refresh panel) can be confusing and cluttered. Users need a simpler, more intuitive way to browse time-series reflection snapshots, inspect past windows, and refine summary configurations without being overwhelmed by multiple competing side panels.

## Proposed Concept
1. **Nested Navigation Hierarchy**:
   - Reorganize the left navigation sidebar into an expandable tree/accordion where selecting a Reflection reveals its historical timed snapshots as sub-items.
2. **Simplified Main Content Stage**:
   - Default to a clean, focused single-pane reading view for the selected reflection/snapshot.
3. **Dedicated Refine / Edit Mode**:
   - Move refinement controls (chat, context picker, schedule adjustment) into an explicit toggleable mode, drawer, or modal rather than keeping a 3rd panel visible permanently.
4. **UX Review & Iteration**:
   - Involve UX design to map core user workflows (reading latest summary, auditing past window snapshots, tuning refinement prompts) and refine panel placement.

## Open Questions
- How should live/current snapshots be distinguished from historical window snapshots in the left sidebar tree?
- Should refinement happen in a dedicated full-stage view, a slide-out drawer, or a toggled side panel?
- How does schedule configuration (frequency, lookback window) fit into the navigation hierarchy or settings view?
