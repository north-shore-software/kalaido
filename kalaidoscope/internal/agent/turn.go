package agent

import (
	"strings"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/prompts"
	"github.com/north-shore-software/kalaido/kalaidoscope/llm"
)

// ToolNames returns the names of the given tool calls in order.
func ToolNames(calls []llm.ToolCall) []string {
	names := make([]string, 0, len(calls))
	for _, c := range calls {
		names = append(names, c.Name)
	}
	return names
}

// FormatAssistantEcho creates an assistant message containing the model's reply
// text and, when tool calls are present, the appended tool echo notation
// (`[You called: ...]`).
func FormatAssistantEcho(reply string, calls []llm.ToolCall) llm.Message {
	return llm.Message{
		Role:    "assistant",
		Content: reply + prompts.DiscoverEchoToolCalls(ToolNames(calls)),
	}
}

// FormatToolResults formats a sequence of tool outputs into a user turn
// with results separated by blank lines.
func FormatToolResults(results []string) llm.Message {
	return llm.Message{
		Role:    "user",
		Content: strings.Join(results, "\n\n"),
	}
}
