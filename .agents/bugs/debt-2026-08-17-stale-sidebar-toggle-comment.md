---
title: "nav-sidebar comment claims the collapse toggle is visible; CSS hides it"
status: "open"
author: "agent"
created: "2026-08-17"
---

## Description
The comment above `SidebarToggleButton` at
`app/src/components/layout/nav-sidebar.tsx:159-163` says the toggle "is the
only visible way back to the labels — it has to stay on screen". But the
button is hidden by `[data-sidebar-control="toggle"] { display: none }`
(`app/src/index.css:418-420`), per DESIGN.md §6's hidden-but-wired policy.
The comment describes a state that no longer ships.

Related inconsistency worth deciding at the same time: DESIGN.md §6 says
"expanded is unreachable in the shipped UI", but the global ⌘/Ctrl+B listener
(`app/src/components/ui/sidebar.tsx:119-132`) still expands the rail and
persists the choice — so it is reachable by keyboard.

## Expected Behavior
Comment matches reality (hidden-but-wired), and doc/code agree on whether ⌘B
counts as a shipping entry point to the expanded rail.

## Observed Behavior
Comment asserts the control is visible; doc asserts expanded is unreachable;
neither is accurate.

## Context / Relevant Code
- `app/src/components/layout/nav-sidebar.tsx:159-175`
- `app/src/index.css:418-420`
- `app/src/components/ui/sidebar.tsx:119-132`
- `app/DESIGN.md` §6
