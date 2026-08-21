---
title: "Map journal: append entries and defrag retrospectively"
status: "idea"
author: "human"
created: "2026-08-21"
---

## Summary
An alternative maintenance strategy for the map's `journal` (the time-ordered,
reporter-voice entries the incorporate pass writes alongside the node tree). Today the
prompt asks the model to **edit entries in place** when new material continues a story
that already has an entry. The alternative is to let each incorporation pass **append**
its own entries freely and run a trailing **defrag/merge** step that folds adjacent or
overlapping entries about the same story into one — the same shape as the tree's
fold-thin-nodes-back-into-parent cleanup.

## Motivation / Use Case
In-place editing relies on the model recognising, inside one incorporate call, that new
material belongs to an existing entry and rewriting it rather than adding a near-duplicate.
If real runs show the journal fragmenting (several partial accounts of one story across
neighbouring periods, or late-arriving material spawning a second entry for a period that
already has one), a retrospective merge is the mechanical fix that doesn't depend on the
model getting it right in the moment.

## Proposed Concept
- Incorporate pass appends entries for the periods each chunk spans without worrying
  about duplicates.
- A separate, cheap pass (could run at the end of a `map_run`, or on its own signal)
  walks the journal in `from` order and merges entries whose periods overlap or abut and
  whose stories are the same narrative, rewriting them into one entry — analogous to
  node expiry/fold-back in `internal/prompts/mapping.go`.
- Possibly the same pass re-grains the journal (coarsening quiet stretches, splitting
  dense ones) once the whole time span is known.

## Open Questions
- Is this needed at all? Narratives are intrinsically linear in time, so in-place editing
  may be sufficient — decide from real maps, not in advance.
- Merge as an LLM call over the journal only (small, cheap) or folded into the next
  incorporate call's instructions?
- Interaction with organize: a defrag that rewrites entries under a running organize
  exploration would change the ground it's reading; run only between organize runs.
