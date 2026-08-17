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

# Lens distillation (iterative self-refining)

Part of the engine update ([product spec](../engine-update.md)). Background distillation decoupled from approval, and the iterative evolution mechanism: previous lens + source docs + approved sample + refinement intent → next lens revision, at temp 0. Silent failure handling (previous lens remains active). Sources: async lens wish (08-13), prompt audit §RoleDistill (08-17).

## Current state

- Distillation runs **synchronously inside the approval request**: `engine.CommitRefinement` (`internal/engine/lifecycle.go`) commits the approved snapshot, then blocks on `DistillAndUpdateLens` before returning — the exact spinner the 08-13 wish complains about. A `TODO` at the call site already says to make it async.
- Worse than slow: a distillation failure **fails the whole commit** and surfaces as a provider error to the client, even though the approved snapshot was already saved. The decided behavior (approval lands instantly; failure is silent, previous lens stays active) is the opposite of both properties.
- Lens **lineage** is recorded correctly per model.md: `parent_lens_id`, originating refinement id, context spec, and model are stamped on each lens record (`internal/engine/lens.go`).
- But distillation content is **from scratch every time**: `prompts.DistillPrompt` receives only the source block and the sample output. The parent lens's prompt text and the refinement chat's intent are not fed in — prior instruction nuances are lost on every cycle, which is exactly what the 08-17 wish targets.
- The distill instruction does include an anti-filler directive ("output only the prompt").

## Missing

- Background execution decoupled from the commit.
- Failure isolation: commit succeeds regardless, lens attaches when ready, failure visible only in the timeline.
- The iterative prompt: parent lens + refinement context as inputs.
- Temp 0 (blocked on the parameter plumbing in [llm-scheduler](llm-scheduler.md)).


# Snapshot generation (temp=0)

Part of the engine update ([product spec](../engine-update.md)). Deterministic snapshot materialization: temp 0, strict pure-markdown output, anti-filler prompt contract — the determinism that makes diff-based auto-approval trustworthy. Sources: prompt audit §RoleSnapshot (08-17), gateway parameter policy (08-15).

## Current state

- The generation pipeline is solid: `engine.GenerateSnapshot` (`internal/engine/snapshot.go`) resolves the active lens, resolves context to pinned IDs, generates via `RoleSnapshot`, and appends a snapshot record with model, resolved context, window key/spec version, and generation timestamp. `ApproveSnapshot` assigns per-target monotonic approval sequence numbers in a transaction — the model.md active-snapshot derivation is implemented.
- Generation refuses (409) when an upstream dependency isn't up to date — the blocked-upstream guard in `internal/handlers/synthesis.go` already enforces topological discipline at the single-entity level.
- Source framing exists: `prompts.BuildPrefix` labels the source block with window timestamps when present.

## Missing

- Temperature 0 — no parameter plumbing exists (see [llm-scheduler](llm-scheduler.md)).
- The prompt contract: `prompts.ApplyPrompt` is just "Apply the following instruction... Output:" — no pure-markdown constraint, no anti-filler directives. Preamble text lands directly in the stored artifact.
- Diff computation against the live snapshot (needed for both the review UI's "differs by 4%" and the auto-approve policy) doesn't exist anywhere.


This is a highly sophisticated approach. What you are describing is a bespoke **Autonomous Prompt Optimization loop** (similar to frameworks like DSPy or Automatic Prompt Engineer).

Instead of treating prompt distillation as a single, fragile "best guess," you are treating it as a machine learning training loop: defining a ground truth (the approved output), calculating the "loss" (the delta between the generated output and the ground truth), and backpropagating that error (refining the Lens) until it converges.

This solves the hardest problem in your architecture: ensuring the Lens actually produces what the user just approved.

Here is how to structure this iterative loop so it converges quickly and avoids the classic traps of LLM self-correction.

### The Optimization Loop Architecture

Your "Desired Output" is the **Preview Snapshot** artifact that the user just approved in the Refinement Chat. This is your temporary ground truth.

#### Iteration 0: The Bootstrap

You only need the chat history here to capture the user's *intent* (the "why" behind the output).

* **Inputs:** `Resolved Context` (Source Data) + `Chat History` + `Approved Preview Artifact` (Desired Output).
* **Prompt Instruction:** *"Analyze this chat history to understand the user's goals. Look at the source data and the final Approved Output. Write an abstract, generalized system instruction (a Lens) that would transform the source data into this exact output format and structure."*
* **Output:** `Lens_v1`

#### Iteration 1+: The Critique & Refinement Cycle

Now the loop begins.

1. **Execute:** Apply `Lens_v1` to the `Resolved Context` to get `Generated_Output_v1`.
2. **Evaluate & Refine:**
* **Inputs:** `Resolved Context` + `Approved Preview Artifact` (Target) + `Generated_Output_v1` (Actual) + `Lens_v1` (Current Instructions).
* **Prompt Instruction:** *"You are an expert prompt engineer. Your goal is to refine the Lens so its output perfectly matches the Target Output's structure, tone, and logic.*
* *Step 1: Compare the Target Output to the Actual Output.*
* *Step 2: Identify exactly where the Actual Output failed (e.g., missed a formatting rule, included wrong data, wrong tone).*
* *Step 3: If the outputs are structurally and stylistically identical, output `CONVERGED: TRUE`.*
* *Step 4: If not, rewrite the Lens to fix these specific failures. Do NOT hardcode the data; write generalized rules."*





* **Output:** `Lens_v2` (or a convergence signal).

### The Three Traps You Must Avoid

If you implement this naively, the LLM will get stuck or write terrible prompts. Here is how to constrain the loop:

**1. The Overfitting Trap (Hardcoding)**
LLMs are lazy. If you ask an LLM to "write a prompt that generates this exact output," its first instinct on iteration 2 will be to write a Lens that says: *"Output the following text: [Copy-pastes the entire desired output]."*

* **The Fix:** You must explicitly instruct the meta-evaluator: *"The Lens must be entirely data-agnostic. It must contain only structural rules, formatting constraints, and logic. It must NEVER contain specific facts or data points from the target output."*

**2. The "Blind Try Again" Trap**
If you just append previous bad Lenses and say "that didn't work, try again," the model will often oscillate between two slightly different, equally flawed Lenses (A -> B -> A -> B).

* **The Fix:** Force the model to generate a **Critique (a diff analysis)** before it generates the new Lens. Making it explicitly write out *"The previous Lens failed because it allowed the inclusion of timestamps, which the target omitted"* forces the model's attention mechanism to actually fix the flaw in the next generation.

**3. Context Window Bloat**
You mentioned appending each iteration. If your `Resolved Context` is large, appending the source data, target output, and *every past failed iteration* will blow up your context window and your API costs rapidly.

* **The Fix:** Do not append the full history of failed outputs. Only feed the model the **current** state: Source Data, Target, Latest Generated Output, Latest Lens, and a running "Changelog/Critique" of what has been tried so far.

### The Trade-off: Latency

Because all calls are to the same model—which is presumably a heavy, highly capable model if it is doing generation and evaluation—this loop will be slow. If it takes 3 iterations to converge, and each iteration requires an execution generation + an evaluation generation, the user might be waiting 30–60 seconds for their Lens to "compile" after they click "Approve."