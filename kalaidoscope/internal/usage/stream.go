package usage

import (
	"context"
	"strings"

	"github.com/pocketbase/pocketbase/core"

	"github.com/north-shore-software/kalaido/llm"
)

func Stream(ctx context.Context, app core.App, role llm.Role, msgs []llm.Message, tools []llm.Tool) (*llm.Completion, error) {
	if err := Authorized(ctx, app); err != nil {
		return nil, err
	}
	model, err := llm.ResolveRole(role)
	if err != nil {
		return nil, err
	}
	comp, err := llm.SelectedProvider(model).Stream(ctx, msgs, tools)
	if err != nil {
		return nil, err
	}
	wrapped := make(chan llm.StreamEvent)
	go func() {
		defer close(wrapped)
		for c := range comp.Events {
			wrapped <- c
		}
		Record(ctx, app, comp.Wait())
	}()
	return &llm.Completion{Events: wrapped, Wait: comp.Wait}, nil
}

func GenerateOnce(ctx context.Context, app core.App, prompt string, role llm.Role, tools []llm.Tool) (string, error) {
	comp, err := Stream(ctx, app, role, []llm.Message{{Role: "user", Content: prompt}}, tools)
	if err != nil {
		return "", err
	}
	var sb strings.Builder
	for ev := range comp.Events {
		if ev.Kind == llm.EventText {
			sb.WriteString(ev.Text)
		}
	}
	return sb.String(), nil
}
