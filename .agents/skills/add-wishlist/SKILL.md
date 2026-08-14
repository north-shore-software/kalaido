---
name: add-wishlist
description: Creates a structured wishlist item in .agents/wishlist/ with summary, motivation, proposed concept, and open questions. Use when capturing feature requests, product ideas, or backlog items.
---

# Skill: Add Wishlist Item

Use this skill when a user asks to add an idea, feature request, or item to the wishlist.

## Workflow

1. **Gather Details**:
   Extract details from the user prompt or conversation:
   - **Title**: Short feature name.
   - **Summary**: What the feature or capability is.
   - **Motivation / Use Case**: Why it is valuable and what user/system need it serves.
   - **Proposed Concept**: High-level conceptual approach (focusing on product/conceptual behavior rather than low-level code).
   - **Open Questions**: Any unresolved points to consider later.

2. **Generate Filename**:
   Format: `.agents/wishlist/YYYY-MM-DD-short-slug.md` (e.g., `.agents/wishlist/2025-08-12-streaming-refinements.md`).

3. **Write Wishlist File**:
   Create the file with the following markdown structure:

```markdown
---
title: "<Feature title>"
status: "idea"
author: "human"
created: "YYYY-MM-DD"
---

## Summary
<High-level summary of the idea>

## Motivation / Use Case
<Why this is valuable>

## Proposed Concept
<Conceptual approach or behavior>

## Open Questions
- <Question 1>
- <Question 2>
```

4. **Confirm**:
   Display a brief confirmation showing the created file path.
