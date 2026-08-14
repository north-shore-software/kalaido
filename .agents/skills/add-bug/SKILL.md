---
name: add-bug
description: Creates a structured bug report in .agents/bugs/ with reproduction steps, expected vs observed behavior, and relevant code context. Use when reporting or logging a bug in the codebase.
---

# Skill: Add Bug

Use this skill when a user asks to log, record, or report a bug.

## Workflow

1. **Gather Details**:
   If the user has provided details in their prompt, extract them. If details are missing, ask or infer from recent context:
   - **Title**: Concise summary of the issue.
   - **Steps to Reproduce**: 1-3 concrete steps to trigger the bug.
   - **Expected Behavior**: What should happen.
   - **Observed Behavior**: What actually happened (errors, wrong status codes, logs).
   - **Context**: Affected packages/files or endpoints (e.g. `kalaidoscope/internal/...`).

2. **Generate Filename**:
   Format: `.agents/bugs/YYYY-MM-DD-short-slug.md` (e.g., `.agents/bugs/2025-08-12-colour-eval-timeout.md`).

3. **Write Bug File**:
   Create the file with the following markdown structure:

```markdown
---
title: "<Short summary of the bug>"
status: "open"
author: "human"
created: "YYYY-MM-DD"
---

## Description
<Clear description of the problem>

## Steps to Reproduce
1. <Step 1>
2. <Step 2>
3. <Step 3>

## Expected Behavior
<Description of expected behavior>

## Observed Behavior
<Description of observed behavior / error messages>

## Context / Relevant Code
- Affected files: `<path/to/file>`
- Notes: <Any additional context>
```

4. **Confirm**:
   Display a brief confirmation showing the created file path.
