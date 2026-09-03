---
title: "`ContextSpec.summaries` may only apply to wholeScope fragments — name it accordingly"
status: "open"
author: "human"
created: "2026-09-03"
---

## Description

`api.ContextSpec` (§ 1 of the context doc) has a `summaries` field, documented as "Render mode flag (§ 4). Does not affect which ids resolve."

Note left on `kalaidoscope/docs/context.md`:

> this only ever affects the fragments pulled in by "wholeScope", right? should we name it appropriately if so?

## Context / Relevant Code

- Doc: `kalaidoscope/docs/context.md` § 1 (the spec), § 2 (resolution), § 4 (hydration / render modes).
- The relevant mechanic in § 2: under `wholeScope`, `expandedIds` = the pinned fragments that are also in the whole-scope set; otherwise `expandedIds` is a copy of the pinned list, "recorded even though full mode ignores it, so a later switch to summaries keeps the pins in full". § 4 then renders a fragment in full when the final mode is full **or** the id is in the final `expandedIds`, and as a summaries row otherwise.
- The spec is stored on `projection.current_context_spec` / `reflection.current_context_spec`, `lens.context_spec`, `*_snapshot.context_spec`, and as a `context_spec` chat part — so a rename has wire and stored-JSON consequences.
