---
title: "Auto-approve additive-only deltas"
status: "idea"
author: "human"
created: "2026-08-17"
---

## Summary

Extend reconcile auto-approval (`today/engine-2026-08-17-one-click-reconcile.md`)
with a second, size-independent criterion: auto-approve a wave candidate when
its delta is **additive only** — everything the user previously approved is
still there, unchanged, and the candidate only adds.

## Motivation / Use Case

The threshold policy measures *how much* changed; this measures *what kind* of
change it is. A summary that gains a new bullet because new fragments arrived
is the archetypal rubber-stamp, even when the addition is large enough to blow
past a 5% threshold. Additions are low-risk in a way edits are not: nothing
the user signed off on disappears or shifts meaning.

## Proposed Concept

- A candidate qualifies when the live snapshot's content is preserved and the
  candidate only appends/inserts new material.
- **Fast path, pure diff**: zero removed lines in the line diff ⇒ additive.
  Cheap, deterministic, no model call.
- **LLM filter for the rest**: the pure diff is brittle — a reworded sentence,
  reflowed markdown, or a renumbered list shows as removed+added lines without
  being a semantic removal. A cheap YES/NO judge (same shape as the colour
  evaluator: strict reply contract, background priority in the wave) asks
  whether all prior content survives with only additions.
- Composes with the threshold as OR: auto-approve if `diff ≤ threshold` **or**
  delta is additive-only.

## Open Questions

- Does "preserved but reworded, plus additions" count as additive? The pure
  diff says no, an LLM judge could say yes — which also makes this criterion
  partially useful *before* temp-0 lands, unlike the threshold.
- Textually additive but semantically transformative additions (an appended
  paragraph that contradicts or reframes what's above): does the judge need to
  check for this, or is "the user's approved text is intact" the whole bar?
- Cost: one extra LLM call per non-fast-path candidate per wave — acceptable
  on local models?
- Is the recorded audit value ("auto-approved: additive") distinct from the
  diff-ratio marker in the timeline?
