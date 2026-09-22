// UNREVIEWED
package api

import "encoding/json"

type UIMessagePart struct {
	Type string          `json:"type"`
	Text string          `json:"text,omitempty"`
	Data json.RawMessage `json:"data,omitempty"`
}

type UIMessage struct {
	ID    string          `json:"id"`
	Role  string          `json:"role"`
	Parts []UIMessagePart `json:"parts"`
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
