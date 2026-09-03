# Chat — Generated Audit Snapshot

> **Generated:** 2026-09-03, from source at commit `f67e51c`.
> This file is a generated audit snapshot — do not edit it. See `AGENTS.md` § "Generated audit docs". When code described here changes, a stale marker line is prepended above this block; nothing else in the file is ever modified by hand.

**Scope.** The general chat conversation behind `POST /api/chat`: routing to the refinement handler, conversation and message persistence, how the transcript is turned into a prompt, per-turn model resolution, the SSE stream shape, the size guard, and summaries mode — how it is selected, what seeds it, what stays in full, the read tools, and how reads persist and replay. Refinement conversations reuse this machinery and are described in `refinement.md`. Resolution and hydration internals are `context.md`; prompt text is `prompts.md` § 2.

**Completeness anchor.** 1 route (`POST /api/chat`, `server/server.go`); 2 collections (`chat_conversation`, `chat_message`); 2 chat tools (`read_thing`, `read_fragment`, summaries mode only); 1 stream protocol (AI-SDK UI-message stream v1, `internal/chat/chat.go`).

---

## 1. Request and routing

Body `{id, messages: [{id, role, parts: [{type, text?, data?}]}]}` (AI-SDK `UIMessage`s). The handler first checks whether `id` is the `external_conversation_id` of a `refine_proj_snapshot_conversation`, then a `refine_refl_snapshot_conversation`; a hit dispatches to `HandleChatForRefinement` (`refinement.md` § 3). Otherwise this is a general chat.

## 2. Persistence

- **Conversation**: `chat_conversation` found or created by `external_conversation_id = id` (a create that loses a race re-reads the winner). An empty `id` means **no persistence** — the turn still runs, nothing is stored. The row's `model` field (no route sets it; the collection's own update endpoint can) overrides the chat role's model, re-read every turn.
- **Messages**: `chat_message` rows keyed by `chat_conversation_id`, `content` = the whole `UIMessage` as JSON, `model` = the model that produced an assistant row (empty for user/system rows), ordered by `created`. Rows whose content fails to decode are skipped on load.
- **New messages** = incoming messages whose `id` is not already stored (dedupe by id only). Before persisting, `ResolveContextSpecs` appends a `pinned_ids` part to each new **system** message carrying a `context_spec` and/or `window` part (`context.md` § 5). New messages are then persisted one by one; failures are logged and the turn continues.

The client is expected to send the full transcript each turn; only the unknown ids are stored, so a client that re-sends an assistant message under a new id creates a duplicate row.

## 3. Prompt assembly

`PrepareLLMPrompt` → `HydrateDeltaHistory`: it first reads the transcript's **final** state — the newest `pinned_ids` and the `summaries` flag of the newest `context_spec` — and builds one `Hydrator` on it (`context.md` § 4). It then walks every stored + new message in order: system messages become `WindowNotice` (if they carry a bounded `window`) plus the hydrated **delta** between the previous `pinned_ids` and this one; other messages are `Flatten`ed (`context.md` § 7). Because every delta is rendered against the final context, a fragment that has since left the context is omitted with a count rather than replayed, a conversation that switched modes re-renders its whole history in the new mode, and a fragment the user pinned (by id, type, or colour) renders in full even in summaries mode. An empty hydrated transcript → 400 `messages required`.

The system prompt is prepended: `ChatSystemPrompt`, or in summaries mode `ChatSummariesSystemPrompt(digest)` where the digest is the current map (narrative, things with ≥ 2 fragments, relationships); a map load failure yields an empty digest silently.

Model = `ResolveRoleFor(RoleChat, conversation.model)`; none → 500. `CheckPromptFits` refuses with **422** and the guard's message; in full mode the message is suffixed with a hint to switch the scope to Summaries.

## 4. Full-mode turn

`usage.Stream(RoleChat, model, msgs, nil)` at Interactive priority. Quota exhaustion → 402; classified provider error → its envelope; other → 500 (`llm-queue-quota.md` § 6). The response is then an SSE stream (§ 6) relaying the completion; when it drains, one assistant `chat_message` is persisted with a `text` part and a `tool-<name>` part per tool call (no tools are offered in full mode, so in practice text only). A stream that is cut mid-way persists whatever text arrived (`Stream` has no truncation guard).

## 5. Summaries mode

Selected per § 3. The model sees rows instead of bodies for everything in scope that the user did not pin; pinned fragments and upstream snapshots stay in full (`context.md` § 4). It is given two tools built on the discover reader (`discover.md` § 3.3) with a **12 fragment reads per turn** budget and chat wording: `read_thing {ids}` and `read_fragment {ids}`. The reader (map document and rows) is loaded once per turn; a load failure → 500 before the stream.

The turn is a loop of at most **4 model calls** inside one SSE response (one assistant message on the client):

1. Stream a call; collect its text (emitted as a `text` part with a per-round id) and tool calls.
2. No tool calls, or the round cap reached → stop.
3. Dispatch each call through the reader; an unknown tool yields `no tool named …`. `read_fragment` reads each id in turn and appends the budget message once the 12th read lands with ids still unread; an unknown id does not spend the budget. Each result is sent as `tool-output-available` and persisted as a `tool-<name>` part `{toolCallId, toolName, input, output, state: "output-available"}`. **The assistant row is written after every round**, so an interrupted turn keeps its reads.
4. Append to the model transcript: the assistant text + `[You called: …]`, then a user message with the joined outputs. `CheckPromptFits` again — too large → an SSE `error` event and stop. The last permitted call is made **without tools** so the turn ends in text.
5. A call error mid-loop → SSE `error` event, stop; what was streamed stays persisted.

**Replay on later turns**: `Flatten` turns persisted read parts back into the assistant text + `[You called: …]` + a user message with the outputs, so the model sees its earlier reads without re-reading (`context.md` § 7). Parts without an `output` (an interrupted call) are dropped.

## 6. The SSE stream

Headers `Content-Type: text/event-stream`, `x-vercel-ai-ui-message-stream: v1`, `Cache-Control: no-cache`, `Connection: keep-alive`; status 200 is committed by the first event, after which errors can only be signalled in-band.

Events (each `data: <json>`): `start {messageId}` — the server-minted assistant message id, which the client must adopt or the next turn persists a duplicate; `text-start {id}` / `text-delta {id, delta}` / `text-end {id}`; `tool-input-start {toolCallId, toolName, dynamic: true}`, `tool-input-delta {toolCallId, inputTextDelta}`, `tool-input-available {toolCallId, toolName, input, dynamic: true}`; `tool-output-available {toolCallId, output}`; `data-<name> {data, transient?}` parts (`inference_rate {tokensPerSecond}` transient, at most every 250 ms and once from final usage; refinement uses `refine_lint`, `refine_error`, `window_reapply` non-transient); `error {errorText}`; `finish`; then `data: [DONE]`.

## 7. What the chat does not do

- No server-side tools in full mode; no memory beyond the persisted transcript; no summarisation of long histories — the size guard refuses instead, and the omission of context that has since left is the only trimming.
- No deletion or listing routes: conversations and messages are read and deleted through the collections' built-in endpoints (both are client-writable, `schema.md`).
- Chat never writes fragments; `chat`-type fragments are created by the client through the `fragment` collection (`ingestion.md` § 1).
