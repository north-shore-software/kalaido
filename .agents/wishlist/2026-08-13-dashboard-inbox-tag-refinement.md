---
title: "Dashboard Inbox Section for Fragment Tagging & Refinement"
status: "idea"
author: "human"
created: "2026-08-13"
---

## Summary
Add an "Inbox" section on the main Dashboard—expanding on the current "Recent Fragments" sidebar—that displays auto-assigned tags (colours, categories, types) on newly ingested fragments and allows users to review and refine those tags inline.

## Motivation / Use Case
When fragments enter the system, background processes automatically assign metadata such as colour swatches and fragment classifications. Users currently lack a dedicated triage workflow to verify or adjust these tags. An Inbox section gives users confidence in data classification and provides an intuitive space to tune tags before fragments influence downstream reflections and projections.

## Proposed Concept
1. **Dashboard Inbox Stream**:
   - Transform "Recent Fragments" into an interactive Inbox section surfacing recently ingested items.
2. **Explicit Tag Visualization**:
   - Display assigned tags, colour swatches, and classification metadata clearly on each fragment item.
3. **Inline Refinement Controls**:
   - Allow users to easily click to toggle colour swatches, reclassify fragment types, or edit tags directly from the Dashboard.
4. **Triage / Processing Workflow**:
   - Provide a quick "Mark as Reviewed" action so users can process items through their inbox.

## Open Questions
- Does re-tagging a fragment automatically mark downstream syntheses (projections/reflections) as stale and queued for refresh?
- Should reviewed fragments disappear from the Inbox view or be toggleable via a "Unreviewed / All" filter?
- Can user tag adjustments be fed back into classifier prompts or models to improve future automated tagging?
