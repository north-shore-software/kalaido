---
title: "Decorative DiffLine primitive is superseded by the real diff viewer"
status: "open"
author: "agent"
created: "2026-08-18"
---

## Description

`app/src/components/kalaido/diff.tsx` (`DiffLine`) is a decorative mock-era
primitive: a coloured tick plus a fixed-width bar with no text input. Its only
consumer is its own Ladle story. Now that `SnapshotComparePane` renders a real
markdown diff (`app/src/lib/markdown-diff.ts`) using the same
`stable`/`critical` wash+ink tokens, the primitive has no remaining purpose.

## Suggested fix

Delete `diff.tsx`, `diff.stories.tsx`, and the `DiffLine` export from
`components/kalaido/index.ts` — or keep it only if a dashboard surface still
wants an abstract "changes happened" glyph.
