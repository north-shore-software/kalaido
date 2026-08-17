---
title: "Rich markdown rendering for projection previews and synchronized diff viewer with split/inline toggle"
status: "specified"
author: "human"
created: "2026-08-15"
updated: "2026-08-17"
supersedes:
  - ".agents/bugs/2026-08-15-diff-viewer-scrolling-markdown-and-color-coding-issues.md"
  - ".agents/bugs/2026-08-15-projection-preview-viewer-doesnt-render-markdown.md"
---

## Summary
Projection snapshot previews, live draft editors, and side-by-side diff compare views currently display raw text (via `whitespace-pre-wrap`) without markdown formatting. Furthermore, the compare view lacks synchronized scrolling, diff color coding (additions/deletions), and a unified inline diff option.

## Problem Statement & Context
1. **Unrendered Markdown**:
   - `SnapshotPreview` (on `ProjectionDetail` page) displays raw markdown text rather than rendered rich formatting.
   - `ProjectionDraftEditor` (live draft preview during projection creation and refinement) displays raw markdown text.
   - `SnapshotComparePane` (on `ProjectionReview` page) displays raw unrendered text in both current and pending panels.
2. **Diff Compare Usability**:
   - **Independent Scrolling**: In the side-by-side compare pane, scrolling one panel leaves the other panel static, making side-by-side comparison difficult for long documents.
   - **No Change Highlighting**: Content is displayed in plain text without visual change highlighting (additions/deletions).
   - **No Layout Flexibility**: Only a side-by-side layout exists, without the ability to view a unified/inline diff.

## Desired Working End State

### 1. Rich Markdown Rendering
- All projection preview surfaces render rich markdown formatted according to Kalaido typography standards (`app/DESIGN.md`):
  - Headings (`h1`, `h2`, `h3`), lists (ordered, unordered, task lists), bold, italic, blockquotes, horizontal rules, and inline/block code blocks.
  - Applies to:
    - **Committed Snapshot Views**: `SnapshotPreview` (live plan of record and historical snapshots).
    - **Draft / Refinement Previews**: `ProjectionDraftEditor` (during `NewProjection` creation and detail-page refinements) and `LivePreviewPane`.
    - **Candidate Compare Views**: `SnapshotComparePane` across both current and pending panels.

### 2. Diff Compare Experience (`SnapshotComparePane`)
- **Rich Markdown Diffing**:
  - Highlights semantic additions and deletions within the formatted markdown structure.
  - Additions highlighted using standard stable styling (`--status-stable-wash` / `--status-stable-ink`).
  - Deletions highlighted using standard critical styling (`--status-critical-wash` / `--status-critical-ink` with strikethrough).
- **Synchronized Scrolling**:
  - In side-by-side mode, scrolling either panel scrolls the opposing panel proportionally and synchronously so matching sections stay aligned.
- **View Toggle (Side-by-Side vs. Unified)**:
  - Header toolbar provides a toggle between **Side-by-Side (Split)** and **Unified (Inline)** diff views.
  - **Side-by-Side View**: Dual panels ("current" on the left, "pending/refined" on the right) with aligned, synchronized scrolling and colored highlights.
  - **Unified View**: A single combined document view interleaving deleted and added blocks/lines in reading order.
- **State Handling**:
  - Properly handles empty states (e.g., initial projection with no previous snapshot displays the entire candidate as additions).
  - Preserves refining state indicator ("refined" vs "pending" badge).

## Acceptance Criteria
- [ ] Navigating to a projection with markdown content renders styled markdown (headings, lists, code, etc.) instead of raw markdown syntax in the main snapshot view.
- [ ] During projection creation (`NewProjection`) or chat refinement, the draft preview updates and renders live markdown.
- [ ] In `ProjectionReview`, the compare view clearly highlights additions in stable wash/ink and deletions in critical wash/ink.
- [ ] In side-by-side compare mode, scrolling one pane synchronously scrolls the other pane to keep corresponding content in view.
- [ ] Users can toggle between side-by-side and unified inline diff layouts in the review screen.
- [ ] Diff view functions correctly when comparing against an empty baseline (first snapshot generation).
