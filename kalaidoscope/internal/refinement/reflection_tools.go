package refinement

import (
	"encoding/json"
	"strconv"
	"strings"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/api"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/prompts"
	"github.com/north-shore-software/kalaido/kalaidoscope/llm"
)

// SetLensTool writes or replaces the reflection's standing lens in a single
// step (no CompileLens second call, no LensCountPin linter).
var SetLensTool = llm.Tool{
	Name:        prompts.SetLensToolName,
	Description: prompts.SetLensToolDescription,
	Parameters: json.RawMessage(`{
		"type": "object",
		"properties": {
			"prompt": {
				"type": "string",
				"description": ` + strconv.Quote(prompts.SetLensPromptDescription) + `
			}
		},
		"required": ["prompt"]
	}`),
}

// LatestSetLensArg returns the last non-empty set_lens tool call in toolCalls.
func LatestSetLensArg(toolCalls []llm.ToolCall) *prompts.SetLensArgs {
	for i := len(toolCalls) - 1; i >= 0; i-- {
		if toolCalls[i].Name != prompts.SetLensToolName {
			continue
		}
		var args prompts.SetLensArgs
		if err := json.Unmarshal(toolCalls[i].Args, &args); err == nil && strings.TrimSpace(args.Prompt) != "" {
			args.Prompt = strings.TrimSpace(args.Prompt)
			return &args
		}
	}
	return nil
}

// LatestReflectionLens finds the newest standing lens prompt across a
// reflection refinement transcript, recognizing set_lens, data-lens, and
// seeded/legacy update_lens parts.
func LatestReflectionLens(msgs []api.UIMessage) (api.UIMessagePart, string) {
	for i := len(msgs) - 1; i >= 0; i-- {
		if msgs[i].Role != "assistant" {
			continue
		}
		for j := len(msgs[i].Parts) - 1; j >= 0; j-- {
			p := msgs[i].Parts[j]
			switch p.Type {
			case "tool-" + prompts.SetLensToolName:
				var data api.ToolPartData
				if err := json.Unmarshal(p.Data, &data); err == nil {
					var args prompts.SetLensArgs
					if err := json.Unmarshal(data.Input, &args); err == nil && strings.TrimSpace(args.Prompt) != "" {
						return p, strings.TrimSpace(args.Prompt)
					}
				}
			case prompts.LensPartType:
				var data prompts.LensPartData
				if err := json.Unmarshal(p.Data, &data); err == nil && strings.TrimSpace(data.Lens) != "" {
					return p, strings.TrimSpace(data.Lens)
				}
			case "tool-" + prompts.UpdateLensToolName:
				var data api.ToolPartData
				if err := json.Unmarshal(p.Data, &data); err == nil {
					var legacy struct {
						Lens string `json:"lens"`
					}
					if err := json.Unmarshal(data.Input, &legacy); err == nil && strings.TrimSpace(legacy.Lens) != "" {
						return p, strings.TrimSpace(legacy.Lens)
					}
				}
			}
		}
	}
	return api.UIMessagePart{}, ""
}

// LatestPreviewOutput extracts the single latest apply_result preview text from
// the reflection refinement transcript (empty string if no preview exists yet).
func LatestPreviewOutput(msgs []api.UIMessage) string {
	for i := len(msgs) - 1; i >= 0; i-- {
		if msgs[i].Role != "assistant" {
			continue
		}
		for j := len(msgs[i].Parts) - 1; j >= 0; j-- {
			p := msgs[i].Parts[j]
			if p.Type != "tool-"+prompts.ApplyResultToolName {
				continue
			}
			var data api.ToolPartData
			if err := json.Unmarshal(p.Data, &data); err != nil {
				continue
			}
			var args struct {
				Output string `json:"output"`
			}
			if err := json.Unmarshal(data.Input, &args); err == nil && strings.TrimSpace(args.Output) != "" {
				return strings.TrimSpace(args.Output)
			}
		}
	}
	return ""
}
