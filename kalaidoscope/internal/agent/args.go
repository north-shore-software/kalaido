package agent

import (
	"encoding/json"
	"strings"

	"github.com/north-shore-software/kalaido/kalaidoscope/llm"
)

// IDArg extracts a trimmed string "id" parameter from a tool call's JSON arguments.
func IDArg(call llm.ToolCall) string {
	var args struct {
		ID string `json:"id"`
	}
	_ = json.Unmarshal(call.Args, &args)
	return strings.TrimSpace(args.ID)
}

// IDsArg extracts a slice of string "ids" from a tool call's JSON arguments.
// If "ids" is empty but "id" is present, it returns a single-element slice containing "id".
func IDsArg(call llm.ToolCall) []string {
	var args struct {
		IDs []string `json:"ids"`
		ID  string   `json:"id"`
	}
	_ = json.Unmarshal(call.Args, &args)
	ids := args.IDs
	if len(ids) == 0 && strings.TrimSpace(args.ID) != "" {
		ids = []string{strings.TrimSpace(args.ID)}
	}
	return ids
}

// StrArg extracts a trimmed string argument by key from a tool call's JSON arguments.
func StrArg(call llm.ToolCall, key string) string {
	var args map[string]any
	if err := json.Unmarshal(call.Args, &args); err != nil {
		return ""
	}
	v, _ := args[key].(string)
	return strings.TrimSpace(v)
}
