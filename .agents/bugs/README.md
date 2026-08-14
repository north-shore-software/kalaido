# Bugs Directory (`.agents/bugs/`)

This directory contains documented bug reports, edge cases, and unexpected behaviors discovered by humans or agents.

---

## File Naming Convention

Format: `YYYY-MM-DD-short-description.md`  
Example: `2025-08-12-colour-eval-timeout.md`

---

## Bug Report Template

New bug reports should follow this markdown template:

```markdown
---
title: "Short summary of the issue"
status: "open" # open | investigating | resolved | closed
author: "human" # human | agent
created: "YYYY-MM-DD"
---

## Description
Clear and concise description of what the bug is.

## Steps to Reproduce
1. Go to '...'
2. Perform action '...'
3. See error

## Expected Behavior
A clear description of what you expected to happen.

## Observed Behavior
What actually happened (including error messages, HTTP status codes, or stack traces).

## Context / Relevant Code
- Affected files: `internal/...`
- Relevant tests or logs: `...`
```
