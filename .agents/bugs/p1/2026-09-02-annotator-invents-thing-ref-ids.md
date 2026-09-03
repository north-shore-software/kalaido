---
title: "Annotator emits {\"ref\": id} with invented ids; the citation is silently dropped"
status: "open"
author: "agent"
created: "2026-09-02"
---

## Description
The annotate prompt asks for `{"ref": id}` only for things already on the map list, and `{"name", "kind", "note"}` for anything else. In a fresh-ingest run the model sometimes fabricated ids in the ref form for things that were not listed (e.g. `t_garysguide`, `t_louis`, `t_villagers`, `t_cofounderslab`), mostly on rows annotated while the map was still empty (`grounded_count = 0`), and also wrote the same fake ids into the summary's markdown links.

`ParseAnnotateReply` accepts any non-empty `ref`, and `IndexRows` / `consolidate` resolve it with `ResolveRef`, which tries the id then the name. A made-up id matches neither, so the citation is dropped: the fragment does not propose the thing, does not count towards it once it exists, and is not indexed under it for colours or discover. The thing just loses evidence with no signal anywhere.

## Steps to Reproduce
1. Ingest a corpus into an empty workspace so the first annotate batch runs against a map with no things.
2. Inspect `fragment_annotation.things` for rows with `grounded_count = 0`.
3. Some rows carry `{"ref":"t_<slug>"}` entries whose id is not in `kalaidoscope_map.body`.

## Expected Behavior
A ref that does not resolve against the map the fragment was annotated with should not be silently discarded. Either the prompt should forbid the ref form when the list is empty and the parser should reject refs not in the shown list (retry with the JSON nudge), or `annotateOne` should downgrade an unknown ref to a name proposal so the mention survives.

## Observed Behavior
Rows such as a newsletter summary rendered as `[GarysGuide](t_garysguide)` were stored with unresolvable refs. Those fragments never contribute to the newsletter thing, so its fragment count, first/last seen, exemplars, and rhythm evidence are all undercounted.
