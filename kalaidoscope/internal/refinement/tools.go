// UNREVIEWED
package refinement

import (
	"encoding/json"
	"strconv"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/prompts"
	"github.com/north-shore-software/kalaido/kalaidoscope/llm"
)

// UpdateLensTool allows the model to draft or revise a lens prompt.
var UpdateLensTool = llm.Tool{
	Name:        prompts.UpdateLensToolName,
	Description: prompts.UpdateLensToolDescription,
	Parameters: json.RawMessage(`{
		"type": "object",
		"properties": {
			"lens": {
				"type": "string",
				"description": ` + strconv.Quote(prompts.UpdateLensParamDescription) + `
			},
			"suggested_name": {
				"type": "string",
				"description": ` + strconv.Quote(prompts.UpdateLensNameDescription) + `
			}
		},
		"required": ["lens"]
	}`),
}

// SuggestNameTool allows the model to propose an updated name for the parent entity.
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

// LatestLensArg returns the lens from the turn's last update_lens call, or ""
// when the turn drafted none (a clarify question, or an unchanged lens).
func LatestLensArg(toolCalls []llm.ToolCall) string {
	for i := len(toolCalls) - 1; i >= 0; i-- {
		if toolCalls[i].Name != prompts.UpdateLensToolName {
			continue
		}
		var args prompts.UpdateLensArgs
		if err := json.Unmarshal(toolCalls[i].Args, &args); err == nil && args.Lens != "" {
			return args.Lens
		}
	}
	return ""
}

// JSONStringChunk escapes one streamed text chunk for insertion into an
// in-progress JSON string literal (the fabricated apply_result args stream).
func JSONStringChunk(s string) string {
	b, _ := json.Marshal(s)
	return string(b[1 : len(b)-1])
}
