package llm

import (
	"context"
	"encoding/json"
)

type Message struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type Tool struct {
	Name        string          `json:"name"`
	Description string          `json:"description"`
	Parameters  json.RawMessage `json:"parameters"`
}

type ToolCall struct {
	ID   string          `json:"id"`
	Name string          `json:"name"`
	Args json.RawMessage `json:"args"`
}

type StreamEventKind int

const (
	EventText StreamEventKind = iota
	EventToolStart
	EventToolArgDelta
	EventToolEnd
)

type StreamEvent struct {
	Kind       StreamEventKind
	Text       string
	ToolCallID string
	ToolName   string
	Args       json.RawMessage
}

type Role string

const (
	RoleChat       Role = "chat"
	RoleRefinement Role = "refinement"
	RoleColour     Role = "colour"
	RoleSnapshot   Role = "snapshot" // projection/reflection output
	RoleMap        Role = "map"      // workspace map incorporation + structure
	RoleAnnotate   Role = "annotate" // per-fragment markup for the map
)

type Usage struct {
	Provider         string
	Model            string
	PromptTokens     int
	CompletionTokens int
	TotalTokens      int
	CachedTokens     int
	TokensPerSecond  float64
}

type Completion struct {
	Events <-chan StreamEvent
	Wait   func() *Usage
}

// GenOptions are per-request sampling controls. The zero value means
// "provider defaults": a nil Temperature is omitted from the request entirely.
type GenOptions struct {
	Temperature *float64
}

type Provider interface {
	Stream(ctx context.Context, messages []Message, tools []Tool, opts GenOptions) (*Completion, error)

	// ContextWindow reports this provider instance's context window, in
	// tokens. A hardcoded value tracked per provider for now, not queried live.
	ContextWindow() int
}
