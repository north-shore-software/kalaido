---
title: "components.json utils alias points at a file that does not exist"
status: "open"
author: "claude"
created: "2026-08-15"
---

## Summary
`components.json` declares `"utils": "@/lib/utils"`, but the `cn` helper lives at
`@/lib/css-utils`. Any component pulled in via the shadcn CLI will be generated with a
broken import.

## Description
`app/components.json` aliases:

```json
"aliases": { "components": "@/components", "utils": "@/lib/utils", ... }
```

There is no `app/src/lib/utils.ts`. The helper is `app/src/lib/css-utils.ts`, imported as
`@/lib/css-utils` by 56 files. Zero files import `@/lib/utils`.

The CLI writes `import { cn } from "@/lib/utils"` into every generated component, so a
freshly added component fails to resolve until the import is hand-corrected.

## Steps to Reproduce
1. Run `npx shadcn@latest add <any-component>` in `app/`.
2. Open the generated file and inspect its `cn` import.

## Expected Behavior
Generated components import `cn` from the path the project actually uses.

## Observed Behavior
Generated components import from `@/lib/utils`, which does not resolve.

## Context / Relevant Code
- `app/components.json` — `aliases.utils`
- `app/src/lib/css-utils.ts` — the actual `cn` helper

## Notes
One-line fix. Also worth noting the same file records `"tailwind.config": ""` (correct —
the project is CSS-first on Tailwind v4) and `"baseColor": "mauve"`, which no longer
matches the palette in `src/index.css`.
