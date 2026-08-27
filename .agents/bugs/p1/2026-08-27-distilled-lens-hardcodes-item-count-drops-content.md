---
title: "Distilled lens hardcodes the exemplar's item count, silently dropping content on refresh"
status: "resolved"
author: "agent"
created: "2026-08-27"
---

## Description

Lens distillation can bake the approved exemplar's *item count* into the lens prompt, even
though `DistillGenSystem` explicitly forbids it (`internal/prompts/distill.go:28`: "no fixed
item counts, no enumerated titles, no fixed orderings"). When new in-scope fragments later add
an item, the applying model obeys the hardcoded count and **swaps existing content out** to
make room — a silent deletion of previously approved material in the refreshed candidate.

Observed 2026-08-26 evening (fresh workspace, post-stabilization build — the claim-row
lifecycle itself behaved correctly throughout):

- Projection "High Level Kalaido Use Cases" was committed with 8 sections. The distilled lens
  (`lens/i56y0ppz267388n`) contains: *"Ensure all distinct use cases (8 in total) are
  captured"* plus sequentially numbered section headings.
- A new fragment introduced a 9th use case (Barry / bear tracking). On Refresh, the candidate
  kept sections 1–7 and **replaced** "### 8. Driving Team Alignment" with the new
  bear-tracking section — Team Alignment vanished from the document with no signal to the
  user beyond the diff view.
- Contrast: the sibling projection "User Personas List" distilled cleanly ("Include strictly
  and only the persona profiles defined in the source material", no count) and correctly
  *appended* Barry as a 6th bullet on refresh.

## Why the critic loop can't catch it

The target-isolated critic (`DistillCriticSystem`) only sees candidate *outputs*, never the
lens text. A hardcoded count that matches the current sources produces output identical to
the target, so the candidate passes review. The defect only manifests later, when the source
set grows — exactly when nobody is reviewing the lens. Both lenses in this session ran
`iterations=4, converged=false` (candidate budget exhausted), so the accepted lens was
best-effort, not converged.

## Repro

1. Refine a projection whose output is a numbered list of N items; commit.
2. Inspect the stored `lens.prompt` — if it names N ("N in total", "exactly N", etc.), the
   bug is armed.
3. Ingest a fragment that adds an (N+1)th item in scope; Refresh the projection.
4. The candidate holds N sections: one prior item is dropped/replaced rather than appended.

## Resolution (2026-08-27)

Three layers, all landed:

- **Generator prompt**: `DistillGenSystem` carries a negative example of exactly this failure
  ("(8 in total)" → silent drop) inline in the hard rule (`internal/prompts/distill.go`).
- **Mechanical lint**: `lensCountPin` (`internal/engine/lens.go`, beside the verbatim-leak
  tripwire) matches totality phrasings — "N in total", "total of N", "N total", "all N",
  digits or spelled numbers. `distillLensLoop` runs it on every candidate before execution;
  on a hit it replies in the same generator conversation (`prompts.DistillGenCountFeedback`,
  quoting the offending phrase) and skips the execute+critique leg. If the *final* candidate
  still pins a count it is executed and scored anyway — shipping a lens that works against
  today's sources beats failing distillation outright. Per-item structural counts ("exactly
  two bullet points under each section") are deliberately not flagged; they are legitimate
  formatting rules and flagging them would burn the candidate budget on correct lenses.
- **Critic prompt**: `DistillCriticSystem` now requires coverage feedback to be phrased as
  selection rules, never as a number of items — closing the channel by which the critic
  could steer the generator back into pinning.

Covered by `internal/engine/lens_lint_test.go`: a `lensCountPin` table test plus a scripted
loop test asserting the pinned candidate is never executed/critiqued and the rewrite ships.

Possible future hardening (not planned): a critic pass that executes the candidate lens
against a perturbed source set (one item added/removed) and checks the output adapts —
directly testing the "must keep working when the source documents later change" contract.

## Collateral note

The same refresh also dropped a trailing clause in section 7 ("maintaining full local
privacy") — ordinary regeneration drift through a lens that doesn't pin phrasing, largely
contained by the minimal-diff rewrite. Not worth tracking separately; noted here for
completeness of the observed diff.
