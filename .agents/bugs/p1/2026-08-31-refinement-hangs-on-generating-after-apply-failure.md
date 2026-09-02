---
title: "Refinement chat can hang on \"Generating…\" indefinitely after an apply failure"
status: "open"
author: "agent"
created: "2026-08-31"
---

## Description
When a projection's refinement-chat apply step fails (`engine.ApplyDraftLens` errors), `refinement_chat.go` has already sent `ToolInputStart` plus an opening `ToolInputDelta` for the synthetic `apply_result` tool call before invoking the apply model — then, on failure, it deliberately never sends `ToolInputAvailable` for that call (this is intentional and locked in by `TestRefinementApplyFailurePersistsErrorNotice`, which asserts a failed apply must NOT emit tool-input-available). Only a separate `data-refine_error` part is sent instead.

On the client, this leaves the `apply_result` dynamic-tool part permanently in AI-SDK's `"input-streaming"` state. `extractRefinePhase` (`app/src/api/kalaidoscope/refinements.ts`) checks `applyStreaming` before `sawError`, so the newest assistant turn's phase stays `"applying"` even though the chat transcript shows the error notice and the input box is re-enabled.

This is the same failure shape (a live preview stuck on a "generating" state with no way to recover) that the original fence-scraping → tool-calling migration was built to eliminate — it has resurfaced at the apply step specifically.

## Steps to Reproduce
1. Start a refinement chat session that reaches the draft-apply step.
2. Force `engine.ApplyDraftLens` to fail (e.g. a bad model id, provider error).
3. Observe the projection draft preview pane.

## Expected Behavior
On an apply failure, the preview pane should reflect the error state (matching the error notice already shown in the chat transcript) rather than continuing to show a "generating" state.

## Observed Behavior
`projection-draft-editor.tsx` renders "Generating the preview…" indefinitely for that turn. It only clears once the user sends a new message (a new assistant turn supersedes it) or reloads/resumes the session (the dangling part was never persisted server-side).

Evidence: `internal/handlers/refinement_chat.go:286-308`, `internal/handlers/refinement_chat_test.go:252-276` (`TestRefinementApplyFailurePersistsErrorNotice`), `app/src/api/kalaidoscope/refinements.ts:243-269` (`extractRefinePhase`).
