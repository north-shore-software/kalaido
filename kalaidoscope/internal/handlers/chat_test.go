package handlers

import (
	"context"
	"encoding/json"
	"errors"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/router"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/api"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/chat"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/prompts"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/testutil"
	"github.com/north-shore-software/kalaido/kalaidoscope/llm"
)

// chatScript is the chat's scripted model. Given tools and a fragment id it
// has not read yet, it calls read_fragment for it; otherwise it answers in
// text. It records the tool count and transcript of every call.
type chatScript struct {
	mu         sync.Mutex
	readID     string
	window     int
	toolCounts []int
	calls      [][]llm.Message
	read       bool
}

func (s *chatScript) install(t *testing.T) {
	t.Helper()
	llm.SetActiveModelSet(llm.SetLocal)
	llm.SetProviderFactory(func(model string, cfg llm.WorkspaceConfig) llm.Provider {
		return chatScriptProvider{s}
	})
}

type chatScriptProvider struct{ s *chatScript }

func (p chatScriptProvider) ContextWindow() int {
	if p.s.window > 0 {
		return p.s.window
	}
	return 256_000
}

func (p chatScriptProvider) Stream(ctx context.Context, msgs []llm.Message, tools []llm.Tool, opts llm.GenOptions) (*llm.Completion, error) {
	p.s.mu.Lock()
	defer p.s.mu.Unlock()
	p.s.toolCounts = append(p.s.toolCounts, len(tools))
	p.s.calls = append(p.s.calls, append([]llm.Message(nil), msgs...))

	ch := make(chan llm.StreamEvent, 8)
	if len(tools) > 0 && !p.s.read {
		p.s.read = true
		args, _ := json.Marshal(map[string][]string{"ids": {p.s.readID}})
		ch <- llm.StreamEvent{Kind: llm.EventText, Text: "Let me check."}
		ch <- llm.StreamEvent{Kind: llm.EventToolStart, ToolCallID: "tc-1", ToolName: prompts.ReadFragmentToolName}
		ch <- llm.StreamEvent{Kind: llm.EventToolArgDelta, ToolCallID: "tc-1", Text: string(args)}
		ch <- llm.StreamEvent{Kind: llm.EventToolEnd, ToolCallID: "tc-1", ToolName: prompts.ReadFragmentToolName, Args: args}
	} else {
		ch <- llm.StreamEvent{Kind: llm.EventText, Text: "THE ANSWER"}
	}
	close(ch)
	return &llm.Completion{Events: ch, Wait: func() *llm.Usage { return nil }}, nil
}

// runChatTurn drives one plain chat turn: an optional context_spec system
// message followed by the user's text.
func runChatTurn(t *testing.T, app core.App, convID string, spec *api.ContextSpec, userText string) (string, error) {
	t.Helper()
	var msgs []api.UIMessage
	if spec != nil {
		b, _ := json.Marshal(spec)
		msgs = append(msgs, api.UIMessage{ID: convID + "-spec", Role: "system", Parts: []api.UIMessagePart{{Type: "context_spec", Data: b}}})
	}
	msgs = append(msgs, api.UIMessage{ID: convID + "-user", Role: "user", Parts: []api.UIMessagePart{{Type: "text", Text: userText}}})

	body, _ := json.Marshal(api.ChatRequest{ID: convID, Messages: msgs})
	rec := httptest.NewRecorder()
	e := &core.RequestEvent{App: app}
	e.Request = httptest.NewRequest("POST", "/api/chat", strings.NewReader(string(body)))
	e.Request.Header.Set("Content-Type", "application/json")
	e.Response = rec
	err := HandleChat(app, nil)(e)
	return rec.Body.String(), err
}

func persistedChat(t *testing.T, app core.App, convID string) []api.UIMessage {
	t.Helper()
	conv, err := chat.FindOrCreateConversation(context.Background(), app, convID)
	if err != nil {
		t.Fatal(err)
	}
	msgs, err := chat.LoadMessages(context.Background(), app, conv)
	if err != nil {
		t.Fatal(err)
	}
	return msgs
}

// Full mode is untouched: no tools, one text turn.
func TestChatFullModeHasNoTools(t *testing.T) {
	app := testutil.NewApp(t)
	frag := testutil.NewRecord(t, app, "fragment", map[string]any{"type": "note", "content": "BODY"})
	script := &chatScript{readID: frag.Id}
	script.install(t)

	body, err := runChatTurn(t, app, "conv-full", &api.ContextSpec{WholeScope: true}, "hi")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(body, "THE ANSWER") || strings.Contains(body, "tool-input") {
		t.Errorf("full mode stream:\n%s", body)
	}
	if len(script.toolCounts) != 1 || script.toolCounts[0] != 0 {
		t.Errorf("tool counts = %v, want [0]", script.toolCounts)
	}
}

// Summaries mode: the model gets the read tools and rows, its read streams as
// a tool part with its output before a second text turn, the persisted
// message carries the read with its output, and the second model call saw the
// echo plus the read body as a user turn.
func TestChatSummariesModeReadsThenAnswers(t *testing.T) {
	app := testutil.NewApp(t)
	frag := testutil.NewRecord(t, app, "fragment", map[string]any{"type": "note", "content": "THE SECRET BODY"})
	testutil.NewRecord(t, app, "fragment_annotation", map[string]any{
		"fragment_id": frag.Id, "title": "A note", "summary": "It hides a secret.",
	})
	script := &chatScript{readID: frag.Id}
	script.install(t)

	body, err := runChatTurn(t, app, "conv-sum", &api.ContextSpec{WholeScope: true, Summaries: true}, "what is the secret?")
	if err != nil {
		t.Fatal(err)
	}

	inputAvail := strings.Index(body, `"tool-input-available"`)
	outputAvail := strings.Index(body, `"tool-output-available"`)
	answer := strings.Index(body, "THE ANSWER")
	finish := strings.Index(body, `"finish"`)
	if inputAvail == -1 || outputAvail == -1 || answer == -1 || finish == -1 ||
		!(inputAvail < outputAvail && outputAvail < answer && answer < finish) {
		t.Fatalf("stream order wrong (input=%d output=%d answer=%d finish=%d):\n%s", inputAvail, outputAvail, answer, finish, body)
	}
	if strings.Count(body, `"text-start"`) != 2 {
		t.Errorf("want two text segments with distinct ids:\n%s", body)
	}

	if len(script.toolCounts) != 2 || script.toolCounts[0] != 2 {
		t.Fatalf("tool counts = %v, want [2 n]", script.toolCounts)
	}
	first := script.calls[0]
	if !strings.Contains(first[0].Content, prompts.ChatSummariesLegend) {
		t.Error("first call lacks the summaries system prompt")
	}
	if strings.Contains(first[1].Content, "THE SECRET BODY") || !strings.Contains(first[1].Content, "A note") {
		t.Errorf("context turn should be rows, not bodies: %q", first[1].Content)
	}
	second := script.calls[1]
	echo, results := second[len(second)-2], second[len(second)-1]
	if echo.Role != "assistant" || !strings.Contains(echo.Content, prompts.DiscoverEchoToolCalls([]string{prompts.ReadFragmentToolName})) {
		t.Errorf("second call lacks the echo turn: %+v", echo)
	}
	if results.Role != "user" || !strings.Contains(results.Content, "THE SECRET BODY") {
		t.Errorf("second call lacks the read body: %+v", results)
	}

	msgs := persistedChat(t, app, "conv-sum")
	last := msgs[len(msgs)-1]
	if last.Role != "assistant" {
		t.Fatalf("last persisted message is %s", last.Role)
	}
	var types []string
	var output string
	for _, p := range last.Parts {
		types = append(types, p.Type)
		if p.Type == "tool-"+prompts.ReadFragmentToolName {
			var data struct {
				Output string `json:"output"`
			}
			_ = json.Unmarshal(p.Data, &data)
			output = data.Output
		}
	}
	if strings.Join(types, ",") != "text,tool-"+prompts.ReadFragmentToolName+",text" {
		t.Errorf("persisted parts = %v", types)
	}
	if !strings.Contains(output, "THE SECRET BODY") {
		t.Errorf("persisted read lacks its output: %q", output)
	}
}

// An oversized prompt is refused up front with a 422; only full mode adds the
// hint to switch to summaries.
func TestChatRefusesOversizedPrompt(t *testing.T) {
	app := testutil.NewApp(t)
	frag := testutil.NewRecord(t, app, "fragment", map[string]any{"type": "note", "content": "BODY"})
	script := &chatScript{readID: frag.Id, window: 100}
	script.install(t)

	for _, tc := range []struct {
		name string
		spec api.ContextSpec
		hint bool
	}{
		{"full", api.ContextSpec{WholeScope: true}, true},
		{"summaries", api.ContextSpec{WholeScope: true, Summaries: true}, false},
	} {
		_, err := runChatTurn(t, app, "conv-big-"+tc.name, &tc.spec, "hi")
		var apiErr *router.ApiError
		if err == nil || !errors.As(err, &apiErr) || apiErr.Status != 422 {
			t.Fatalf("%s: err = %v, want 422", tc.name, err)
		}
		if strings.Contains(apiErr.Message, chatTooLargeHint) != tc.hint {
			t.Errorf("%s: hint present = %v, want %v: %q", tc.name, !tc.hint, tc.hint, apiErr.Message)
		}
	}
	if len(script.toolCounts) != 0 {
		t.Errorf("model was called %d times despite the guard", len(script.toolCounts))
	}
}
