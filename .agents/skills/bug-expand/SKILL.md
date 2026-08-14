---
name: bug-expand
description: Expands an initial bug report into a complete, buildable target end-state specification by asking clarifying questions, exploring the codebase for feasibility, and proposing solutions without creating step-by-step implementation plans.
---

# Skill: Bug Expand

Use this skill when you need to take an initial, brief, or raw bug report (such as one created by `add-bug`) and expand it into a fully contextualized, buildable target state through user questioning and codebase investigation.

## Core Directives

1. **Ask Probing Questions**: Actively question the user to uncover missing context, user intent, workflow details, edge cases, and expected vs. actual behavior.
2. **Explore Codebase for Feasibility**: Read and explore the codebase *strictly* to discover constraints, verify what can or cannot be built, inspect existing abstractions, and test technical feasibility.
3. **Propose Solutions & Target States**: Suggest candidate working states or resolution approaches to help the user decide on the exact desired outcome.
4. **Strict Non-Goal — NO Implementation Plans**: Do **NOT** write step-by-step implementation or execution plans (e.g., "Step 1: Modify line X in file Y..."). Code exploration is used only to confirm that the target end state is buildable, not to map out how to build it.
5. **Establish Buildable Working End State**: The ultimate output must be a clear, unambiguous, and technically viable description of the *desired working end state* that a developer/agent can build against.

## Workflow

### 1. Identify Bug Context
- Read the initial bug report (e.g., from `.agents/bugs/` or provided directly in prompt context).
- Identify key unknown parameters: ambiguous behavior, missing environment/repro details, edge cases, or UX expectations.

### 2. Codebase Feasibility Exploration
- Inspect relevant source files, types, interfaces, or system architecture.
- Identify:
  - Technical constraints and current system limitations.
  - Existing patterns or abstractions that affect potential fixes.
  - What approaches are technically buildable vs. unbuildable.
- *Reminder*: Do not draft step-by-step instructions or plan out edits during this phase.

### 3. Interactive Clarification & Proposals
- Ask the user focused questions based on both their report and your codebase findings.
- Present candidate desired behaviors or solution options when choices exist.
- Work iteratively with the user until alignment is reached on the exact target working behavior.

### 4. Define & Record Buildable End State
- Summarize and update the bug record (or file in `.agents/bugs/`) to capture the expanded context.
- Ensure the updated description clearly specifies:
  - **Verified Constraints**: Technical realities discovered in the codebase.
  - **Desired Working End State**: Precise description of how the system must behave when resolved.
  - **Acceptance / Success Criteria**: Clear conditions that demonstrate the bug is fixed and working.
  - **Edge Cases & Scope**: What is included/excluded in the desired state.

### 5. Final Confirmation
- Confirm the updated target end-state specification with the user.
