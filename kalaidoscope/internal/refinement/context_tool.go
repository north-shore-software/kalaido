package refinement

import (
	"encoding/json"
	"strconv"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/api"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/prompts"
	"github.com/north-shore-software/kalaido/kalaidoscope/llm"
)

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
// proposed context change and no user text. The accepting message also
// carries the new `context_spec`, which the ordinary spec machinery
// resolves and announces; the turn then continues to the model so it can
// act on the context it asked for.
func IsContextConfirmed(newMsgs []api.UIMessage) bool {
	return hasSystemOnlyPart(newMsgs, prompts.ContextConfirmPartType)
}

// IsContextCancelled reports a send that carries the user's refusal of a
// proposed context change and no user text.
func IsContextCancelled(newMsgs []api.UIMessage) bool {
	return hasSystemOnlyPart(newMsgs, prompts.ContextCancelPartType)
}

func hasSystemOnlyPart(newMsgs []api.UIMessage, partType string) bool {
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
