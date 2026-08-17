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
the user approved, and that *evolves* across refinement cycles instead of
being re-distilled from scratch each time.

## Problem

Distillation today is a single generation from source documents plus the
sample output. Two consequences:

- **No verification.** Nothing checks that the distilled lens, applied to the
  same context, reproduces the approved text. The lens is a guess, and the
  first regeneration is where the user discovers how good a guess it was.
- **Amnesia across refinements.** Each refinement re-distills from scratch;
  the previous lens's accumulated style and structure nuances are lost every
  cycle, even when the user's change was small.

## Requirements

### 1. Evolution, not re-distillation
Distillation takes four inputs, not two:
- the **previous lens** (the baseline being evolved, when one exists),
- the **source context**,
- the **approved sample output** (ground truth),
- the **refinement intent** — what the user asked for during the chat, so the
  "why" behind the delta informs the instruction, not just the "what".

A first-ever lens bootstraps from intent + source + target; every later one
evolves its parent.

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
- **Bounded context**: each iteration sees only the current state — source,
  target, latest attempt, latest lens, and a running critique log — never the
  full history of failed attempts.
- **Iteration budget**: a hard cap on loop cycles. On reaching it without
  convergence, the best candidate so far is kept and the miss is recorded.

### 4. Determinism (temperature 0)
Both legs of the loop — applying the lens and distilling/critiquing — run at
`temperature: 0`. Without it convergence is meaningless: the same lens gives
different output on every run, and the loop chases sampling noise instead of
instruction defects. This also makes the shipped lens's behavior at
regeneration time match what the loop verified. Depends on the per-role
parameter policy in the LLM gateway wish.

### 5. Background execution
The loop is expensive — each iteration is two generations, so convergence can
take minutes, especially on local models. It runs entirely on the existing
background distillation path at background priority in the LLM queue:
approval never waits on it, the previous lens stays active until the new one
lands, and interactive work preempts it per queue policy.

### 6. Auditability
Each lens records its lineage (parent lens, originating refinement) plus the
loop outcome: iterations used and whether it converged. A lens that shipped
un-converged is identifiable after the fact.

## Acceptance Criteria
- [ ] Refining an existing lens feeds the previous lens and the refinement intent into distillation; nuances from earlier cycles survive a small edit.
- [ ] Distillation verifies the lens by applying it and comparing against the approved output, iterating with an explicit critique step until convergence or budget.
- [ ] Lenses never contain facts or verbatim text from the target output.
- [ ] Apply and distill both run at temperature 0.
- [ ] The loop runs in the background at background priority; approval latency is unaffected and the previous lens remains active until replacement.
- [ ] Lens records show iteration count and convergence outcome.
