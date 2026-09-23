package agent

import (
	"context"
	"encoding/json"
	"strconv"

	"github.com/north-shore-software/kalaido/kalaidoscope/llm"
)

// HandlerFunc executes a single tool call.
// Returning done=true signals that the agent loop should complete after this round.
type HandlerFunc func(ctx context.Context, call llm.ToolCall) (output string, done bool, err error)

// BoundTool pairs an LLM tool definition with its execution handler.
type BoundTool struct {
	Tool    llm.Tool
	Handler HandlerFunc
}

// Registry is a collection of bound tools.
type Registry []BoundTool

// Register appends a new tool and its handler to the registry.
func (r *Registry) Register(tool llm.Tool, handler HandlerFunc) {
	*r = append(*r, BoundTool{Tool: tool, Handler: handler})
}

// Tools returns the llm.Tool definitions for all bound tools in the registry.
func (r Registry) Tools() []llm.Tool {
	tools := make([]llm.Tool, len(r))
	for i, bt := range r {
		tools[i] = bt.Tool
	}
	return tools
}

// Dispatch executes the handler for call.Name if found in the registry.
// It returns handled=true if a matching tool was found and executed.
func (r Registry) Dispatch(ctx context.Context, call llm.ToolCall) (output string, done bool, handled bool, err error) {
	for _, bt := range r {
		if bt.Tool.Name == call.Name {
			if bt.Handler == nil {
				return "", false, true, nil
			}
			out, d, err := bt.Handler(ctx, call)
			return out, d, true, err
		}
	}
	return "", false, false, nil
}

// Dispatcher returns a Dispatch function compatible with Runner.Dispatch.
// If an unhandled tool is called, fallback is invoked; if fallback is nil,
// it returns an empty string without an error.
func (r Registry) Dispatcher(fallback func(ctx context.Context, call llm.ToolCall) (string, bool, error)) func(ctx context.Context, call llm.ToolCall) (string, bool, error) {
	return func(ctx context.Context, call llm.ToolCall) (string, bool, error) {
		out, done, handled, err := r.Dispatch(ctx, call)
		if handled {
			return out, done, err
		}
		if fallback != nil {
			return fallback(ctx, call)
		}
		return "", false, nil
	}
}

func IDTool(name, description, param, paramDescription string) llm.Tool {
	return llm.Tool{
		Name:        name,
		Description: description,
		Parameters: json.RawMessage(`{"type":"object","properties":{"` + param + `":{"type":"string","description":` +
			strconv.Quote(paramDescription) + `}},"required":["` + param + `"]}`),
	}
}

func IDsTool(name, description, paramDescription string) llm.Tool {
	return llm.Tool{
		Name:        name,
		Description: description,
		Parameters: json.RawMessage(`{"type":"object","properties":{"ids":{"type":"array","items":{"type":"string"},"description":` +
			strconv.Quote(paramDescription) + `}},"required":["ids"]}`),
	}
}

func EmptyTool(name, description string) llm.Tool {
	return llm.Tool{Name: name, Description: description, Parameters: json.RawMessage(`{"type":"object","properties":{}}`)}
}

func StringArraySchema(description string) string {
	return `{"type":"array","items":{"type":"string"},"description":` + strconv.Quote(description) + `}`
}
