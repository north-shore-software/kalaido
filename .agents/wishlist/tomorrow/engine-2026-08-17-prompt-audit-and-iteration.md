---
title: "System Prompt Audit, Content Requirements, and Iterative Lens Evolution"
status: "specified"
author: "human"
created: "2026-08-17"
updated: "2026-08-17"
---

## Summary
Comprehensive specification defining the role, required contents, structural constraints, and execution parameters for all system prompts across Kalaido—including deterministic `temperature: 0` execution for snapshots/distillations and iterative lens evolution across refinement cycles.

## Importance of Prompts in Kalaido
In Kalaido, system prompts are not merely conversational aids; they are the deterministic translation functions that derive living documents from source streams and upstream projections:
- Output quality directly impacts downstream dependencies across the DAG.
- Extraneous text (e.g. conversational preambles or meta-commentary) corrupts markdown document views and pollutes line-diff metrics.
- Determinism and reproducibility are paramount for stable graph state and predictable auto-approvals.

## Core Prompt Specifications

### 1. Snapshot Generation Prompt (`RoleSnapshot`)
Applied when materializing a snapshot from an active lens and source context.

- **Required Contents & Structure**:
  - **Source Material Framing**: Clearly labeled source block (with explicit timestamps/windows if applicable).
  - **Lens Instruction**: The distilled instruction specifying target style, structure, and focus.
  - **Format Constraints**: Strict requirement to produce pure Markdown output only.
  - **Anti-Filler Directives**: Explicit instruction to omit all conversational preambles (e.g., *"Here is the summary:"* or *"Certainly, below is..."*) and concluding remarks.
- **Execution Parameter Policy**:
  - **`temperature: 0`**: Mandatory to ensure consistent, reproducible generation from identical source documents and prevent spurious diff churn across regeneration cycles.

### 2. Iterative Lens Distillation Prompt (`RoleDistill`)
Executed when distilling or evolving an active lens after candidate creation or refinement.

- **Iterative Evolution Mechanism**:
  - Rather than re-distilling from scratch on every refinement and losing prior instruction nuances, iterative distillation incorporates:
    1. **Parent / Previous Lens Prompt** (the baseline instruction).
    2. **Source Documents Context**.
    3. **Target Sample Output** (the newly approved or drafted text).
    4. **Refinement Context / User Intent** (the delta or edits requested during chat).
- **Required Contents & Structure**:
  - Task instruction framing the LLM as an expert prompt engineer.
  - Baseline prompt context (if evolving an existing lens).
  - Source documents and target sample output.
  - Directive to generate a concise, reusable, single prompt instruction that reliably reproduces the target style and structure when applied to future documents.
  - Output strictly the prompt instruction text with zero meta-commentary.
- **Execution Parameter Policy**:
  - **`temperature: 0`**: Ensures predictable, high-fidelity prompt distillation.

### 3. Refinement Chat Assistant (`RoleRefinement` / `RoleChat`)
Executed during interactive chat to draft or modify projection snapshots and reflections.

- **Required Contents & Structure**:
  - System role framing the model as a document editor and distillation assistant.
  - Context segregation: Strict separation between **Primary Focus** (the active document/lens being edited) and **Background Context** (supporting reference material only).
  - Explicit guidance to update drafts via structured output/tool calls (`update_draft`) rather than dumping unformatted document replacements into conversational text.

### 4. Color Evaluation Prompt (`RoleColour`)
Executed to determine whether a document matches semantic classification criteria.

- **Required Contents & Structure**:
  - Clear task definition.
  - Criterion specification.
  - Labeled positive examples (matching criteria) and negative examples (non-matching criteria).
  - Target document text.
  - Binary response constraint: Must respond strictly with `YES` or `NO`.

## Acceptance Criteria
- [ ] All snapshot generation calls (`RoleSnapshot`) execute with `temperature: 0` and strict formatting rules omitting conversational preambles.
- [ ] Lens distillation (`RoleDistill`) supports iterative evolution by taking previous lens instructions, source documents, and sample output to produce the next prompt revision.
- [ ] Prompts across all roles enforce strict anti-filler instructions so that generated content is directly usable without text cleanup.
- [ ] Color evaluation prompt cleanly formats positive and negative examples with strict boolean output constraints.
