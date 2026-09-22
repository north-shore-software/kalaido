package agent_test

import (
	"context"
	"errors"
	"testing"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/agent"
	"github.com/north-shore-software/kalaido/kalaidoscope/llm"
)

func TestRegistry_ToolsAndDispatch(t *testing.T) {
	ctx := context.Background()

	t1 := agent.EmptyTool("tool_1", "first tool")
	t2 := agent.IDTool("tool_2", "second tool", "id", "an id")

	var reg agent.Registry
	reg.Register(t1, func(ctx context.Context, call llm.ToolCall) (string, bool, error) {
		return "output_1", false, nil
	})
	reg.Register(t2, func(ctx context.Context, call llm.ToolCall) (string, bool, error) {
		id := agent.IDArg(call)
		if id == "done" {
			return "done_output", true, nil
		}
		if id == "error" {
			return "", false, errors.New("boom")
		}
		return "output_2:" + id, false, nil
	})

	tools := reg.Tools()
	if len(tools) != 2 {
		t.Fatalf("expected 2 tools, got %d", len(tools))
	}
	if tools[0].Name != "tool_1" || tools[1].Name != "tool_2" {
		t.Fatalf("unexpected tool names: %v, %v", tools[0].Name, tools[1].Name)
	}

	// 1. Matched call
	out, done, handled, err := reg.Dispatch(ctx, llm.ToolCall{Name: "tool_1"})
	if err != nil || !handled || done || out != "output_1" {
		t.Errorf("unexpected result for tool_1: out=%q, done=%v, handled=%v, err=%v", out, done, handled, err)
	}

	// 2. Matched with arguments and done
	out, done, handled, err = reg.Dispatch(ctx, llm.ToolCall{Name: "tool_2", Args: []byte(`{"id":"done"}`)})
	if err != nil || !handled || !done || out != "done_output" {
		t.Errorf("unexpected result for tool_2 done: out=%q, done=%v, handled=%v, err=%v", out, done, handled, err)
	}

	// 3. Matched with error
	out, done, handled, err = reg.Dispatch(ctx, llm.ToolCall{Name: "tool_2", Args: []byte(`{"id":"error"}`)})
	if err == nil || !handled {
		t.Errorf("expected error for tool_2 error: handled=%v, err=%v", handled, err)
	}

	// 4. Unhandled call
	out, done, handled, err = reg.Dispatch(ctx, llm.ToolCall{Name: "unknown"})
	if err != nil || handled || done || out != "" {
		t.Errorf("unexpected result for unknown tool: out=%q, done=%v, handled=%v, err=%v", out, done, handled, err)
	}
}

func TestRegistry_Dispatcher(t *testing.T) {
	ctx := context.Background()

	t1 := agent.EmptyTool("tool_1", "first tool")
	reg := agent.Registry{
		{
			Tool: t1,
			Handler: func(ctx context.Context, call llm.ToolCall) (string, bool, error) {
				return "handled_1", false, nil
			},
		},
	}

	fallbackCalled := false
	dispatcher := reg.Dispatcher(func(ctx context.Context, call llm.ToolCall) (string, bool, error) {
		fallbackCalled = true
		return "fallback:" + call.Name, false, nil
	})

	out, done, err := dispatcher(ctx, llm.ToolCall{Name: "tool_1"})
	if err != nil || done || out != "handled_1" || fallbackCalled {
		t.Errorf("unexpected result for handled tool: out=%q, fallback=%v, err=%v", out, fallbackCalled, err)
	}

	out, done, err = dispatcher(ctx, llm.ToolCall{Name: "other_tool"})
	if err != nil || done || out != "fallback:other_tool" || !fallbackCalled {
		t.Errorf("unexpected result for fallback tool: out=%q, fallback=%v, err=%v", out, fallbackCalled, err)
	}

	// Dispatcher without fallback
	dispatcherNoFallback := reg.Dispatcher(nil)
	out, done, err = dispatcherNoFallback(ctx, llm.ToolCall{Name: "unregistered"})
	if err != nil || done || out != "" {
		t.Errorf("unexpected result without fallback: out=%q, done=%v, err=%v", out, done, err)
	}
}
