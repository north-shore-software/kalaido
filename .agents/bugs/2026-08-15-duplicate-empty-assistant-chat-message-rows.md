---
title: "Every assistant turn leaves a duplicate empty chat_message row"
status: "open"
author: "agent"
created: "2026-08-15"
---

## Summary
The server never tells the AI SDK which message id it used, so the client mints its own, posts that
message back on the next turn, and the server persists it a second time as a payload-free
`dynamic-tool` row.

## Description
`StreamAssistantResponse` sends `{"type":"start"}` with no `messageId`
(`kalaidoscope/internal/chat/chat.go:71`), while the row is persisted under
`textID = "txt-<nanos>"` (`kalaidoscope/internal/handlers/refinement_chat.go:95`). The AI SDK
therefore generates its own id for the assistant message.

`DefaultChatTransport` posts the whole message array back on the next turn
(`app/src/components/kalaido/chat-panel.tsx:161`). `ExtractNewMessages` dedupes purely by message id
(`kalaidoscope/internal/chat/chat.go:18-31`), sees an id it has never stored, and persists it.

What gets stored is junk: the client's tool part is `{ type: "dynamic-tool", toolCallId, toolName,
state, input }`, but `api.UIMessagePart` only carries `Type`/`Text`/`Data`
(`kalaidoscope/internal/api/chat.go:5-9`), so the row lands as
`{"role":"assistant","parts":[{"type":"dynamic-tool"}]}` — the draft is dropped.

Currently harmless: the commit extractor (`internal/handlers/refinements.go:133-149`) and `Flatten`
(`internal/llmcontext/render.go:22`) both skip parts they don't recognise and keep walking, and the
server's own `tool-update_draft` row still carries the draft into prompt history. But the rows
accumulate one per assistant turn, and anything that counts or previews `chat_message` rows will
see them.

## Steps to Reproduce
1. Open a refinement and send two messages, so the second turn posts the first assistant turn back.
2. Query `chat_message` for that conversation.

## Expected Behavior
One row per assistant turn.

## Observed Behavior
Two rows per assistant turn: the real one keyed `txt-<nanos>`, plus a client-id row whose only part
is `{"type":"dynamic-tool"}` with no payload.

## Context / Relevant Code
- `kalaidoscope/internal/chat/chat.go:18-31,71`
- `kalaidoscope/internal/api/chat.go:5-9`
- `app/src/components/kalaido/chat-panel.tsx:161`
- Likely one-line fix: include `messageId: textID` on the `start` event so the SDK adopts the
  server's id and `ExtractNewMessages` dedupes it.
- Found while investigating the "creating a projection got stuck" report on 2026-08-15.
