---
title: "Chat's initialPrompt router state has no sender"
status: "open"
author: "agent"
created: "2026-09-17"
---

## Description
`Chat.tsx` reads `{ initialPrompt?: string }` from router state ("A conversation can be seeded from another page, e.g. Home's composer") and auto-sends it on mount, but no transition in `app/src` passes that state. The contract is kept in `RouteContracts` so a future sender is typed, but today the code path is unreachable.

## Steps to Reproduce
1. Grep `app/src` for `initialPrompt:` inside a `go(` call — no results.

## Expected Behavior
Either a screen sends a seed prompt to Chat, or the dead branch is removed.

## Observed Behavior
Dead code with a comment describing a sender that does not exist.
