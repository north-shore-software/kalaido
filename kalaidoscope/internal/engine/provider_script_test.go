package engine

import (
	"context"

	"github.com/north-shore-software/kalaido/kalaidoscope/llm"
)

func init() {
	llm.SetActiveModelSet(llm.SetLocal)
	llm.SetProviderFactory(func(model string, cfg llm.WorkspaceConfig) llm.Provider {
		return scriptedProvider{}
	})
}

// scriptedProvider is the package-default provider tests restore to after
// installing their own script. It answers every call with a fixed marker so a
// test that forgot its script fails on content rather than hanging.
type scriptedProvider struct{}

func (scriptedProvider) ContextWindow() int { return 256_000 }

func (scriptedProvider) Stream(ctx context.Context, msgs []llm.Message, tools []llm.Tool, opts llm.GenOptions) (*llm.Completion, error) {
	ch := make(chan llm.StreamEvent, 1)
	ch <- llm.StreamEvent{Kind: llm.EventText, Text: "SCRIPTED DEFAULT"}
	close(ch)
	return &llm.Completion{Events: ch, Wait: func() *llm.Usage { return nil }}, nil
}
