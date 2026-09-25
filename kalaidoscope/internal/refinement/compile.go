package refinement

import (
	"context"
	"strings"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/prompts"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/usage"
	"github.com/north-shore-software/kalaido/kalaidoscope/llm"
	"github.com/pocketbase/pocketbase/core"
)

func CompileLens(ctx context.Context, app core.App, model string, msgs []llm.Message, currentLens, directive string) (string, error) {
	var sb strings.Builder
	if currentLens != "" {
		sb.WriteString("Current standing lens:\n<<<\n")
		sb.WriteString(currentLens)
		sb.WriteString("\n>>>\n\n")
	}
	if directive != "" {
		sb.WriteString("Directive for this update:\n")
		sb.WriteString(directive)
		sb.WriteString("\n\n")
	}
	sb.WriteString("Please write the complete standing lens instruction now.")

	compilerMsgs := make([]llm.Message, 0, len(msgs)+2)
	compilerMsgs = append(compilerMsgs, llm.Message{Role: "system", Content: prompts.LensCompilerSystemPrompt})
	for _, m := range msgs {
		if m.Role != "system" {
			compilerMsgs = append(compilerMsgs, m)
		}
	}
	compilerMsgs = append(compilerMsgs, llm.Message{Role: "user", Content: sb.String()})

	lens, err := usage.GenerateOnceMsgs(ctx, app, compilerMsgs, llm.RoleRefinement, model, nil)
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(lens), nil
}
