---
title: "Committing a refinement over a candidate with unresolved edits returns 500"
status: "open"
author: "agent"
created: "2026-09-25"
---

## Description
`engine.CommitRefinement` refuses to approve a pending candidate in place while its `output_draft` still holds `<<<edit:…>>>` markers, returning `engine.ErrNotApprovable`. `handleCommitRefinementGeneric` in `internal/handlers/refinements.go` maps `ErrNoDraftedLens`, `ErrNoPreviewOutput`, `ErrMissingParentID` and `ErrParentMismatch` but not `ErrNotApprovable`, so the client gets a generic `500 failed to commit refinement`. The approve route maps the same error to a 4xx.

## Steps to Reproduce
1. Open a refinement on a projection whose pending candidate has at least one `proposed` edit.
2. Drive a turn so the refinement is bound to that candidate, then `POST …/refinements/{rid}/commit`.

## Expected Behavior
A 409 (or 422) naming the unresolved edits, matching the approve route.

## Observed Behavior
`500 failed to commit refinement`.
