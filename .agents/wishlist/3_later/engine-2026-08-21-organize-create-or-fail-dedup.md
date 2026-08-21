---
title: "Organize: create-or-fail dedup against existing and in-flight entities"
status: "idea"
author: "human"
created: "2026-08-21"
---

## Summary
Mechanically prevent two parallel organize explorations from surfacing the same story as
two projections/reflections. Today dedup is semantic and advisory: each exploration calls
`list_existing` (persisted entities plus this run's in-flight fork briefs and created
entities) and is asked to drop stories already covered. Nothing enforces it at create time.

## Motivation / Use Case
Organize forks run concurrently and a fork is free to read any part of the map, so two
siblings can independently sketch the same story, both call `list_existing` before either
has created anything, and both create it. `list_existing` already shows in-progress fork
briefs, which narrows the window, but a brief is not a commitment to create a specific
entity, and the race between "I looked" and "I created" is still open.

## Proposed Concept
Two candidate shapes, pick by observed duplicate rate:
1. **Lookup as claim.** Treat an exploration's lookup/queued brief as a claim on that
   story: once one exploration has registered intent to create "X", a later `create_*`
   from a different exploration whose story matches X is refused.
2. **Create-or-fail with a small LLM check.** `create_projection`/`create_reflection`
   runs a cheap, dedicated LLM call comparing the requested name+brief+nodes against
   existing entities and queued/in-flight claims (the same list `list_existing` renders)
   and fails the tool call with "overlaps too much with <entity>" when the match is heavy.
   The exploration reads the error and moves on, as it already does for other rejections.

Either way the check lives in `internal/organize/tools.go`'s `dispatchCreate`, reading
`runRegistry` (`budget.go`) and the persisted `projection`/`reflection` rows, and the
prompt text lives in `internal/prompts/organize.go`.

## Open Questions
- How often do duplicates actually happen with in-flight briefs visible? Measure on real
  runs before adding an LLM call to every create.
- Option 2 adds latency on the critical path of every create; is the model-judged
  overlap worth it versus a purely mechanical claim (option 1) that can't see semantic
  near-duplicates?
- Should a refused create be allowed to *attach* to the existing entity instead (e.g. add
  nodes/colours to it), given the additive-only ruling?
