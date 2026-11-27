package refinement

import (
	"encoding/json"
	"strconv"
	"strings"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/api"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/prompts"
	"github.com/north-shore-software/kalaido/kalaidoscope/llm"
)

var WriteDraftTool = llm.Tool{
	Name:        prompts.WriteDraftToolName,
	Description: prompts.WriteDraftToolDescription,
	Parameters: json.RawMessage(`{
		"type": "object",
		"properties": {
			"content": {
				"type": "string",
				"description": ` + strconv.Quote(prompts.WriteDraftContentDescription) + `
			}
		},
		"required": ["content"]
	}`),
}

var ProposeEditTool = llm.Tool{
	Name:        prompts.ProposeEditToolName,
	Description: prompts.ProposeEditToolDescription,
	Parameters: json.RawMessage(`{
		"type": "object",
		"properties": {
			"target": {
				"type": "string",
				"description": ` + strconv.Quote(prompts.ProposeEditTargetDescription) + `
			},
			"replacement": {
				"type": "string",
				"description": ` + strconv.Quote(prompts.ProposeEditReplacementDesc) + `
			}
		},
		"required": ["target", "replacement"]
	}`),
}

var UpdateDraftTool = llm.Tool{
	Name:        prompts.UpdateDraftToolName,
	Description: prompts.UpdateDraftToolDescription,
	Parameters: json.RawMessage(`{
		"type": "object",
		"properties": {
			"instructions": {
				"type": "string",
				"description": ` + strconv.Quote(prompts.UpdateDraftInstructionsDesc) + `
			}
		},
		"required": ["instructions"]
	}`),
}

var RequestFullRewriteTool = llm.Tool{
	Name:        prompts.RequestFullRewriteToolName,
	Description: prompts.RequestFullRewriteToolDesc,
	Parameters: json.RawMessage(`{
		"type": "object",
		"properties": {
			"reason": {
				"type": "string",
				"description": ` + strconv.Quote(prompts.RequestFullRewriteReasonDesc) + `
			}
		},
		"required": ["reason"]
	}`),
}

func LatestWriteDraftArg(toolCalls []llm.ToolCall) *prompts.WriteDraftArgs {
	for i := len(toolCalls) - 1; i >= 0; i-- {
		if toolCalls[i].Name != prompts.WriteDraftToolName {
			continue
		}
		var args prompts.WriteDraftArgs
		if err := json.Unmarshal(toolCalls[i].Args, &args); err == nil && strings.TrimSpace(args.Content) != "" {
			return &args
		}
	}
	return nil
}

func LatestUpdateDraftArg(toolCalls []llm.ToolCall) *prompts.UpdateDraftArgs {
	for i := len(toolCalls) - 1; i >= 0; i-- {
		if toolCalls[i].Name != prompts.UpdateDraftToolName {
			continue
		}
		var args prompts.UpdateDraftArgs
		if err := json.Unmarshal(toolCalls[i].Args, &args); err == nil && strings.TrimSpace(args.Instructions) != "" {
			return &args
		}
	}
	return nil
}

func LatestRequestFullRewriteArg(toolCalls []llm.ToolCall) *prompts.RequestFullRewriteArgs {
	for i := len(toolCalls) - 1; i >= 0; i-- {
		if toolCalls[i].Name != prompts.RequestFullRewriteToolName {
			continue
		}
		var args prompts.RequestFullRewriteArgs
		if err := json.Unmarshal(toolCalls[i].Args, &args); err == nil {
			return &args
		}
	}
	return nil
}

func HasProposeEditCall(toolCalls []llm.ToolCall) bool {
	for _, tc := range toolCalls {
		if tc.Name == prompts.ProposeEditToolName {
			return true
		}
	}
	return false
}

// IsFullRewriteConfirmed reports a system-only send confirming a pending
// full-document rewrite card.
func IsFullRewriteConfirmed(newMsgs []api.UIMessage) bool {
	return hasSystemOnlyPart(newMsgs, prompts.FullRewriteConfirmPartType)
}

// IsFullRewriteCancelled reports a system-only send declining a pending
// full-document rewrite card.
func IsFullRewriteCancelled(newMsgs []api.UIMessage) bool {
	return hasSystemOnlyPart(newMsgs, prompts.FullRewriteCancelPartType)
}

// IsPickerContextChange reports a system-only send carrying a new context_spec
// from the user editing the context picker mid-session (as opposed to a user
// chat turn or confirming an AI update_context proposal).
func IsPickerContextChange(newMsgs []api.UIMessage) bool {
	hasSpec := false
	for _, m := range newMsgs {
		if m.Role == "user" {
			return false
		}
		if m.Role != "system" {
			continue
		}
		for _, p := range m.Parts {
			switch p.Type {
			case prompts.ContextConfirmPartType, prompts.ContextCancelPartType,
				prompts.FullRewriteConfirmPartType, prompts.FullRewriteCancelPartType,
				prompts.RegenerateConfirmPartType, prompts.RegenerateCancelPartType:
				return false
			case "context_spec":
				hasSpec = true
			}
		}
	}
	return hasSpec
}

// LatestFullRewriteConfirmation finds the newest data-full_rewrite_confirmation
// part on an assistant message in msgs.
func LatestFullRewriteConfirmation(msgs []api.UIMessage) (*prompts.FullRewriteConfirmationData, bool) {
	for i := len(msgs) - 1; i >= 0; i-- {
		if msgs[i].Role != "assistant" {
			continue
		}
		for j := len(msgs[i].Parts) - 1; j >= 0; j-- {
			p := msgs[i].Parts[j]
			if p.Type == prompts.FullRewriteConfirmationPartType && len(p.Data) > 0 {
				var d prompts.FullRewriteConfirmationData
				if err := json.Unmarshal(p.Data, &d); err == nil {
					return &d, true
				}
			}
		}
	}
	return nil, false
}
