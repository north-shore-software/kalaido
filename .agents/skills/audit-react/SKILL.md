---
name: audit-react
description: Sequence of steps to identify React code that can be improved.
disable-model-invocation: true
---

# Skill: Audit React

## Scope

Consider only files in `/app/src/` and ending with file extension `.tsx` or `.jsx`. Ignore
files in `app/src/components/ui`.

## Workflow

1. **Identify large components**

- Search through the relevant files and identify any React component over 150 lines long.

2. **Report**

- Report a list of the 10 largest components from step 1, including their component names,
  filenames and line counts.
