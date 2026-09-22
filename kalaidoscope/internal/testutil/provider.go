package testutil

import (
	"context"

	"github.com/north-shore-software/kalaido/kalaidoscope/llm"
)

type MockProvider struct{}

func (MockProvider) ContextWindow() int { return 256_000 }

func (MockProvider) Stream(ctx context.Context, msgs []llm.Message, tools []llm.Tool, opts llm.GenOptions) (*llm.Completion, error) {
	ch := make(chan llm.StreamEvent, 1)
	ch <- llm.StreamEvent{Kind: llm.EventText, Text: "mock response"}
	close(ch)
	return &llm.Completion{
		Events: ch,
		Wait: func() *llm.Usage {
			return &llm.Usage{Provider: "mock", Model: "mock"}
		},
	}, nil
}
