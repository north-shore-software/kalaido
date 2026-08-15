---
title: "No way to cancel a streaming chat turn, and no timeout behind it"
status: "open"
author: "agent"
created: "2026-08-15"
---

## Summary
Once a chat turn starts streaming there is no way to stop it from the UI, and nothing on the server
side bounds how long it can run.

## Description
`useChat` exposes `stop()`, but it is never destructured or called anywhere in the app — only
`{ messages, sendMessage, status }` are taken (`app/src/components/kalaido/chat-panel.tsx:171`).
There is no stop button in `ChatComposer`, and no `AbortController` is threaded through the
transport.

While a turn is in flight, `isLoading` (`chat-panel.tsx:198`) disables both the send button and the
"…" bubble's disappearance, so a slow or stalled turn is indistinguishable from a hang and the only
escape is navigating away.

Behind it, the provider client has no overall deadline: `httpx.Streaming()` clones the shared
transport and sets `ResponseHeaderTimeout: 0` with no `Client.Timeout`
(`kalaidoscope/httpx/client.go:23-31`). If the provider connection stalls mid-body,
`StreamAssistantResponse` blocks on `for ev := range comp.Events`
(`kalaidoscope/internal/chat/chat.go:76`) indefinitely and the SSE response never closes.

## Steps to Reproduce
1. Open a projection and start a refine chat.
2. Send a prompt that produces a long generation (a full rewrite of a large snapshot takes minutes).
3. Try to cancel it.

## Expected Behavior
A visible way to stop the turn, and a bounded stream that eventually errors rather than hanging
forever if the provider stops sending.

## Observed Behavior
No stop affordance exists. Send stays disabled and the "…" bubble stays up for as long as the turn
runs; if the provider stalls, that is permanent until the page is left.

## Context / Relevant Code
- `app/src/components/kalaido/chat-panel.tsx:171,198`
- `app/src/components/kalaido/chat-composer.tsx:30`
- `kalaidoscope/httpx/client.go:23-31`
- `kalaidoscope/internal/chat/chat.go:76`
- Found while investigating the "creating a projection got stuck" report on 2026-08-15.
