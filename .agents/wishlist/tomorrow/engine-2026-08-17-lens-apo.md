---
title: "Lens distillation via automatic prompt optimization"
status: "specified"
author: "human"
created: "2026-08-17"
updated: "2026-08-18"
---

## Summary

Turn lens distillation from a one-shot best guess into an optimization loop:
the snapshot the user just approved is the ground truth, and the lens is
refined — generate, execute, critique, rewrite — until applying it reproduces
that output. Crucially, the ground truth is **isolated from the lens writer**:
the generator only ever sees the user's intent (refinement conversations with
source-context changes inline) and the critic's feedback, while a separate
critic thread is the sole holder of the target. Continuity across refinement
cycles comes from the accumulated conversations and the critic's judgment —
never from feeding the previous lens back in.

Motivating incident: the first (non-isolated) implementation converged on a
lens that hardcoded "exactly 11 ideas" and enumerated all eleven target titles
verbatim — a perfect reproduction of the approved snapshot that silently
dropped the next fragment added (PENGUINFRIENDS). When the optimizer holds the
target, memorizing it is the shortest path to convergence; no prompt rule
prevents that. Isolation makes it impossible instead of forbidden.

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

### 1. Inputs — target isolation, previous lens never an input
Three threads with strictly separated knowledge:
- the **generator** writes candidate lenses. It sees the **intent timeline**:
  every refinement conversation (the current one and all previous, marked
  historical), reconstituted with **source-context changes shown inline** at
  the point where they happened — chat remarks only make sense against the
  sources as they stood when they were said — ending at the sources the lens
  will be applied to. It never sees the approved output.
- the **execute** leg applies each candidate exactly as production will:
  stateless, lens + current sources only.
- the **critic** is the only holder of the **approved sample output** (ground
  truth). It grades each executed candidate and its diagnosis — generalizable
  rules about structure/format/style/coverage, never target content — is
  relayed to the generator. A mechanical tripwire (long verbatim run shared
  between a candidate lens and the target) catches a leaking critic.

Previous lenses and previous approved snapshots are deliberately excluded:
both are artifacts derived from exactly these inputs, and the approved target
already embodies every nuance earlier cycles established. Feeding the old
lens back in adds nothing the target doesn't carry, and risks anchoring the
rewrite on stale rules the user's latest edits implicitly retired.
`parent_lens_id` remains as audit lineage only. A first-ever creation is the
degenerate case with no historical conversations — the loop is otherwise
identical in every cycle.

### 2. The optimization loop
- **Generate**: the generator writes a candidate lens from the intent
  timeline (plus, after the first round, the critic's feedback).
- **Execute**: apply the candidate lens to the source context. Byte-equality
  with the target converges immediately (a code check — comparing does not
  reveal the target to the generator).
- **Critique**: the critic compares the result against the approved output
  and states where it diverged as generalizable rules. The diagnosis is an
  explicit step that precedes any rewrite — "try again" without a stated
  diagnosis is not permitted (it oscillates).
- **Rewrite**: the diagnosis is relayed to the generator, which revises the
  lens; the critic alone declares convergence.
- Repeat until converged or the iteration budget is reached.

### 3. Guardrails
- **Data-agnostic lenses**: a lens contains structural, stylistic, and
  logical rules only — never facts, pinned item counts, or enumerated titles.
  The degenerate "output the following text: …" lens is the loop's natural
  failure mode; target isolation makes it structurally impossible, and the
  prompt rules remain as defense in depth.
- **Append-everything transcripts**: generator and critic are each one
  growing conversation — every failed attempt and its critique stays visible,
  so the loop never repeats a lens that already failed. The iteration budget
  bounds total context size. (Each *execution* is the opposite: a stateless
  production-identical apply call that sees only the lens and the sources,
  never either conversation.)
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
The loop is expensive — each iteration is up to three generations (lens,
apply, critique), so convergence can take minutes, especially on local models.
It runs at background priority in the LLM queue, and the worker follows the
speculative-wave shape (no payload queue): a commit marks its snapshot durably
and fires a coalescing signal; each pass re-derives its worklist from DB
state, so work interrupted by a shutdown is picked up by whichever future pass
runs next and a newer commit supersedes an abandoned target.
Approval never waits on it, the previous lens stays active until the new one
lands, and interactive work preempts it per queue policy.

### 6. Auditability
Each lens records its lineage (parent lens, originating refinement) plus the
loop outcome: iterations used and whether it converged. A lens that shipped
un-converged is identifiable after the fact.

## Acceptance Criteria
- [ ] The lens generator sees the intent timeline (all refinement conversations with source-context changes inline) — never the approved target and never a previous lens; only the critic holds the target.
- [ ] A regeneration after new source data is added incorporates the new data (the PENGUINFRIENDS test): shipped lenses contain no pinned counts or enumerated content.
- [ ] Distillation verifies the lens by applying it and comparing against the approved output, iterating with an explicit critique step until convergence or budget.
- [ ] Lenses never contain facts or verbatim text from the target output.
- [ ] Apply and distill both run at temperature 0.
- [ ] The loop runs in the background at background priority; approval latency is unaffected and the previous lens remains active until replacement.
- [ ] Lens records show iteration count and convergence outcome.
