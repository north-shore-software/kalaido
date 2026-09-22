package agent

import (
	"context"
	"encoding/json"
	"errors"
	"testing"

	"github.com/north-shore-software/kalaido/kalaidoscope/llm"
)

func TestArgs(t *testing.T) {
	tc1 := llm.ToolCall{
		Name: "read_thing",
		Args: json.RawMessage(`{"id": "thing-1"}`),
	}
	if got := IDArg(tc1); got != "thing-1" {
		t.Fatalf("IDArg: expected thing-1, got %q", got)
	}

	tc2 := llm.ToolCall{
		Name: "read_things",
		Args: json.RawMessage(`{"ids": ["a", "b"]}`),
	}
	ids := IDsArg(tc2)
	if len(ids) != 2 || ids[0] != "a" || ids[1] != "b" {
		t.Fatalf("IDsArg: expected [a, b], got %v", ids)
	}

	// Fallback from id to ids
	tc3 := llm.ToolCall{
		Name: "read_things",
		Args: json.RawMessage(`{"id": "single"}`),
	}
	ids3 := IDsArg(tc3)
	if len(ids3) != 1 || ids3[0] != "single" {
		t.Fatalf("IDsArg fallback: expected [single], got %v", ids3)
	}

	tc4 := llm.ToolCall{
		Name: "finish",
		Args: json.RawMessage(`{"summary": "all done"}`),
	}
	if got := StrArg(tc4, "summary"); got != "all done" {
		t.Fatalf("StrArg: expected 'all done', got %q", got)
	}
}

func TestTurnFormatting(t *testing.T) {
	// No tool calls
	msg1 := FormatAssistantEcho("hello world", nil)
	if msg1.Content != "hello world" {
		t.Fatalf("expected 'hello world', got %q", msg1.Content)
	}

	// With tool calls
	calls := []llm.ToolCall{
		{Name: "read_thing"},
		{Name: "read_fragment"},
	}
	msg2 := FormatAssistantEcho("let me check", calls)
	expected := "let me check\n\n[You called: read_thing, read_fragment]"
	if msg2.Content != expected {
		t.Fatalf("expected %q, got %q", expected, msg2.Content)
	}

	// Format results
	res := FormatToolResults([]string{"out1", "out2"})
	if res.Content != "out1\n\nout2" {
		t.Fatalf("expected out1\\n\\nout2, got %q", res.Content)
	}
}

func TestRunner_NoToolCalls(t *testing.T) {
	msgs := []llm.Message{{Role: "user", Content: "hi"}}
	var endedRound int
	runner := Runner{
		MaxRounds: 5,
		Generate: func(ctx context.Context, msgs []llm.Message, round int) (Turn, error) {
			return Turn{Text: "simple reply", ToolCalls: nil}, nil
		},
		OnRoundEnd: func(ctx context.Context, round int) {
			endedRound = round
		},
	}

	err := runner.Run(context.Background(), &msgs)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(msgs) != 2 || msgs[1].Content != "simple reply" {
		t.Fatalf("expected 2 messages, got %v", msgs)
	}
	if endedRound != 0 {
		t.Fatalf("expected endedRound 0, got %d", endedRound)
	}
}

func TestRunner_MultiRoundAndFinish(t *testing.T) {
	msgs := []llm.Message{{Role: "user", Content: "start"}}
	roundsCalled := 0

	runner := Runner{
		MaxRounds: 5,
		Generate: func(ctx context.Context, msgs []llm.Message, round int) (Turn, error) {
			roundsCalled++
			if round == 0 {
				return Turn{
					Text: "reading data",
					ToolCalls: []llm.ToolCall{
						{ID: "c1", Name: "read_frag", Args: json.RawMessage(`{"id": "f1"}`)},
					},
				}, nil
			}
			return Turn{
				Text: "summary is complete",
				ToolCalls: []llm.ToolCall{
					{ID: "c2", Name: "finish"},
				},
			}, nil
		},
		Dispatch: func(ctx context.Context, call llm.ToolCall) (string, bool, error) {
			if call.Name == "read_frag" {
				return "frag content", false, nil
			}
			if call.Name == "finish" {
				return "", true, nil
			}
			return "", false, nil
		},
	}

	err := runner.Run(context.Background(), &msgs)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if roundsCalled != 2 {
		t.Fatalf("expected 2 rounds, got %d", roundsCalled)
	}
	// msgs should be:
	// 0: user (start)
	// 1: assistant (reading data + echo)
	// 2: user (frag content)
	// 3: assistant (summary is complete + echo finish)
	if len(msgs) != 4 {
		t.Fatalf("expected 4 messages, got %d", len(msgs))
	}
}

func TestRunner_StopBeforeLastDispatch(t *testing.T) {
	msgs := []llm.Message{{Role: "user", Content: "start"}}
	dispatched := false

	runner := Runner{
		MaxRounds:              1,
		StopBeforeLastDispatch: true,
		Generate: func(ctx context.Context, msgs []llm.Message, round int) (Turn, error) {
			return Turn{
				Text: "calling tool",
				ToolCalls: []llm.ToolCall{
					{ID: "c1", Name: "tool"},
				},
			}, nil
		},
		Dispatch: func(ctx context.Context, call llm.ToolCall) (string, bool, error) {
			dispatched = true
			return "out", false, nil
		},
	}

	err := runner.Run(context.Background(), &msgs)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if dispatched {
		t.Fatal("expected tool not to be dispatched when StopBeforeLastDispatch is true on final round")
	}
}

func TestRunner_PromptGuard(t *testing.T) {
	msgs := []llm.Message{{Role: "user", Content: "start"}}
	errBoom := errors.New("context too large")

	runner := Runner{
		MaxRounds: 5,
		Generate: func(ctx context.Context, msgs []llm.Message, round int) (Turn, error) {
			return Turn{
				Text: "calling tool",
				ToolCalls: []llm.ToolCall{
					{ID: "c1", Name: "tool"},
				},
			}, nil
		},
		Dispatch: func(ctx context.Context, call llm.ToolCall) (string, bool, error) {
			return "huge output", false, nil
		},
		PromptGuard: func(msgs []llm.Message) error {
			return errBoom
		},
	}

	err := runner.Run(context.Background(), &msgs)
	if !errors.Is(err, errBoom) {
		t.Fatalf("expected errBoom, got %v", err)
	}
}
