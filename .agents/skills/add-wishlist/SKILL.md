---
name: add-wishlist
description: Captures a human braindump into a structured wishlist item in .agents/wishlist/. Focuses strictly on extracting and clarifying human context without agent expansion, decision-making, or code diving.
---

# Skill: Add Wishlist Item

Use this skill when a user wants to braindump an idea, feature request, or backlog item.

## Core Directives

1. **Extract Human Context**: Capture as much human context as possible, as quickly as possible.
2. **No Extrapolation or Expansion**: Record ONLY what the user expresses. Never add hypothetical concepts, extra open questions, or features the user did not mention.
3. **No Agent Decision-Making**: Never make product, design, or technical decisions for the user. Preserve the user's intent as stated.
4. **No Unsolicited Code Diving**: Do NOT search or inspect the codebase unless strictly necessary to understand a term or reference the user explicitly used.
5. **Clarify Unclear Points**: If something in the braindump is ambiguous or unclear, ask short, focused clarifying questions to extract details directly from the user.

## Workflow

1. **Extract Information**:
   Extract details directly from the user's prompt or braindump:
   - **Title**: Short summary title derived from user input.
   - **Summary**: What the feature or idea is, as described by the user.
   - **Motivation / Use Case**: Why it is valuable, as stated by the user.
   - **Proposed Concept**: High-level behavior or concept described by the user.
   - **Open Questions**: Unresolved points explicitly raised or mentioned by the user (do not invent new ones).

2. **Clarify if Unclear**:
   If key details are missing or ambiguous, ask concise clarifying questions. Once clarified, proceed immediately.

3. **Generate Filename**:
   Format: `.agents/wishlist/YYYY-MM-DD-short-slug.md`.

4. **Write Wishlist File**:
   Create the file with the following markdown structure, populated using ONLY human-provided context:

```markdown
---
title: "<Feature title>"
status: "idea"
author: "human"
created: "YYYY-MM-DD"
---

## Summary
<Summary as described by user>

## Motivation / Use Case
<Motivation as stated by user>

## Proposed Concept
<Concept as described by user>

## Open Questions
- <Open questions explicitly raised by user>
```

5. **Confirm**:
   Display a brief confirmation showing the created file path.
