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

type ChatRequest struct {
	ID       string      `json:"id"`
	Messages []UIMessage `json:"messages"`
}
