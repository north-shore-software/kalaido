package refinement

import (
	"encoding/json"
	"strconv"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/prompts"
	"github.com/north-shore-software/kalaido/kalaidoscope/llm"
)

var UpdateLensTool = llm.Tool{
	Name:        prompts.UpdateLensToolName,
	Description: prompts.UpdateLensToolDescription,
	Parameters: json.RawMessage(`{
		"type": "object",
		"properties": {
			"directive": {
				"type": "string",
				"description": ` + strconv.Quote(prompts.UpdateLensDirectiveDescription) + `
			}
		},
		"required": ["directive"]
	}`),
}

var RegenerateFromLensTool = llm.Tool{
	Name:        prompts.RegenerateFromLensToolName,
	Description: prompts.RegenerateFromLensToolDescription,
	Parameters:  json.RawMessage(`{"type": "object", "properties": {}}`),
}

var SuggestNameTool = llm.Tool{
	Name:        prompts.SuggestNameToolName,
	Description: prompts.SuggestNameToolDescription,
	Parameters: json.RawMessage(`{
		"type": "object",
		"properties": {
			"name": {
				"type": "string",
				"description": ` + strconv.Quote(prompts.SuggestNameParamDescription) + `
			}
		},
		"required": ["name"]
	}`),
}

var RefineCandidateTool = llm.Tool{
	Name:        prompts.RefineCandidateToolName,
	Description: prompts.RefineCandidateToolDescription,
	Parameters: json.RawMessage(`{
		"type": "object",
		"properties": {
			"target": {
				"type": "string",
				"description": ` + strconv.Quote(prompts.RefineCandidateTargetDescription) + `
			},
			"replacement": {
				"type": "string",
				"description": ` + strconv.Quote(prompts.RefineCandidateReplacementDescription) + `
			}
		},
		"required": ["target", "replacement"]
	}`),
}

func LatestUpdateLensArg(toolCalls []llm.ToolCall) *prompts.UpdateLensArgs {
	for i := len(toolCalls) - 1; i >= 0; i-- {
		if toolCalls[i].Name != prompts.UpdateLensToolName {
			continue
		}
		var args prompts.UpdateLensArgs
		if err := json.Unmarshal(toolCalls[i].Args, &args); err == nil && args.Directive != "" {
			return &args
		}
	}
	return nil
}

func HasRegenerateFromLensCall(toolCalls []llm.ToolCall) bool {
	for _, tc := range toolCalls {
		if tc.Name == prompts.RegenerateFromLensToolName {
			return true
		}
	}
	return false
}

func LatestRefineCandidateArg(toolCalls []llm.ToolCall) *prompts.RefineCandidateArgs {
	for i := len(toolCalls) - 1; i >= 0; i-- {
		if toolCalls[i].Name != prompts.RefineCandidateToolName {
			continue
		}
		var args prompts.RefineCandidateArgs
		if err := json.Unmarshal(toolCalls[i].Args, &args); err == nil && args.Target != "" && args.Replacement != "" {
			return &args
		}
	}
	return nil
}

// JSONStringChunk escapes one streamed text chunk for insertion into an
// in-progress JSON string literal (the fabricated apply_result args stream).
func JSONStringChunk(s string) string {
	b, _ := json.Marshal(s)
	return string(b[1 : len(b)-1])
}
