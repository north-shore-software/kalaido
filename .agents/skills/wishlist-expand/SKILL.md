---
name: wishlist-expand
description: Expands a wishlist item or feature request into a buildable specification by asking one question at a time, exploring the codebase for existing constraints (without being bound by them), and defining the desired working end state without writing an implementation plan.
---

# Skill: Wishlist Expand

Use this skill when you need to take an initial wishlist item, feature concept, or backlog idea (such as one created by `add-wishlist`) and expand it into a fully detailed, buildable feature specification through interactive "grill-me" style questioning and codebase exploration.

## Core Directives

1. **Ask ONE Question at a Time ("Grill-Me" Style)**:
   - Ask questions **one at a time**, as soon as possible.
   - Do not batch or group multiple questions together in a single response.
   - Wait for the user's answer before conducting deeper codebase exploration or asking the next question.
   - Use each answer to guide the next phase of investigation and follow-up inquiry.

2. **Explore Codebase for Context, Not Constraints**:
   - Inspect the codebase to understand how existing features, schemas, and UI components currently operate.
   - **Do NOT be bound by existing code constraints.** Wishlist items often require reworking existing code, changing product paradigms, or modifying data models.
   - Frame existing constraints as technical options and tradeoffs for the user to decide on (e.g. *"Currently X works like Y. We could change Y to support Z, or extend X by... Which direction do you prefer?"*).

3. **Propose Product & Architectural Options**:
   - When choices exist regarding user experience, data flow, or system scope, present clear options with their product/technical implications so the user can make informed decisions.

4. **Strict Non-Goal — NO Implementation Plans**:
   - Do **NOT** write step-by-step implementation plans or step-by-step file modification guides (e.g., "Step 1: Edit file A, Step 2: Add function B...").
   - Code exploration is strictly to evaluate possibilities, clarify requirements, and confirm buildability—not to plan implementation details.

5. **Establish Buildable Working End State**:
   - The final output must be a clear, comprehensive, and technically viable specification of the *desired working end state* that a developer or agent can build against.

## Workflow

### 1. Load Wishlist Context
- Read the target wishlist item (e.g., from `.agents/wishlist/` or user prompt input).
- Identify the core vision, primary use case, and immediate high-level ambiguities.

### 2. Incremental "Grill-Me" Inquiry Loop
- **Inspect**: Do a quick, targeted check of the codebase to ground the immediate topic.
- **Ask**: Formulate and ask **a single, focused question** (or present 1 decision with clear options).
- **Listen**: Receive the user's response.
- **Iterate**: Use the answer to navigate to the next area of codebase investigation or formulate the next single question.
- Repeat this loop—one question at a time—until all user experience, data model, and system boundaries are clear.

### 3. Synthesize the Buildable End State
Once the inquiry loop is complete, synthesize the findings into a clear, buildable specification:
- **Core User Experience & Workflows**: How the feature behaves in practice.
- **Impact on Existing Architecture**: What existing paradigms or constraints will be reworked or extended (as agreed with the user).
- **Data & System Scope**: New state, properties, or endpoints required.
- **Edge Cases & Acceptance Criteria**: Unambiguous checklist for when the wishlist feature is fully built and working.

### 4. Record/Update Wishlist Specification
- Update the target wishlist file in `.agents/wishlist/` (or create an expanded wishlist file).
- Set/update the frontmatter status (e.g. `status: "specified"`).
- Display a concise confirmation of the updated specification file.
