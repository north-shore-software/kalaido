---
title: "Map annotate sends the entire fragment plus the entire map document per call with no size cap"
status: "open"
author: "agent"
created: "2026-10-07"
---

## Description
`annotateOne` in `kalaidoscope/internal/mapping/annotate.go` builds one prompt per fragment from `FragmentBlock(... frag.content)` and `AnnotatePrompt(d.doc, block)`, where `d.doc` is the whole current map document. Nothing truncates or chunks the fragment, and a reply that fails to parse is retried with the full conversation appended plus a nudge, doubling that fragment's cost. Consolidate then runs over everything again. Token spend therefore scales with raw import size with no ceiling: 27 imported conversation exports totalling ~7 MB of text consumed roughly 2M tokens in a single map run.

## Steps to Reproduce
1. Import a handful of large text files (hundreds of KB each).
2. Run the map.
3. Compare usage before and after.

## Expected Behavior
A per-call size budget for annotate (truncate, chunk, or summarise oversize fragments), and the map document contribution bounded so cost does not grow with both the import and the map together. At minimum, a per-call usage log line so the spend is attributable.

## Observed Behavior
One map over a large import exhausts the workspace's LLM budget. The Gemini provider only logs usage on abnormal completions, so there is no per-call breakdown to inspect afterwards.
