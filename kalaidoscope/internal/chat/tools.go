package chat

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"strconv"
	"strings"

	"github.com/pocketbase/pocketbase/core"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/api"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/prompts"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/usage"
	"github.com/north-shore-software/kalaido/kalaidoscope/llm"
)

var (
	// ErrMessagesRequired indicates no messages were provided or generated for the prompt.
	ErrMessagesRequired = errors.New("messages required")
	// ErrNoModel indicates no model was configured for refinement chat.
	ErrNoModel         = errors.New("no model configured for refinement")
	ErrNoDraftedLens   = errors.New("no drafted lens found in chat")
	ErrNoPreviewOutput = errors.New("the latest lens has no generated preview — send another message to regenerate")
	ErrMissingParentID = errors.New("refinement missing parent target id")
	ErrParentMismatch  = errors.New("refinement parent target id mismatch")
)

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

// UpdateContextTool lets the model propose a context change. The handler
// never applies the call itself: it streams the resulting spec back as a
// confirmation part, and the client's confirm appends the `context_spec`
// message that actually changes the conversation's context.
var UpdateContextTool = llm.Tool{
	Name:        prompts.UpdateContextToolName,
	Description: prompts.UpdateContextToolDescription,
	Parameters: json.RawMessage(`{
		"type": "object",
		"properties": {
			"whole_scope": {
				"type": "string",
				"enum": ["full", "pins"],
				"description": ` + strconv.Quote(prompts.UpdateContextWholeScopeDescription) + `
			},
			"pin_fragment_ids": {
				"type": "array",
				"items": {"type": "string"},
				"description": ` + strconv.Quote(prompts.UpdateContextPinFragmentsDesc) + `
			},
			"unpin_fragment_ids": {
				"type": "array",
				"items": {"type": "string"},
				"description": ` + strconv.Quote(prompts.UpdateContextUnpinFragmentsDesc) + `
			},
			"pin_fragment_types": {
				"type": "array",
				"items": {"type": "string"},
				"description": ` + strconv.Quote(prompts.UpdateContextPinTypesDesc) + `
			},
			"unpin_fragment_types": {
				"type": "array",
				"items": {"type": "string"},
				"description": ` + strconv.Quote(prompts.UpdateContextUnpinTypesDesc) + `
			},
			"reason": {
				"type": "string",
				"description": ` + strconv.Quote(prompts.UpdateContextReasonDescription) + `
			}
		},
		"required": ["reason"]
	}`),
}

// LatestUpdateContextArg is the last update_context call of a turn, if any.
func LatestUpdateContextArg(toolCalls []llm.ToolCall) *prompts.UpdateContextArgs {
	var latest *prompts.UpdateContextArgs
	for _, tc := range toolCalls {
		if tc.Name != prompts.UpdateContextToolName {
			continue
		}
		var args prompts.UpdateContextArgs
		if err := json.Unmarshal(tc.Args, &args); err != nil {
			continue
		}
		latest = &args
	}
	return latest
}

// ApplyContextOps is the spec that would be in force if the user accepted
// the model's proposal, built from the current one. Pins are set-like: a
// repeated pin is kept once, an unpin of something not pinned is a no-op,
// and an item both pinned and unpinned in one call ends up unpinned. The
// snapshot pins and colours are outside the tool's reach and pass through.
func ApplyContextOps(current api.ContextSpec, args prompts.UpdateContextArgs) api.ContextSpec {
	next := current
	switch args.WholeScope {
	case "full":
		next.WholeScope = api.WholeScopeFull
	case "pins":
		next.WholeScope = ""
	}
	next.FragmentIDs = applyPins(current.FragmentIDs, args.PinFragmentIDs, args.UnpinFragmentIDs)
	next.FragmentTypes = applyPins(current.FragmentTypes, args.PinFragmentTypes, args.UnpinFragmentTypes)
	return next
}

func applyPins(current, pin, unpin []string) []string {
	drop := make(map[string]bool, len(unpin))
	for _, id := range unpin {
		drop[id] = true
	}
	var out []string
	seen := make(map[string]bool, len(current)+len(pin))
	for _, id := range append(append([]string{}, current...), pin...) {
		if id == "" || seen[id] || drop[id] {
			continue
		}
		seen[id] = true
		out = append(out, id)
	}
	return out
}

// IsContextConfirmed reports a send that carries the user's acceptance of a
// proposed context change and no user text.
func IsContextConfirmed(newMsgs []api.UIMessage) bool {
	return HasSystemOnlyPart(newMsgs, prompts.ContextConfirmPartType)
}

// IsContextCancelled reports a send that carries the user's refusal of a
// proposed context change and no user text.
func IsContextCancelled(newMsgs []api.UIMessage) bool {
	return HasSystemOnlyPart(newMsgs, prompts.ContextCancelPartType)
}

// HasSystemOnlyPart reports whether newMsgs contains no user turn and at least
// one system message carrying a part of type partType.
func HasSystemOnlyPart(newMsgs []api.UIMessage, partType string) bool {
	found := false
	for _, m := range newMsgs {
		if m.Role == "user" {
			return false
		}
		if m.Role != "system" {
			continue
		}
		for _, p := range m.Parts {
			if p.Type == partType {
				found = true
			}
		}
	}
	return found
}

// ExtractSuggestedName returns the first non-blank suggest_name call argument.
func ExtractSuggestedName(toolCalls []llm.ToolCall) string {
	for _, tc := range toolCalls {
		if tc.Name == prompts.SuggestNameToolName {
			var args struct {
				Name string `json:"name"`
			}
			if json.Unmarshal(tc.Args, &args) == nil && strings.TrimSpace(args.Name) != "" {
				return strings.TrimSpace(args.Name)
			}
		}
	}
	return ""
}

// JSONStringChunk escapes one streamed text chunk for insertion into an
// in-progress JSON string literal (e.g. fabricated apply_result args stream).
func JSONStringChunk(s string) string {
	b, _ := json.Marshal(s)
	return string(b[1 : len(b)-1])
}

// StreamNameOnlyContinuation makes the follow-up model call for a turn that
// called suggest_name and nothing else, streaming its text into the open SSE
// response. Returns the text, or "" if the call failed or stayed silent.
func StreamNameOnlyContinuation(ctx context.Context, app core.App, sse *SSE, model string, msgs []llm.Message, turn AssistantTurn, textID string) string {
	names := make([]string, 0, len(turn.ToolCalls))
	for _, tc := range turn.ToolCalls {
		names = append(names, tc.Name)
	}
	msgs = append(msgs,
		llm.Message{Role: "assistant", Content: strings.TrimSpace(prompts.DiscoverEchoToolCalls(names))},
		llm.Message{Role: "user", Content: prompts.NameRecordedContinue})
	if err := llm.CheckPromptFits(model, llm.MessagesChars(msgs)); err != nil {
		slog.Default().With("component", "chat").Warn("continuation prompt too large", "error", err)
		return ""
	}
	comp, err := usage.Stream(ctx, app, llm.RoleRefinement, model, msgs, nil)
	if err != nil {
		slog.Default().With("component", "chat").Error("continuation failed", "error", err)
		return ""
	}
	return sse.StreamTurn(comp, textID+"-c1", nil).Text
}
