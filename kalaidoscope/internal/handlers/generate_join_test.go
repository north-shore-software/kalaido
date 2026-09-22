package handlers

import (
	"encoding/json"
	"net/http"
	"testing"
	"time"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/api"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/engine"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/testutil"
)

// A generate request for an entity the wave is already generating joins that
// generation and answers with its snapshot, instead of refusing with 409.
func TestGenerateCandidateJoinsInFlightGeneration(t *testing.T) {
	app := testutil.NewApp(t)
	proj, _ := editHandlerFixture(t, app)
	claim := testutil.NewRecord(t, app, "projection_snapshot", map[string]any{
		"projection_id": proj.Id,
		"status":        engine.StatusGenerating,
	})

	go func() {
		time.Sleep(100 * time.Millisecond)
		rec, err := app.FindRecordById("projection_snapshot", claim.Id)
		if err != nil {
			return
		}
		rec.Set("status", engine.StatusPending)
		rec.Set("output", "FROM THE WAVE")
		_ = app.Save(rec)
	}()

	rec, err := callJSON(t, app, HandleGenerateCandidate(app, Deps{}), http.MethodPost,
		"/api/projections/"+proj.Id+"/candidates", `{"preview":true}`, map[string]string{"id": proj.Id})
	if err != nil {
		t.Fatalf("generate: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (joined the running generation); body %s", rec.Code, rec.Body.String())
	}
	var out api.ProjectionSnapshotResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatal(err)
	}
	if out.SnapshotID != claim.Id {
		t.Errorf("snapshotId = %s, want the wave's filled claim %s", out.SnapshotID, claim.Id)
	}
}
