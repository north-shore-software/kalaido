---
title: "Tag specific documents in chat instead of focus mode"
status: "shipped"
author: "human"
created: "2026-08-17"
---

## Summary
Allow users to tag specific documents directly in the chat interface instead of using focus mode.

## Motivation / Use Case
Tagging specific documents directly in chat offers a more natural and direct mechanism for referencing context documents during conversation.

## Proposed Concept
Replace or complement the existing focus mechanism by allowing users to directly tag/mention specific documents within the chat.

## Open Questions
- None explicitly raised by user.

## Resolution (2026-08-18)
Shipped as "named sources": @-mentions in chat and refinement chat resolve to
entity IDs at compose time, expand to model-facing references at prompt
assembly, and add the tagged item to the context selection. The focus mechanism
was subsequently removed end to end (picker stage, ContextSpec.focus,
PinnedIDs.Focus, focus/background prompt framing, and the Save & refocus
action) — mentions are now the way to state the subject.
