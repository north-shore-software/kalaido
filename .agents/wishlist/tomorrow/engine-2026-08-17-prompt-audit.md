---
title: "Prompt audit and content standard"
status: "specified"
author: "human"
created: "2026-08-17"
updated: "2026-08-17"
---

## Summary

Audit every prompt in the codebase into one canonical, reviewable home, and
hold each one to a content standard: a prompt must tell the model what app it
is working inside, what data it has been given and what kind, what is the
primary focus versus background reference, and exactly how to reply.

## Why prompts deserve a spec

Kalaido's prompts are not conversational aids — they are the translation
functions that turn source streams into living documents. Their output is
stored as artifacts, rendered as markdown, and line-diffed to drive decisions
(staleness, auto-approval). A prompt that permits filler ("Here is the
summary:"), leaves data blocks unlabeled, or lets background context bleed
into the primary task corrupts documents and metrics downstream.

## Requirements

### 1. One auditable home
- All prompt text — system prompts, instruction templates, and the structural
  framing wrapped around injected data — lives in a single, dedicated place
  in the codebase. No prompt fragments assembled inline at call sites.
- For any role, the fully assembled prompt is inspectable: it must be
  possible to answer "what exactly do we send for this operation?" by reading
  one place.

### 2. Content standard — every prompt
Each prompt must explicitly provide:
- **App context**: what Kalaido is and what this operation is producing,
  enough that the model needs no guesswork about purpose.
- **Data framing**: every injected block labeled with what it is (source
  fragments, prior instruction, sample output, …), including timestamps or
  window bounds where the data is time-scoped.
- **Focus vs. background**: the material being worked on clearly separated
  from supporting reference context, with instructions on how each may be
  used.
- **Reply contract**: the exact output format, and what to omit — no
  conversational preambles, closing remarks, or meta-commentary. Output must
  be directly usable (stored, rendered, or parsed) without cleanup.

### 3. Per-role requirements
- **Snapshot generation**: labeled source block (with window timestamps when
  applicable), the lens instruction, and a strict pure-markdown-only output
  contract.
- **Lens distillation**: frames the model as a prompt engineer; labels its
  inputs (source documents, target sample output); asks for a single,
  concise, reusable instruction that reproduces the target's style and
  structure on future documents. The instruction must be data-agnostic —
  structural and stylistic rules only, never facts copied from the sample.
  Output is the instruction text alone.
- **Chat / refinement**: frames the model as a document-editing assistant;
  enforces the focus/background segregation above; drafts are delivered via
  the structured draft-update tool call, never as document text pasted into
  the conversation.
- **Colour evaluation**: task definition, the criterion, labeled positive and
  negative examples, the target document, and a reply constrained to exactly
  `YES` or `NO`.

## Out of scope
- Execution parameters (deterministic temp-0 generation): the LLM gateway
  wish.
- Iterative lens evolution (evolving an existing lens instead of
  re-distilling from scratch): the lens-APO wish
  (`engine-2026-08-17-lens-apo.md`).

## Acceptance Criteria
- [ ] An audit finds every prompt originating from the single prompt home, with no prompt text assembled inline at call sites.
- [ ] Every prompt satisfies the content standard: app context, labeled data blocks, focus/background separation, explicit reply contract.
- [ ] Generated snapshots are pure markdown with no preambles or closing remarks — directly usable without cleanup.
- [ ] Distilled lenses contain only generalized, data-agnostic instructions, and nothing but the instruction text.
- [ ] Chat refinement updates drafts exclusively through the structured tool call.
- [ ] Colour evaluations reply strictly with `YES` or `NO`.

---

UNRELATED, BUT WHILE WE'RE AT IT:
have projections prompts return a sample name for hte projection (at every turn? when providing a draft?)
so that it is available as a default when saving the projection