---
name: add-bug
description: Captures a human bug braindump into a structured bug report in .agents/bugs/. Focuses strictly on extracting human context without agent expansion, decision-making, or unsolicited code inspection.
---

# Skill: Add Bug

Use this skill when a user wants to report or braindump a bug.

## Core Directives

1. **Extract Human Context**: Capture as much human context as possible, as quickly as possible.
2. **No Extrapolation or Expansion**: Record ONLY what the user expresses. Do not invent steps to reproduce, expected behaviors, or root causes the user did not mention.
3. **No Agent Decision-Making**: Never make decisions about fix approaches, severity, or implementation details. Preserve the user's report as stated.
4. **No Unsolicited Code Diving**: Do NOT search or inspect the codebase unless strictly necessary to understand a file or term the user explicitly mentioned.
5. **Clarify Unclear Points**: If something in the braindump is ambiguous or incomplete, ask short, focused clarifying questions to extract details directly from the user.

## Workflow

1. **Extract Information**:
   Extract details directly from the user's prompt or braindump:
   - **Title**: Short summary title derived from user input.
   - **Description**: Problem description as stated by the user.
   - **Steps to Reproduce**: Steps provided or described by the user.
   - **Expected Behavior**: What the user expected to happen.
   - **Observed Behavior**: What the user observed happening.
   - **Context / Relevant Code**: Files, components, or context specifically named by the user.

2. **Clarify if Unclear**:
   If key details are missing or ambiguous, ask concise clarifying questions. Once clarified, proceed immediately.

3. **Generate Filename**:
   Format: `.agents/bugs/YYYY-MM-DD-short-slug.md`.

4. **Write Bug File**:
   Create the file with the following markdown structure, populated using ONLY human-provided context:

```markdown
---
title: "<Short summary of the bug>"
status: "open"
author: "human"
created: "YYYY-MM-DD"
---

## Description
<Clear description as stated by user>

## Steps to Reproduce
1. <Step 1 provided by user>
2. <Step 2 provided by user>

## Expected Behavior
<Expected behavior described by user>

## Observed Behavior
<Observed behavior described by user>

## Context / Relevant Code
- Affected files: `<files named by user>`
- Notes: <Context provided by user>
```

5. **Confirm**:
   Display a brief confirmation showing the created file path.
