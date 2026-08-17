---
title: "An empty context selection silently resolves to the whole scope, so \"include nothing\" is unexpressible"
status: "open"
author: "agent"
created: "2026-08-16"
---

## Summary
`itemsToSpec([])` returns `{ wholeScope: true }`. A user who narrows their context
to a filter and then removes the last criterion gets *everything* rather than
nothing, with no indication that the meaning inverted.

## Description
The rule lives in `app/src/api/kalaidoscope/chat.ts`:

```ts
// "Nothing selected" means the whole kalaidoscope.
if (items.length === 0) spec.wholeScope = true;
```

It made sense while "everything" had no other way to be stated. The context
selector now emits an explicit `WholeScope` marker item (added 2026-08-16 so that
whole scope *plus* source compositions could be expressed at all — see
`selection.ts`), so "everything" is now said out loud and the inference is no
longer load-bearing.

With the inference still in place there are two live consequences:

1. In the funnel's **Only…** mode with no criteria, the UI says "Nothing included
   — this resolves to nothing" while the spec actually sent resolves to the whole
   kalaidoscope. The copy and the behaviour disagree.
2. `ContextSpec`'s own docs say "An empty spec (`{}`) is meaningful: it clears all
   previously pinned context" — which is a third meaning for roughly the same
   input, and not obviously the same as "whole scope".

## Steps to Reproduce
1. Open a context selector and switch stage 01 to **Only…**.
2. Add a criterion, then remove it.
3. Inspect the emitted `ContextSpec`.

## Expected Behavior
An empty selection resolves to an empty fragment set. "Everything" is stated with
the `WholeScope` marker, which the picker already emits by default.

## Observed Behavior
The empty selection resolves to the whole kalaidoscope.

## Context / Relevant Code
- `app/src/api/kalaidoscope/chat.ts` — `itemsToSpec`
- `app/src/api/kalaidoscope/context-spec.test.ts` — "an empty selection is still
  whole scope" pins the current behaviour and would need to change with it
- `app/src/components/kalaido/context-picker/selection.ts` — emits the marker

## Notes
Left alone during the funnel build because flipping it changes how every already
saved spec is interpreted, and any entity whose stored spec is empty would change
meaning on next resolve. Wants a deliberate migration, not an in-flight edit.
