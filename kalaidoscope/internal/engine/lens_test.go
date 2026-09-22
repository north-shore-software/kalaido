package engine

import (
	"testing"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/api"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/pbutil"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/testutil"
)

// The scope a generation resolves is the entity's current_context_spec; the
// lens holds the prompt only. An edit to the entity's spec that never touches
// the lens (the colour-delete scrub) is therefore what the next generation
// runs with.
func TestActiveLensScopeIsTheEntitySpec(t *testing.T) {
	app := testutil.NewApp(t)
	lens := testutil.NewRecord(t, app, "lens", map[string]any{"prompt": "LENS"})
	proj := testutil.NewRecord(t, app, "projection", map[string]any{
		"name":                 "p",
		"current_lens_id":      lens.Id,
		"current_context_spec": pbutil.JSONObject(api.ContextSpec{ColourIDs: []string{"c1"}}),
	})

	prompt, spec := resolveActiveLens(app, ProjectionStrategy{}, proj)
	if prompt != "LENS" || len(spec.ColourIDs) != 1 || spec.ColourIDs[0] != "c1" {
		t.Fatalf("resolved %q %+v, want the lens prompt and the entity's colour", prompt, spec)
	}

	proj.Set("current_context_spec", pbutil.JSONObject(api.ContextSpec{WholeScope: api.WholeScopeFull}))
	if err := app.Save(proj); err != nil {
		t.Fatal(err)
	}
	proj, _ = app.FindRecordById("projection", proj.Id)
	prompt, spec = resolveActiveLens(app, ProjectionStrategy{}, proj)
	if prompt != "LENS" || len(spec.ColourIDs) != 0 || spec.WholeScope != api.WholeScopeFull {
		t.Fatalf("resolved %q %+v after the entity's spec changed; the lens must not shadow it", prompt, spec)
	}
}
