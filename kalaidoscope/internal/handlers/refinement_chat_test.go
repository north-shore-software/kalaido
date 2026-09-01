package handlers

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"github.com/pocketbase/pocketbase/core"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/api"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/chat"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/pbutil"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/prompts"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/testutil"
	"github.com/north-shore-software/kalaido/kalaidoscope/llm"
)

// The parameter schemas are assembled by concatenation so the descriptions can
// live in the prompts package; a wording change there must not break the JSON.
func TestRefinementToolParametersAreValidJSON(t *testing.T) {
	if !json.Valid(updateLensTool.Parameters) {
		t.Fatalf("updateLensTool.Parameters is not valid JSON: %s", updateLensTool.Parameters)
	}
	if !json.Valid(suggestNameTool.Parameters) {
		t.Fatalf("suggestNameTool.Parameters is not valid JSON: %s", suggestNameTool.Parameters)
	}
}

// refineScript answers the turn's calls: the chat leg (its transcript opens
// with RefinementSystemPrompt) replies with a scripted tool call or plain
// text; every other call is the stateless apply leg.
type refineScript struct {
	mu         sync.Mutex
	applyCalls []string // the apply legs' opening user messages

	lens      string // when set, the chat leg emits an update_lens call for it
	chatText  string
	applyOut  string
	applyFail bool
}

func (s *refineScript) install(t *testing.T) {
	t.Helper()
	llm.SetActiveModelSet(llm.SetLocal)
	llm.SetProviderFactory(func(model string, cfg llm.WorkspaceConfig) llm.Provider {
		return refineScriptProvider{s}
	})
}

type refineScriptProvider struct{ s *refineScript }

func (p refineScriptProvider) ContextWindow() int { return 256_000 }

func (p refineScriptProvider) Stream(ctx context.Context, msgs []llm.Message, tools []llm.Tool, opts llm.GenOptions) (*llm.Completion, error) {
	isChat := msgs[0].Role == "system" && msgs[0].Content == prompts.RefinementSystemPrompt

	if !isChat {
		p.s.mu.Lock()
		p.s.applyCalls = append(p.s.applyCalls, msgs[0].Content)
		p.s.mu.Unlock()
		if p.s.applyFail {
			return nil, fmt.Errorf("scripted apply failure")
		}
		ch := make(chan llm.StreamEvent, 1)
		ch <- llm.StreamEvent{Kind: llm.EventText, Text: p.s.applyOut}
		close(ch)
		return &llm.Completion{Events: ch, Wait: func() *llm.Usage { return nil }}, nil
	}

	ch := make(chan llm.StreamEvent, 8)
	if p.s.chatText != "" {
		ch <- llm.StreamEvent{Kind: llm.EventText, Text: p.s.chatText}
	}
	if p.s.lens != "" {
		args, _ := json.Marshal(map[string]string{"lens": p.s.lens})
		ch <- llm.StreamEvent{Kind: llm.EventToolStart, ToolCallID: "tc-1", ToolName: prompts.UpdateLensToolName}
		ch <- llm.StreamEvent{Kind: llm.EventToolArgDelta, ToolCallID: "tc-1", Text: string(args)}
		ch <- llm.StreamEvent{Kind: llm.EventToolEnd, ToolCallID: "tc-1", ToolName: prompts.UpdateLensToolName, Args: args}
	}
	close(ch)
	return &llm.Completion{Events: ch, Wait: func() *llm.Usage { return nil }}, nil
}

// runRefinementTurn drives one full chat turn through HandleChatForRefinement
// and returns the raw SSE body and the persisted transcript.
func runRefinementTurn(t *testing.T, app core.App, refRec *core.Record, userText string) (string, []api.UIMessage) {
	t.Helper()
	return runRefinementTurnID(t, app, refRec, "user-1", userText)
}

// runRefinementTurnID is runRefinementTurn with an explicit user message id,
// for tests that send more than one turn into the same conversation.
func runRefinementTurnID(t *testing.T, app core.App, refRec *core.Record, msgID, userText string) (string, []api.UIMessage) {
	t.Helper()

	req := api.ChatRequest{
		ID: refRec.GetString("external_conversation_id"),
		Messages: []api.UIMessage{{
			ID:    msgID,
			Role:  "user",
			Parts: []api.UIMessagePart{{Type: "text", Text: userText}},
		}},
	}

	rec := httptest.NewRecorder()
	e := &core.RequestEvent{App: app}
	e.Request = httptest.NewRequest("POST", "/api/chat", nil)
	e.Response = rec

	if err := HandleChatForRefinement(app, req, refRec)(e); err != nil {
		t.Fatalf("handler: %v", err)
	}

	msgs, err := chat.LoadMessages(context.Background(), app, refRec)
	if err != nil {
		t.Fatalf("load messages: %v", err)
	}
	return rec.Body.String(), msgs
}

func assistantParts(t *testing.T, msgs []api.UIMessage) map[string]json.RawMessage {
	t.Helper()
	for i := len(msgs) - 1; i >= 0; i-- {
		if msgs[i].Role != "assistant" {
			continue
		}
		parts := map[string]json.RawMessage{}
		for _, p := range msgs[i].Parts {
			parts[p.Type] = p.Data
		}
		return parts
	}
	t.Fatal("no assistant message persisted")
	return nil
}

// A drafting turn streams the lens tool call, then the fabricated apply_result
// events — all before finish — and persists lens + apply on one message.
func TestRefinementTurnStreamsLensThenApply(t *testing.T) {
	app := testutil.NewApp(t)
	ref := newRefinement(t, app)
	script := &refineScript{lens: "THE LENS", applyOut: "THE APPLIED OUTPUT"}
	script.install(t)

	body, msgs := runRefinementTurn(t, app, ref, "make it a digest")

	applyStart := strings.Index(body, `"toolName":"`+prompts.ApplyResultToolName+`"`)
	finish := strings.Index(body, `"finish"`)
	if applyStart == -1 {
		t.Fatalf("no apply_result events in stream:\n%s", body)
	}
	if finish == -1 || finish < applyStart {
		t.Fatalf("apply_result events did not precede finish (apply=%d, finish=%d)", applyStart, finish)
	}

	// The streamed arg deltas must concatenate into the exact output JSON.
	var deltas strings.Builder
	for _, line := range strings.Split(body, "\n") {
		line = strings.TrimPrefix(line, "data: ")
		var ev struct {
			Type           string `json:"type"`
			ToolCallID     string `json:"toolCallId"`
			InputTextDelta string `json:"inputTextDelta"`
		}
		if json.Unmarshal([]byte(line), &ev) == nil && ev.Type == "tool-input-delta" && strings.HasPrefix(ev.ToolCallID, "apply-") {
			deltas.WriteString(ev.InputTextDelta)
		}
	}
	var streamed struct {
		Output string `json:"output"`
	}
	if err := json.Unmarshal([]byte(deltas.String()), &streamed); err != nil || streamed.Output != "THE APPLIED OUTPUT" {
		t.Errorf("apply deltas concatenate to %q (err %v), want the output JSON", deltas.String(), err)
	}

	parts := assistantParts(t, msgs)
	if _, ok := parts["tool-"+prompts.UpdateLensToolName]; !ok {
		t.Error("persisted turn is missing the lens part")
	}
	applyData, ok := parts["tool-"+prompts.ApplyResultToolName]
	if !ok {
		t.Fatal("persisted turn is missing the apply part")
	}
	var apply struct {
		Input struct {
			Output string `json:"output"`
		} `json:"input"`
	}
	if err := json.Unmarshal(applyData, &apply); err != nil || apply.Input.Output != "THE APPLIED OUTPUT" {
		t.Errorf("persisted apply output = %q (err %v)", apply.Input.Output, err)
	}

	script.mu.Lock()
	applies := len(script.applyCalls)
	script.mu.Unlock()
	if applies != 1 {
		t.Errorf("apply model calls = %d, want 1", applies)
	}
}

// persistedApplyOutput returns the apply_result output on the newest
// assistant message.
func persistedApplyOutput(t *testing.T, msgs []api.UIMessage) string {
	t.Helper()
	applyData, ok := assistantParts(t, msgs)["tool-"+prompts.ApplyResultToolName]
	if !ok {
		t.Fatal("persisted turn is missing the apply part")
	}
	var apply struct {
		Input struct {
			Output string `json:"output"`
		} `json:"input"`
	}
	if err := json.Unmarshal(applyData, &apply); err != nil {
		t.Fatalf("apply part: %v", err)
	}
	return apply.Input.Output
}

// assertAppliesFromScratch checks that every apply leg was a bare ApplyPrompt
// — never the delta/merge continuation that minimizes against a previous
// output, which would erase the form changes a redrafted lens exists to make.
func assertAppliesFromScratch(t *testing.T, script *refineScript, want int) {
	t.Helper()
	script.mu.Lock()
	calls := append([]string(nil), script.applyCalls...)
	script.mu.Unlock()
	if len(calls) != want {
		t.Fatalf("apply model calls = %d, want %d", len(calls), want)
	}
	for i, c := range calls {
		if !strings.HasPrefix(c, "Source Documents") {
			t.Errorf("apply call %d does not open with the apply prompt: %.60q", i, c)
		}
		if strings.Contains(c, "Previously published version") {
			t.Errorf("apply call %d minimizes against a previous output", i)
		}
	}
}

// A second drafting turn applies its redrafted lens from scratch: the previous
// turn's preview is not an anchor, so the persisted output is exactly what the
// new lens produced.
func TestRefinementSecondTurnAppliesFromScratch(t *testing.T) {
	app := testutil.NewApp(t)
	ref := newRefinement(t, app)
	script := &refineScript{lens: "LENS ONE", applyOut: "LONG STRUCTURED OUTPUT"}
	script.install(t)

	_, msgs := runRefinementTurnID(t, app, ref, "user-1", "I want all of the personas")
	if got := persistedApplyOutput(t, msgs); got != "LONG STRUCTURED OUTPUT" {
		t.Fatalf("first turn output = %q", got)
	}

	script.mu.Lock()
	script.lens, script.applyOut = "LENS TWO", "SHORT FLAT OUTPUT"
	script.mu.Unlock()

	_, msgs = runRefinementTurnID(t, app, ref, "user-2", "much more concise, no grouping")
	if got := persistedApplyOutput(t, msgs); got != "SHORT FLAT OUTPUT" {
		t.Errorf("second turn output = %q, want the redrafted lens's raw output", got)
	}
	assertAppliesFromScratch(t, script, 2)
}

// Refining an existing snapshot: its published output is what the user is
// looking at, but it is not an anchor for the first preview either — the lens
// being drafted differs from the one that produced it.
func TestRefinementOfExistingSnapshotAppliesFromScratch(t *testing.T) {
	app := testutil.NewApp(t)
	ref := newRefinement(t, app)
	snap := testutil.NewRecord(t, app, "projection_snapshot", map[string]any{
		"projection_id": ref.GetString("projection_id"),
		"status":        "approved",
		"output":        pbutil.JSONString("PUBLISHED OUTPUT"),
	})
	ref.Set("projection_snapshot_id", snap.Id)
	if err := app.Save(ref); err != nil {
		t.Fatal(err)
	}
	script := &refineScript{lens: "NEW LENS", applyOut: "NEW OUTPUT"}
	script.install(t)

	_, msgs := runRefinementTurn(t, app, ref, "make it a digest")
	if got := persistedApplyOutput(t, msgs); got != "NEW OUTPUT" {
		t.Errorf("output = %q, want the new lens's raw output", got)
	}
	assertAppliesFromScratch(t, script, 1)
}

// A clarify turn (no lens) performs no apply at all.
func TestRefinementClarifyTurnSkipsApply(t *testing.T) {
	app := testutil.NewApp(t)
	ref := newRefinement(t, app)
	script := &refineScript{chatText: "Cut the third bullet — do you mean the invoice material?"}
	script.install(t)

	body, msgs := runRefinementTurn(t, app, ref, "cut the third bullet")

	if strings.Contains(body, prompts.ApplyResultToolName) {
		t.Error("clarify turn streamed apply events")
	}
	parts := assistantParts(t, msgs)
	if _, ok := parts["tool-"+prompts.ApplyResultToolName]; ok {
		t.Error("clarify turn persisted an apply part")
	}
	script.mu.Lock()
	applies := len(script.applyCalls)
	script.mu.Unlock()
	if applies != 0 {
		t.Errorf("apply model calls = %d, want 0", applies)
	}
}

// A count-pinned lens surfaces the lint to the user — streamed and persisted —
// and the apply still runs.
func TestRefinementCountPinnedLensSurfacesLint(t *testing.T) {
	app := testutil.NewApp(t)
	ref := newRefinement(t, app)
	script := &refineScript{lens: "Capture all use cases (8 in total).", applyOut: "OUT"}
	script.install(t)

	body, msgs := runRefinementTurn(t, app, ref, "make it a digest")

	if !strings.Contains(body, `"type":"data-refine_lint"`) {
		t.Error("lint data part not streamed")
	}
	parts := assistantParts(t, msgs)
	lintData, ok := parts["data-refine_lint"]
	if !ok {
		t.Fatal("lint part not persisted")
	}
	var lint struct {
		Match string `json:"match"`
	}
	if err := json.Unmarshal(lintData, &lint); err != nil || !strings.Contains(lint.Match, "8 in total") {
		t.Errorf("lint match = %q (err %v)", lint.Match, err)
	}
	if _, ok := parts["tool-"+prompts.ApplyResultToolName]; !ok {
		t.Error("apply part missing — the lint must not block the apply")
	}
}

// A failed apply persists an error notice and no apply part: the preview keeps
// its prior output and the commit path refuses the un-previewed lens.
func TestRefinementApplyFailurePersistsErrorNotice(t *testing.T) {
	app := testutil.NewApp(t)
	ref := newRefinement(t, app)
	script := &refineScript{lens: "THE LENS", applyFail: true}
	script.install(t)

	body, msgs := runRefinementTurn(t, app, ref, "make it a digest")

	if !strings.Contains(body, `"type":"data-refine_error"`) {
		t.Error("error data part not streamed")
	}
	if strings.Contains(body, "tool-input-available") && strings.Contains(body, prompts.ApplyResultToolName+`","input"`) {
		t.Error("a failed apply must not emit tool-input-available")
	}
	parts := assistantParts(t, msgs)
	if _, ok := parts["data-refine_error"]; !ok {
		t.Error("error part not persisted")
	}
	if _, ok := parts["tool-"+prompts.ApplyResultToolName]; ok {
		t.Error("failed apply persisted an apply part")
	}
	if _, ok := parts["tool-"+prompts.UpdateLensToolName]; !ok {
		t.Error("the lens part must survive an apply failure")
	}
}
