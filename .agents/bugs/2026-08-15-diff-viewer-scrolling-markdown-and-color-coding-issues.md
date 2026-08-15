---
title: "Diff view issues: un-synced scrolling, missing markdown rendering, and lack of color coding"
status: "open"
author: "human"
created: "2026-08-15"
---

## Summary
The diff viewer panels move independently when scrolling, do not render markdown, and lack color coding to highlight changes.

## Description
Multiple issues in the diff view:
1. Scrolling one panel on the diff does not scroll the other panel (panels scroll independently).
2. The diff panels do not render markdown.
3. The diff is not color coded, making changes unidentifiable.
User questioned whether an existing diff component can be used instead of rebuilding a custom one.

## Steps to Reproduce
1. Open the diff view.
2. Scroll one side of the diff viewer and observe independent panel movement.
3. View markdown content in the diff and observe unrendered text.
4. Inspect diff changes and observe the absence of color coding for additions/deletions.

## Expected Behavior
- Diff panels should scroll in sync.
- Diff panels should render markdown formatting.
- Diff should be color coded to clearly display changes.

## Observed Behavior
- Panels scroll independently.
- Markdown formatting is not rendered.
- Diff lacks color coding.

## Context / Relevant Code
- Affected files: None explicitly named by user
- Notes: User reported: "scrolling one panel on the diff doesn't scroll down the other panel - they move independently. it's weird. they also don't render markdown. the diff is also not colour coded so I can't see what changed. is there a diff component we can use? this seems way overcomplicated to re-build"
