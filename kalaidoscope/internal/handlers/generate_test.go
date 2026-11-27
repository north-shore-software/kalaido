package handlers

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"testing"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/api"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/chat"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/engine"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/pbutil"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/prompts"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/testutil"
	"github.com/north-shore-software/kalaido/kalaidoscope/llm"
	"github.com/north-shore-software/kalaido/kalaidoscope/schema"
)

type testFakeProvider struct {
	reply string
}

func (testFakeProvider) ContextWindow() int { return 256_000 }

func (p testFakeProvider) Stream(ctx context.Context, msgs []llm.Message, tools []llm.Tool, opts llm.GenOptions) (*llm.Completion, error) {
	text := p.reply
	if text == "" {
		text = "GENERATED"
	}
	ch := make(chan llm.StreamEvent, 1)
	ch <- llm.StreamEvent{Kind: llm.EventText, Text: text}
	close(ch)
	return &llm.Completion{Events: ch, Wait: func() *llm.Usage { return nil }}, nil
}

// A generate request for an entity that is already generating returns 409 Conflict.
func TestGenerateCandidateReturnsConflictWhenInFlight(t *testing.T) {
	app := testutil.NewApp(t)
	proj, _ := editHandlerFixture(t, app)
	testutil.NewRecord(t, app, "projection_snapshot", map[string]any{
		"projection_id": proj.Id,
		"status":        engine.StatusGenerating,
	})

	_, err := callJSON(t, app, HandleGenerateCandidate(app, nil), http.MethodPost,
		"/api/projections/"+proj.Id+"/candidates", `{"preview":true}`, map[string]string{"id": proj.Id})
	if code := apiErrorStatus(err); code != http.StatusConflict {
		t.Fatalf("status = %d, want 409 conflict; err %v", code, err)
	}
}

// Stage 1 drops the candidate_engaged / discardEngaged 409 block: Update always
// runs a 1-call anchored pass and returns {snapshotId, refinementId} with an
// attached session.
func TestGenerateCandidateSucceedsEvenWhenPriorCandidateEngaged(t *testing.T) {
	llm.SetActiveModelSet(llm.SetLocal)
	llm.SetProviderFactory(func(model string, cfg llm.WorkspaceConfig) llm.Provider {
		return testFakeProvider{reply: "<summary>Integrated the new note.</summary>\n<document>Block 1\n\nBlock 2 updated\n\nBlock 3</document>"}
	})
	app := testutil.NewApp(t)
	proj, src := editHandlerFixture(t, app)
	proj.Set("status", engine.EntityActive)
	if err := app.Save(proj); err != nil {
		t.Fatal(err)
	}
	// Approved snapshot anchor.
	testutil.NewRecord(t, app, "projection_snapshot", map[string]any{
		"projection_id":            proj.Id,
		"status":                   engine.StatusApproved,
		"approval_sequence_number": 1,
		"output":                   "Block 1\n\nBlock 2\n\nBlock 3",
	})
	src.Set("edits", pbutil.JSONObject([]api.SnapshotEdit{
		{ID: "e1", Type: api.EditTypeManual, Status: api.EditStatusApproved},
	}))
	if err := app.Save(src); err != nil {
		t.Fatal(err)
	}

	rec, err := callJSON(t, app, HandleGenerateCandidate(app, nil), http.MethodPost,
		"/api/projections/"+proj.Id+"/candidates", `{"preview":true}`, map[string]string{"id": proj.Id})
	if err != nil {
		t.Fatalf("generate: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body %s", rec.Code, rec.Body.String())
	}

	var res api.ProjectionSnapshotResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &res); err != nil {
		t.Fatal(err)
	}
	if res.SnapshotID == "" || res.RefinementID == "" {
		t.Fatalf("response = %+v, want both snapshotId and refinementId", res)
	}

	snap, err := app.FindRecordById(schema.ColProjectionSnapshot.String(), res.SnapshotID)
	if err != nil {
		t.Fatal(err)
	}
	if snap.GetString("status") != engine.StatusPending {
		t.Errorf("status = %q, want pending_review", snap.GetString("status"))
	}
	edits := engine.LoadSnapshotEdits(snap)
	if len(edits) != 1 || edits[0].ContentAfter != "Block 2 updated" {
		t.Errorf("edits = %+v, want 1 diff hunk for Block 2", edits)
	}

	refRec, err := app.FindRecordById(schema.ColProjectionRefinement.String(), res.RefinementID)
	if err != nil {
		t.Fatal(err)
	}
	msgs, err := chat.LoadMessages(context.Background(), app, refRec)
	if err != nil {
		t.Fatal(err)
	}
	var gotSummary string
	for _, m := range msgs {
		if m.Role == "assistant" {
			for _, p := range m.Parts {
				if p.Type == "text" {
					gotSummary = p.Text
				}
			}
		}
	}
	if !strings.Contains(gotSummary, "Integrated the new note") {
		t.Errorf("opening assistant message = %q, want summary text", gotSummary)
	}
}

// A zero-change anchored update still opens a pending session with the
// unchanged draft and an opening assistant explanation.
func TestGenerateCandidateNoChangesOpensSessionWithExplanation(t *testing.T) {
	llm.SetActiveModelSet(llm.SetLocal)
	llm.SetProviderFactory(func(model string, cfg llm.WorkspaceConfig) llm.Provider {
		return testFakeProvider{reply: "<summary>The new receipt was unrelated to the PRD.</summary>\n<document>NO_CHANGES</document>"}
	})
	app := testutil.NewApp(t)
	// No lens installed at all — must NOT fail with ErrLensNotReady when an
	// approved snapshot exists!
	proj := testutil.NewRecord(t, app, "projection", map[string]any{
		"name":                 "PRD",
		"status":               engine.EntityActive,
		"current_context_spec": pbutil.JSONObject(api.ContextSpec{WholeScope: api.WholeScopeFull}),
	})
	testutil.NewRecord(t, app, "projection_snapshot", map[string]any{
		"projection_id":            proj.Id,
		"status":                   engine.StatusApproved,
		"approval_sequence_number": 1,
		"output":                   "Paragraph A\n\nParagraph B",
	})

	rec, err := callJSON(t, app, HandleGenerateCandidate(app, nil), http.MethodPost,
		"/api/projections/"+proj.Id+"/candidates", `{"preview":true}`, map[string]string{"id": proj.Id})
	if err != nil {
		t.Fatalf("generate no-changes: %v", err)
	}
	var res api.ProjectionSnapshotResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &res); err != nil {
		t.Fatal(err)
	}
	snap, err := app.FindRecordById(schema.ColProjectionSnapshot.String(), res.SnapshotID)
	if err != nil {
		t.Fatal(err)
	}
	if snap.GetString("output_draft") != "Paragraph A\n\nParagraph B" {
		t.Errorf("output_draft = %q, want unchanged approved text", snap.GetString("output_draft"))
	}
	if len(engine.LoadSnapshotEdits(snap)) != 0 {
		t.Errorf("expected 0 edits on NO_CHANGES")
	}

	refRec, err := app.FindRecordById(schema.ColProjectionRefinement.String(), res.RefinementID)
	if err != nil {
		t.Fatal(err)
	}
	msgs, _ := chat.LoadMessages(context.Background(), app, refRec)
	found := false
	for _, m := range msgs {
		if m.Role == "assistant" && len(m.Parts) > 0 && strings.Contains(m.Parts[0].Text, "unrelated to the PRD") {
			found = true
		}
	}
	if !found {
		t.Fatalf("expected opening explanation in session, got %+v", msgs)
	}
}

// Issue 4: when anchored update replaces > 60% of blocks, it swaps output_draft
// wholesale without a confirmation card and explains the replacement in chat.
func TestGenerateCandidateAboveFullRewriteThresholdSwapsWholesale(t *testing.T) {
	llm.SetActiveModelSet(llm.SetLocal)
	llm.SetProviderFactory(func(model string, cfg llm.WorkspaceConfig) llm.Provider {
		return testFakeProvider{reply: "<summary>Rewrote all sections for the new architecture.</summary>\n<document>New 1\n\nNew 2\n\nNew 3</document>"}
	})
	app := testutil.NewApp(t)
	proj := testutil.NewRecord(t, app, "projection", map[string]any{
		"name":                 "Arch",
		"status":               engine.EntityActive,
		"current_context_spec": pbutil.JSONObject(api.ContextSpec{WholeScope: api.WholeScopeFull}),
	})
	testutil.NewRecord(t, app, "projection_snapshot", map[string]any{
		"projection_id":            proj.Id,
		"status":                   engine.StatusApproved,
		"approval_sequence_number": 1,
		"output":                   "Old 1\n\nOld 2\n\nOld 3",
	})

	rec, err := callJSON(t, app, HandleGenerateCandidate(app, nil), http.MethodPost,
		"/api/projections/"+proj.Id+"/candidates", `{"preview":true}`, map[string]string{"id": proj.Id})
	if err != nil {
		t.Fatalf("generate rewrite: %v", err)
	}
	var res api.ProjectionSnapshotResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &res); err != nil {
		t.Fatal(err)
	}
	snap, err := app.FindRecordById(schema.ColProjectionSnapshot.String(), res.SnapshotID)
	if err != nil {
		t.Fatal(err)
	}
	if snap.GetString("output_draft") != "New 1\n\nNew 2\n\nNew 3" {
		t.Errorf("output_draft = %q, want wholesale replaced draft", snap.GetString("output_draft"))
	}
	if snap.GetString("output_raw") != "New 1\n\nNew 2\n\nNew 3" {
		t.Errorf("output_raw = %q, want wholesale replaced draft", snap.GetString("output_raw"))
	}
	if len(engine.LoadSnapshotEdits(snap)) != 0 {
		t.Errorf("expected 0 edits on wholesale swap, got %d", len(engine.LoadSnapshotEdits(snap)))
	}

	refRec, _ := app.FindRecordById(schema.ColProjectionRefinement.String(), res.RefinementID)
	msgs, _ := chat.LoadMessages(context.Background(), app, refRec)
	var assistantText string
	for _, m := range msgs {
		for _, p := range m.Parts {
			if p.Type == prompts.FullRewriteConfirmationPartType {
				t.Fatalf("unexpected %s part on anchored update", prompts.FullRewriteConfirmationPartType)
			}
			if m.Role == "assistant" && p.Type == "text" {
				assistantText += p.Text
			}
		}
	}
	if !strings.Contains(assistantText, "replaced the full draft") {
		t.Errorf("opening assistant text = %q, want explicit note about full draft replacement", assistantText)
	}
	if !strings.Contains(assistantText, "Rewrote all sections for the new architecture.") {
		t.Errorf("opening assistant text = %q, want original summary preserved", assistantText)
	}
}
