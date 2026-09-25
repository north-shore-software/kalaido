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
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/engine"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/pbutil"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/prompts"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/testutil"
	"github.com/north-shore-software/kalaido/kalaidoscope/llm"
	"github.com/north-shore-software/kalaido/kalaidoscope/schema"
)

// refineScript answers the turn's calls: the chat leg (its transcript opens
// with a refinement prompt) replies with a scripted tool call or plain
// text; every other call is the stateless apply leg.
type refineScript struct {
	mu         sync.Mutex
	applyCalls []string // the apply legs' opening user messages

	lens      string // when set, the chat leg emits an update_lens call for it
	chatText  string
	applyOut  string
	applyFail bool

	// suggestName, when set, makes the first chat leg emit a bare suggest_name
	// call (no text) — the shape Gemini returns on a question turn.
	// continueText is what the continuation leg (no tools advertised) says.
	suggestName       string
	continueText      string
	chatCalls         int
	refineTarget      string
	refineReplacement string
	chatHistory       [][]llm.Message
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
	if msgs[0].Role == "system" && msgs[0].Content == prompts.LensCompilerSystemPrompt {
		ch := make(chan llm.StreamEvent, 1)
		ch <- llm.StreamEvent{Kind: llm.EventText, Text: p.s.lens}
		close(ch)
		return &llm.Completion{Events: ch, Wait: func() *llm.Usage { return nil }}, nil
	}

	isChat := msgs[0].Role == "system" && (msgs[0].Content == prompts.RefinementCreationPrompt || msgs[0].Content == prompts.RefinementRevisionPrompt)

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

	p.s.mu.Lock()
	p.s.chatCalls++
	p.s.chatHistory = append(p.s.chatHistory, msgs)
	continuation := p.s.suggestName != "" && p.s.chatCalls > 1
	p.s.mu.Unlock()

	ch := make(chan llm.StreamEvent, 8)
	if continuation {
		if len(tools) != 0 {
			panic("continuation leg advertised tools")
		}
		ch <- llm.StreamEvent{Kind: llm.EventText, Text: p.s.continueText}
		close(ch)
		return &llm.Completion{Events: ch, Wait: func() *llm.Usage { return nil }}, nil
	}
	if p.s.suggestName != "" {
		args, _ := json.Marshal(map[string]string{"name": p.s.suggestName})
		ch <- llm.StreamEvent{Kind: llm.EventToolStart, ToolCallID: "tc-n", ToolName: prompts.SuggestNameToolName}
		ch <- llm.StreamEvent{Kind: llm.EventToolEnd, ToolCallID: "tc-n", ToolName: prompts.SuggestNameToolName, Args: args}
	}
	if p.s.chatText != "" {
		ch <- llm.StreamEvent{Kind: llm.EventText, Text: p.s.chatText}
	}
	if p.s.refineTarget != "" || p.s.refineReplacement != "" {
		args, _ := json.Marshal(prompts.RefineCandidateArgs{
			Target:      p.s.refineTarget,
			Replacement: p.s.refineReplacement,
		})
		ch <- llm.StreamEvent{Kind: llm.EventToolStart, ToolCallID: "tc-refine", ToolName: prompts.RefineCandidateToolName}
		ch <- llm.StreamEvent{Kind: llm.EventToolEnd, ToolCallID: "tc-refine", ToolName: prompts.RefineCandidateToolName, Args: args}
	}
	if p.s.lens != "" {
		args, _ := json.Marshal(map[string]string{"directive": p.s.lens})
		ch <- llm.StreamEvent{Kind: llm.EventToolStart, ToolCallID: "tc-1", ToolName: prompts.UpdateLensToolName}
		ch <- llm.StreamEvent{Kind: llm.EventToolArgDelta, ToolCallID: "tc-1", Text: string(args)}
		ch <- llm.StreamEvent{Kind: llm.EventToolEnd, ToolCallID: "tc-1", ToolName: prompts.UpdateLensToolName, Args: args}

		ch <- llm.StreamEvent{Kind: llm.EventToolStart, ToolCallID: "tc-2", ToolName: prompts.RegenerateFromLensToolName}
		ch <- llm.StreamEvent{Kind: llm.EventToolEnd, ToolCallID: "tc-2", ToolName: prompts.RegenerateFromLensToolName, Args: []byte("{}")}
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
		"output":        "PUBLISHED OUTPUT",
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

// A question turn that arrives as a bare suggest_name call (no text — the shape
// Gemini returns with a function call) gets one continuation call with no
// tools, and its text lands on the same assistant message beside the name.
func TestRefinementNameOnlyTurnContinuesForText(t *testing.T) {
	app := testutil.NewApp(t)
	ref := newRefinement(t, app)
	script := &refineScript{
		suggestName:  "Feature Overview",
		continueText: "One entry per feature, or grouped by the page they live on?",
	}
	script.install(t)

	body, msgs := runRefinementTurn(t, app, ref, "list the features")

	if !strings.Contains(body, "grouped by the page") {
		t.Error("continuation text was not streamed")
	}
	if strings.Contains(body, prompts.ApplyResultToolName) {
		t.Error("name-only turn streamed apply events")
	}
	parts := assistantParts(t, msgs)
	if _, ok := parts["tool-"+prompts.SuggestNameToolName]; !ok {
		t.Error("suggest_name part not persisted")
	}
	var text string
	for i := len(msgs) - 1; i >= 0; i-- {
		if msgs[i].Role != "assistant" {
			continue
		}
		for _, p := range msgs[i].Parts {
			if p.Type == "text" {
				text = p.Text
			}
		}
		break
	}
	if text != script.continueText {
		t.Errorf("persisted text = %q, want the continuation text", text)
	}
	script.mu.Lock()
	chatCalls, applies := script.chatCalls, len(script.applyCalls)
	script.mu.Unlock()
	if chatCalls != 2 {
		t.Errorf("chat model calls = %d, want 2 (turn + continuation)", chatCalls)
	}
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

func TestRefinementRegenerateWithAcceptedEditsBlocksApply(t *testing.T) {
	app := testutil.NewApp(t)
	ref := newRefinement(t, app)
	snap := testutil.NewRecord(t, app, schema.ColProjectionSnapshot.String(), map[string]any{
		"projection_id": ref.GetString("projection_id"),
		"status":        engine.StatusPending,
		"output_draft":  "Draft",
		"output_raw":    "Raw",
		"edits": pbutil.JSONObject([]api.SnapshotEdit{
			{
				ID:            "e1",
				Sequence:      1,
				Type:          api.EditTypeRefinement,
				Status:        api.EditStatusApproved,
				ContentBefore: "A",
				ContentAfter:  "B",
			},
		}),
	})
	ref.Set("projection_snapshot_id", snap.Id)
	if err := app.Save(ref); err != nil {
		t.Fatal(err)
	}

	script := &refineScript{lens: "UPDATED LENS", applyOut: "NEW OUTPUT"}
	script.install(t)

	body, msgs := runRefinementTurn(t, app, ref, "make it shorter")

	if !strings.Contains(body, `"type":"`+prompts.RegenerateConfirmationPartType+`"`) {
		t.Error("regenerate confirmation data part not streamed")
	}
	if strings.Contains(body, prompts.ApplyResultToolName) {
		t.Error("apply result should not be streamed when confirmation is pending")
	}

	parts := assistantParts(t, msgs)
	if _, ok := parts[prompts.RegenerateConfirmationPartType]; !ok {
		t.Error("regenerate confirmation part not persisted")
	}
	if _, ok := parts["tool-"+prompts.ApplyResultToolName]; ok {
		t.Error("apply part should not be persisted when confirmation is pending")
	}

	script.mu.Lock()
	applies := len(script.applyCalls)
	script.mu.Unlock()
	if applies != 0 {
		t.Errorf("apply model calls = %d, want 0", applies)
	}
}

func TestRefinementRegenerateConfirmedRunsApply(t *testing.T) {
	app := testutil.NewApp(t)
	ref := newRefinement(t, app)
	snap := testutil.NewRecord(t, app, schema.ColProjectionSnapshot.String(), map[string]any{
		"projection_id": ref.GetString("projection_id"),
		"status":        engine.StatusPending,
		"output_draft":  "Draft",
		"output_raw":    "Raw",
		"edits": pbutil.JSONObject([]api.SnapshotEdit{
			{
				ID:            "e1",
				Sequence:      1,
				Type:          api.EditTypeRefinement,
				Status:        api.EditStatusApproved,
				ContentBefore: "A",
				ContentAfter:  "B",
			},
		}),
	})
	ref.Set("projection_snapshot_id", snap.Id)
	if err := app.Save(ref); err != nil {
		t.Fatal(err)
	}

	script := &refineScript{lens: "UPDATED LENS", applyOut: "NEW OUTPUT"}
	script.install(t)

	_, msgs := runRefinementTurnID(t, app, ref, "user-1", "make it shorter")
	parts := assistantParts(t, msgs)
	if _, ok := parts[prompts.RegenerateConfirmationPartType]; !ok {
		t.Fatal("regenerate confirmation part not persisted on first turn")
	}

	confirmReq := api.ChatRequest{
		ID: ref.GetString("external_conversation_id"),
		Messages: []api.UIMessage{{
			ID:    "confirm-msg",
			Role:  "system",
			Parts: []api.UIMessagePart{{Type: prompts.RegenerateConfirmPartType}},
		}},
	}
	rec := httptest.NewRecorder()
	e := &core.RequestEvent{App: app}
	e.Request = httptest.NewRequest("POST", "/api/chat", nil)
	e.Response = rec

	if err := HandleChatForRefinement(app, confirmReq, ref)(e); err != nil {
		t.Fatalf("handler confirm: %v", err)
	}

	allMsgs, err := chat.LoadMessages(context.Background(), app, ref)
	if err != nil {
		t.Fatalf("load messages: %v", err)
	}
	secondTurnParts := assistantParts(t, allMsgs)
	if _, ok := secondTurnParts["tool-"+prompts.ApplyResultToolName]; !ok {
		t.Fatal("apply part not persisted on confirmed turn")
	}

	script.mu.Lock()
	applies := len(script.applyCalls)
	script.mu.Unlock()
	if applies != 1 {
		t.Errorf("apply model calls = %d, want 1", applies)
	}
}

func TestRefinementRegenerateWithNoAcceptedEditsRunsStraightThrough(t *testing.T) {
	app := testutil.NewApp(t)
	ref := newRefinement(t, app)
	snap := testutil.NewRecord(t, app, schema.ColProjectionSnapshot.String(), map[string]any{
		"projection_id": ref.GetString("projection_id"),
		"status":        engine.StatusPending,
		"output_draft":  "Draft",
		"output_raw":    "Raw",
		"edits": pbutil.JSONObject([]api.SnapshotEdit{
			{
				ID:            "e1",
				Sequence:      1,
				Type:          api.EditTypeRefinement,
				Status:        api.EditStatusProposed,
				ContentBefore: "A",
				ContentAfter:  "B",
			},
		}),
	})
	ref.Set("projection_snapshot_id", snap.Id)
	if err := app.Save(ref); err != nil {
		t.Fatal(err)
	}

	script := &refineScript{lens: "UPDATED LENS", applyOut: "NEW OUTPUT"}
	script.install(t)

	body, msgs := runRefinementTurn(t, app, ref, "make it shorter")

	if strings.Contains(body, prompts.RegenerateConfirmationPartType) {
		t.Error("regenerate confirmation data part should not be streamed without accepted edits")
	}
	if !strings.Contains(body, prompts.ApplyResultToolName) {
		t.Error("apply result should be streamed when no accepted edits exist")
	}

	parts := assistantParts(t, msgs)
	if _, ok := parts[prompts.RegenerateConfirmationPartType]; ok {
		t.Error("regenerate confirmation part should not be persisted")
	}
	if _, ok := parts["tool-"+prompts.ApplyResultToolName]; !ok {
		t.Error("apply part should be persisted")
	}

	script.mu.Lock()
	applies := len(script.applyCalls)
	script.mu.Unlock()
	if applies != 1 {
		t.Errorf("apply model calls = %d, want 1", applies)
	}
}

func TestRefinementFailedProposeYieldsNoticeNextTurnSees(t *testing.T) {
	app := testutil.NewApp(t)
	ref := newRefinement(t, app)
	snap := testutil.NewRecord(t, app, schema.ColProjectionSnapshot.String(), map[string]any{
		"projection_id": ref.GetString("projection_id"),
		"status":        engine.StatusPending,
		"output_draft":  "Existing paragraph 1\n\nExisting paragraph 2",
		"output_raw":    "Existing paragraph 1\n\nExisting paragraph 2",
	})
	ref.Set("projection_snapshot_id", snap.Id)
	if err := app.Save(ref); err != nil {
		t.Fatal(err)
	}

	script := &refineScript{
		refineTarget:      "nonexistent passage",
		refineReplacement: "replacement passage",
	}
	script.install(t)

	_, msgs := runRefinementTurnID(t, app, ref, "user-1", "refine the nonexistent part")
	parts := assistantParts(t, msgs)
	resultData, ok := parts[prompts.RefineResultPartType]
	if !ok {
		t.Fatal("refine_result part not persisted")
	}
	var res struct {
		OK    bool   `json:"ok"`
		Error string `json:"error"`
	}
	if err := json.Unmarshal(resultData, &res); err != nil || res.OK {
		t.Fatalf("expected failed propose result, got ok=%v, err=%v", res.OK, err)
	}

	script.mu.Lock()
	script.refineTarget = ""
	script.refineReplacement = ""
	script.chatText = "Okay, let's fix it."
	script.mu.Unlock()

	runRefinementTurnID(t, app, ref, "user-2", "try again")

	script.mu.Lock()
	history := script.chatHistory
	script.mu.Unlock()

	if len(history) < 2 {
		t.Fatalf("expected at least 2 chat turns, got %d", len(history))
	}
	secondTurnMsgs := history[1]
	var foundNotice bool
	for _, m := range secondTurnMsgs {
		if m.Role == "system" && strings.Contains(m.Content, "Refinement proposal failed:") {
			foundNotice = true
			if !strings.Contains(m.Content, "refinement target passage not found in draft") {
				t.Errorf("system notice missing error reason: %s", m.Content)
			}
			break
		}
	}
	if !foundNotice {
		t.Error("second turn did not see failure notice in system messages")
	}
}

func TestRefinementSuccessfulProposeYieldsNoticeNextTurnSees(t *testing.T) {
	app := testutil.NewApp(t)
	ref := newRefinement(t, app)
	snap := testutil.NewRecord(t, app, schema.ColProjectionSnapshot.String(), map[string]any{
		"projection_id": ref.GetString("projection_id"),
		"status":        engine.StatusPending,
		"output_draft":  "Existing paragraph 1\n\nExisting paragraph 2",
		"output_raw":    "Existing paragraph 1\n\nExisting paragraph 2",
	})
	ref.Set("projection_snapshot_id", snap.Id)
	if err := app.Save(ref); err != nil {
		t.Fatal(err)
	}

	script := &refineScript{
		refineTarget:      "Existing paragraph 1",
		refineReplacement: "New paragraph 1",
	}
	script.install(t)

	_, msgs := runRefinementTurnID(t, app, ref, "user-1", "refine paragraph 1")
	parts := assistantParts(t, msgs)
	resultData, ok := parts[prompts.RefineResultPartType]
	if !ok {
		t.Fatal("refine_result part not persisted")
	}
	var res struct {
		OK       bool `json:"ok"`
		Sequence int  `json:"sequence"`
	}
	if err := json.Unmarshal(resultData, &res); err != nil || !res.OK {
		t.Fatalf("expected successful propose result, got ok=%v, err=%v", res.OK, err)
	}

	script.mu.Lock()
	script.refineTarget = ""
	script.refineReplacement = ""
	script.chatText = "Proposal submitted."
	script.mu.Unlock()

	runRefinementTurnID(t, app, ref, "user-2", "what next?")

	script.mu.Lock()
	history := script.chatHistory
	script.mu.Unlock()

	if len(history) < 2 {
		t.Fatalf("expected at least 2 chat turns, got %d", len(history))
	}
	secondTurnMsgs := history[1]
	var foundNotice bool
	wantNotice := prompts.RefineProposalSuccessNotice(res.Sequence)
	for _, m := range secondTurnMsgs {
		if m.Role == "system" && strings.Contains(m.Content, wantNotice) {
			foundNotice = true
			break
		}
	}
	if !foundNotice {
		t.Errorf("second turn did not see success notice %q in system messages", wantNotice)
	}
}
