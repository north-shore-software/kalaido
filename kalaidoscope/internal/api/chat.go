package api

import "encoding/json"

type UIMessagePart struct {
	Type string          `json:"type"`
	Text string          `json:"text,omitempty"`
	Data json.RawMessage `json:"data,omitempty"`
}

type UIMessage struct {
	ID       string          `json:"id"`
	Role     string          `json:"role"`
	Parts    []UIMessagePart `json:"parts"`
	Metadata *UIMetadata     `json:"metadata,omitempty"`
}

// UIMetadata is the AI SDK's free-form message metadata. On an assistant
// message Usage is what the provider reported for the call that produced it
// (the last round, when a turn made several): the one measured size of the
// conversation, which the context meter anchors on.
type UIMetadata struct {
	Usage *TurnUsage `json:"usage,omitempty"`
}

type TurnUsage struct {
	PromptTokens     int `json:"promptTokens"`
	CachedTokens     int `json:"cachedTokens"`
	CompletionTokens int `json:"completionTokens"`
	TotalTokens      int `json:"totalTokens"`
}

// ToolPartData is the Data of a "tool-<name>" UIMessagePart as the client
// persists it: the call's id and the arguments the model supplied.
type ToolPartData struct {
	ToolCallID string          `json:"toolCallId"`
	Input      json.RawMessage `json:"input"`
}

// ChatRequest is the payload shape for streaming chat endpoints.
type ChatRequest struct {
	ID       string      `json:"id"`
	Messages []UIMessage `json:"messages"`
}

type RefinementChatRequest = ChatRequest
