---
title: "A provider failure mid-stream renders as a successful empty turn"
status: "open"
author: "agent"
created: "2026-08-15"
---

## Summary
Once the SSE headers are written, nothing can report a failure to the client — the stream always
ends with `finish` + `[DONE]`, so a turn that died halfway looks like a turn that succeeded and had
nothing to say.

## Description
`StreamAssistantResponse` writes the response headers immediately
(`kalaidoscope/internal/chat/chat.go:45-49`), then drains `comp.Events`. When the provider goroutine
exits — for any reason, including a truncated body, a scanner error, or a cancelled context — the
channel simply closes, and the handler unconditionally emits `{"type":"finish"}` and `data: [DONE]`
(`chat.go:130-131`).

No `error` stream part is ever emitted anywhere in the Go tree. Only pre-stream failures reach the
client as real errors (quota → 402, `usage.WriteProviderError`, or a 500).

Client-side that means `status` goes to `ready`, `onError` never fires
(`app/src/components/kalaido/chat-panel.tsx:176-185`), no toast is shown, and the turn renders as
empty.

Contributing: the Gemini reader never checks `scanner.Err()`
(`kalaidoscope/gemini/gemini.go:191-255`), so a line exceeding the 1MB buffer limit, or a read
error, silently truncates the turn.

## Steps to Reproduce
1. Start a chat turn.
2. Kill the provider connection (or return a truncated SSE body) after the first chunk.

## Expected Behavior
The client is told the turn failed — an `error` stream part, or at minimum a toast — rather than
being shown a successful-looking empty turn.

## Observed Behavior
Stream ends cleanly with `finish`/`[DONE]`. No error, no toast, no bubble. The user cannot tell a
failure from a model that chose to say nothing.

## Context / Relevant Code
- `kalaidoscope/internal/chat/chat.go:45-49,76-134`
- `kalaidoscope/gemini/gemini.go:191-255` (no `scanner.Err()` check)
- `app/src/components/kalaido/chat-panel.tsx:176-185`
- Found while investigating the "creating a projection got stuck" report on 2026-08-15.
