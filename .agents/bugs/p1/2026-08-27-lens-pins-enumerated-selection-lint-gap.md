---
title: "Distilled lens pins enumerated selection (not a count) — derived projection never absorbs new material; lint doesn't cover it"
status: "open"
author: "agent"
created: "2026-08-27"
---

## Description

Sibling of `2026-08-27-distilled-lens-hardcodes-item-count-drops-content.md` (resolved).
That bug pinned the *number* of items; this one pins the *identity* of the items — the
"no enumerated titles" half of the same `DistillGenSystem` hard rule — and the mechanical
lint (`lensCountPin`) deliberately only matches count phrasings, so it cannot catch this.

Observed 2026-08-26 ~20:54 (post-lint build, but with a lens distilled before it):

- Derived projection `597z8x1z37by7bp` ("Target Markets (Non-Technical Segments)",
  context = `sourceProjectionIds: [op0mt2924wexrbh]`, lens `2m24605jdqh5nud`).
- Upstream "Use Cases" projection refreshed and was approved with three non-technical
  personas absent from the derived output: Barry (waste collection), John (beer sales),
  Geraldine (Airbnb / hospitality).
- The cascade fired correctly: candidate `04e484mz88zp3v3` regenerated with
  `resolved_context = {"snapshotIds":["74x61891n2v3f61"]}` — the brand-new upstream
  snapshot containing all three.
- The candidate output is still exactly the same three segments (Consulting, Academic
  Research, Personal Wellness). No hospitality segment, nothing for Barry or John. The
  applying model had the material and declined to add a section — the signature of a
  lens that names its sections rather than stating a selection rule.

## Repro / confirmation

Inspect `lens/2m24605jdqh5nud` `prompt` in the dashboard: expect the three segment titles
(or near-verbatim descriptions of them) baked in. Immediate remedy is the same as the
count-pin bug: re-refine + approve the projection so a fresh distillation (with the
current prompts) replaces the lens.

## Fix direction (not planned yet)

A mechanical lint can't recognize enumerated *titles* the way it recognizes counts —
titles are just prose. Options: strengthen the generator negative example to cover
enumerated section titles explicitly; or the perturbed-source critic pass already noted
in the count-pin bug's resolution (execute the candidate against a source set with one
item added and check the output grows) — that catches every pinning variant, count or
enumeration, in one mechanism.
