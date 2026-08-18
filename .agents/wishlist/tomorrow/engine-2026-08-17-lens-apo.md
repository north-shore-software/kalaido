---
title: "Lens distillation via automatic prompt optimization"
status: "specified"
author: "human"
created: "2026-08-17"
updated: "2026-08-17"
---

## Summary

Turn lens distillation from a one-shot best guess into an optimization loop:
the snapshot the user just approved is the ground truth, and the lens is
refined — execute, critique, rewrite — until applying it to the same context
actually reproduces that output. The result is a lens that provably does what
the user approved. Continuity across refinement cycles comes from the target
itself and the accumulated refinement conversations — never from feeding the
previous lens back in.

## Problem

Distillation today is a single generation from source documents plus the
sample output. Two consequences:

- **No verification.** Nothing checks that the distilled lens, applied to the
  same context, reproduces the approved text. The lens is a guess, and the
  first regeneration is where the user discovers how good a guess it was.
- **Amnesia across refinements.** Each refinement distills from source +
  sample alone; everything the user ever *said* about how the output should
  look — across every refinement conversation — never reaches distillation.

## Requirements

### 1. Inputs — the previous lens is never one of them
Distillation takes three inputs:
- the **source context**,
- the **approved sample output** (ground truth),
- the **refinement conversations** — the current one and all previous ones
  (marked historical), so the "why" behind every delta informs the
  instruction, not just the "what".

Previous lenses and previous approved snapshots are deliberately excluded:
both are artifacts derived from exactly these inputs, and the approved target
already embodies every nuance earlier cycles established. Feeding the old
lens back in adds nothing the target doesn't carry, and risks anchoring the
rewrite on stale rules the user's latest edits implicitly retired.
`parent_lens_id` remains as audit lineage only. A first-ever creation is the
degenerate case with no historical conversations — the loop is otherwise
identical in every cycle.

### 2. The optimization loop
- **Execute**: apply the candidate lens to the source context.
- **Critique**: compare the result against the approved output and state
  specifically where it diverged (structure, tone, inclusion/omission). The
  critique is an explicit step that precedes any rewrite — "try again"
  without a stated diagnosis is not permitted (it oscillates).
- **Rewrite**: revise the lens to fix the named failures, or declare
  convergence when the outputs match structurally and stylistically.
- Repeat until converged or the iteration budget is reached.

### 3. Guardrails
- **Data-agnostic lenses**: a lens contains structural, stylistic, and
  logical rules only — never facts or text copied from the target output.
  (The degenerate "output the following text: …" lens is the loop's natural
  failure mode and must be explicitly forbidden.)
- **Append-everything optimizer transcript**: the loop is one growing
  conversation — every failed attempt and its critique stays visible, so the
  optimizer never repeats a lens that already failed. The iteration budget is
  what bounds total context size. (Each *execution* is the opposite: a
  stateless production-identical apply call that sees only the lens and the
  sources, never the loop conversation.)
- **Iteration budget**: a hard cap on loop cycles. On reaching it without
  convergence, the best candidate so far is kept and the miss is recorded.

### 4. Determinism (temperature 0)
Both legs of the loop — applying the lens and distilling/critiquing — run at
`temperature: 0`. Without it convergence is meaningless: the same lens gives
different output on every run, and the loop chases sampling noise instead of
instruction defects. This also makes the shipped lens's behavior at
regeneration time match what the loop verified. Depends on the per-role
parameter policy in the LLM gateway wish.

**Same model, hard rule**: distillation runs on the same model as snapshot
generation — encoded structurally (the distill role resolves to the snapshot
role's model), so no configuration can split them. Optimizing a lens against
one model and executing it on another would verify the wrong thing.

### 5. Background execution
The loop is expensive — each iteration is two generations, so convergence can
take minutes, especially on local models. It runs at background priority in
the LLM queue, and the worker follows the speculative-wave shape (no payload
queue): a commit marks its snapshot durably and fires a coalescing signal;
each pass re-derives its worklist from DB state, so unfinished distillations
resume after a restart and a newer commit supersedes an abandoned target.
Approval never waits on it, the previous lens stays active until the new one
lands, and interactive work preempts it per queue policy.

### 6. Auditability
Each lens records its lineage (parent lens, originating refinement) plus the
loop outcome: iterations used and whether it converged. A lens that shipped
un-converged is identifiable after the fact.

## Acceptance Criteria
- [ ] Distillation sees the source context, the approved target, and all refinement conversations — never a previous lens; nuances from earlier cycles survive a small edit because the target and the conversation history carry them.
- [ ] Distillation verifies the lens by applying it and comparing against the approved output, iterating with an explicit critique step until convergence or budget.
- [ ] Lenses never contain facts or verbatim text from the target output.
- [ ] Apply and distill both run at temperature 0.
- [ ] The loop runs in the background at background priority; approval latency is unaffected and the previous lens remains active until replacement.
- [ ] Lens records show iteration count and convergence outcome.
