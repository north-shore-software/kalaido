package handlers

import (
	"context"
	"net/http"
	"testing"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/api"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/engine"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/pbutil"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/testutil"
	"github.com/north-shore-software/kalaido/kalaidoscope/llm"
)

type testFakeProvider struct{}

func (testFakeProvider) ContextWindow() int { return 256_000 }

func (testFakeProvider) Stream(ctx context.Context, msgs []llm.Message, tools []llm.Tool, opts llm.GenOptions) (*llm.Completion, error) {
	ch := make(chan llm.StreamEvent, 1)
	ch <- llm.StreamEvent{Kind: llm.EventText, Text: "GENERATED"}
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

	_, err := callJSON(t, app, HandleGenerateCandidate(app), http.MethodPost,
		"/api/projections/"+proj.Id+"/candidates", `{"preview":true}`, map[string]string{"id": proj.Id})
	if code := apiErrorStatus(err); code != http.StatusConflict {
		t.Fatalf("status = %d, want 409 conflict; err %v", code, err)
	}
}

func TestGenerateCandidateRefusesEngagedCandidate(t *testing.T) {
	app := testutil.NewApp(t)
	proj, src := editHandlerFixture(t, app)
	proj.Set("status", engine.EntityActive)
	if err := app.Save(proj); err != nil {
		t.Fatal(err)
	}
	src.Set("edits", pbutil.JSONObject([]api.SnapshotEdit{
		{ID: "e1", Type: api.EditTypeManual, Status: api.EditStatusApproved},
	}))
	if err := app.Save(src); err != nil {
		t.Fatal(err)
	}

	_, err := callJSON(t, app, HandleGenerateCandidate(app), http.MethodPost,
		"/api/projections/"+proj.Id+"/candidates", `{"preview":true}`, map[string]string{"id": proj.Id})
	if code := apiErrorStatus(err); code != http.StatusConflict {
		t.Fatalf("status = %d, want 409 conflict; err %v", code, err)
	}
}

func TestGenerateCandidateAllowsDiscardEngaged(t *testing.T) {
	llm.SetActiveModelSet(llm.SetLocal)
	llm.SetProviderFactory(func(model string, cfg llm.WorkspaceConfig) llm.Provider {
		return testFakeProvider{}
	})
	app := testutil.NewApp(t)
	proj, src := editHandlerFixture(t, app)
	proj.Set("status", engine.EntityActive)
	if err := app.Save(proj); err != nil {
		t.Fatal(err)
	}
	src.Set("edits", pbutil.JSONObject([]api.SnapshotEdit{
		{ID: "e1", Type: api.EditTypeManual, Status: api.EditStatusApproved},
	}))
	if err := app.Save(src); err != nil {
		t.Fatal(err)
	}

	rec, err := callJSON(t, app, HandleGenerateCandidate(app), http.MethodPost,
		"/api/projections/"+proj.Id+"/candidates", `{"preview":true,"discardEngaged":true}`, map[string]string{"id": proj.Id})
	if err != nil {
		t.Fatalf("generate: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body %s", rec.Code, rec.Body.String())
	}
}
