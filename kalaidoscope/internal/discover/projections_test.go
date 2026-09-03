package discover

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/api"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/colour"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/engine"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/prompts"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/testutil"
	"github.com/north-shore-software/kalaido/kalaidoscope/llm"
)

// propose_projection pins colours, never fragments: the run context indexes
// the real colours' membership, a proposal's spec carries the colour ids, and
// the members count as covered for the rest of the run.
func TestProposeProjectionPinsColours(t *testing.T) {
	app := testutil.NewApp(t)
	testutil.NewRecord(t, app, "kalaidoscope_map", map[string]any{"body": json.RawMessage(coloursMapBody), "version": 1})
	run := testutil.NewRecord(t, app, "discover_run", map[string]any{"kind": "projections", "status": "running"})
	cites := []string{`[{"ref":"t_acme"}]`, `[{"name":"ACME Ltd"}]`, `[{"ref":"t_me"}]`}
	var ids []string
	for i, c := range cites {
		f := testutil.NewRecord(t, app, "fragment", map[string]any{
			"content": "f", "type": "note", "source_time": "2026-0" + string(rune('1'+i)) + "-10 12:00:00.000Z",
		})
		testutil.NewRecord(t, app, "fragment_annotation", map[string]any{"fragment_id": f.Id, "title": "t", "summary": "s", "things": json.RawMessage(c)})
		ids = append(ids, f.Id)
	}
	col := testutil.NewRecord(t, app, "colour", map[string]any{"name": "Acme", "thing_ids": json.RawMessage(`["t_acme"]`)})
	if err := colour.RematchThingsFor(app, col.Id); err != nil {
		t.Fatal(err)
	}

	c, err := newContext(app, run)
	if err != nil {
		t.Fatal(err)
	}
	if len(c.Colours) != 1 || c.Colours[0].ID != col.Id || len(c.Colours[0].Members) != 2 || len(c.ByColour[col.Id]) != 2 {
		t.Fatalf("colour index = %+v", c.Colours)
	}
	if c.Colours[0].First != "2026-01-10" || c.Colours[0].Last != "2026-02-10" || c.Colours[0].ThingNames[0] != "Acme" {
		t.Fatalf("colour info = %+v", c.Colours[0])
	}
	if got := c.coloursBlock(); !strings.Contains(got, col.Id+" · Acme · built on Acme · 2 fragments · 2026-01-10 to 2026-02-10") {
		t.Fatalf("colours block = %q", got)
	}
	if card := c.ReadColours([]string{"acme"}); !strings.Contains(card, ids[1]) || strings.Contains(card, ids[2]) {
		t.Fatalf("read_colour by name = %q", card)
	}

	// The colour may be named or given by id; the spec stores the id.
	args, _ := json.Marshal(map[string]any{"name": "Acme account", "message": "Keep the account.", "colourIds": []string{"Acme"}})
	text, out, err := projectionsFlow{}.Dispatch(context.Background(), c, llm.ToolCall{Name: prompts.ProposeProjectionToolName, Args: args})
	if err != nil {
		t.Fatal(err)
	}
	if out == nil || out.Kind != "projection" || out.Status != engine.EntityProposed || !strings.Contains(text, "2 fragments in scope") {
		t.Fatalf("output = %+v (%s)", out, text)
	}
	rec, err := app.FindRecordById("projection", out.ID)
	if err != nil {
		t.Fatal(err)
	}
	var spec api.ContextSpec
	_ = rec.UnmarshalJSONField("current_context_spec", &spec)
	if len(spec.ColourIDs) != 1 || spec.ColourIDs[0] != col.Id || len(spec.FragmentIDs) != 0 || len(spec.SourceProjectionIDs) != 0 {
		t.Fatalf("spec = %+v, want only the colour id", spec)
	}
	if rec.GetString("origin_run_id") != run.Id || rec.GetString("brief") != "Keep the account." {
		t.Fatalf("row = %+v", rec)
	}
	if !c.covered[ids[0]] || !c.covered[ids[1]] || c.covered[ids[2]] {
		t.Fatalf("covered = %v", c.covered)
	}

	// Coverage for this flow counts projection scopes, not colours, and lists
	// the colours left out.
	existing, err := existingEntities(c)
	if err != nil {
		t.Fatal(err)
	}
	cov := projectionsFlow{}.Coverage(c, existing)
	if !strings.Contains(cov, "2 of 3 annotated fragments") || strings.Contains(cov, "least covered") {
		t.Fatalf("coverage = %q", cov)
	}

	// A source projection alone is a scope; no scope at all, or an unknown
	// colour, is rejected without a row.
	args, _ = json.Marshal(map[string]any{"name": "Overview", "message": "Build on it.", "sourceProjectionIds": []string{out.ID}})
	_, out2, err := projectionsFlow{}.Dispatch(context.Background(), c, llm.ToolCall{Name: prompts.ProposeProjectionToolName, Args: args})
	if err != nil || out2 == nil {
		t.Fatalf("source-only scope: %+v %v", out2, err)
	}
	for _, bad := range []map[string]any{
		{"name": "x", "message": "x"},
		{"name": "x", "message": "x", "colourIds": []string{"c_none"}},
		{"name": "x", "message": "x", "thingIds": []string{"t_acme"}},
	} {
		args, _ = json.Marshal(bad)
		text, out, err := projectionsFlow{}.Dispatch(context.Background(), c, llm.ToolCall{Name: prompts.ProposeProjectionToolName, Args: args})
		if err != nil || out != nil || !strings.Contains(text, "Rejected") {
			t.Fatalf("%v: text=%q out=%v err=%v", bad, text, out, err)
		}
	}
	if n, _ := app.CountRecords("projection"); n != 2 {
		t.Fatalf("projection rows = %d", n)
	}
}

// Projections and reflections cannot run before colours exist; the colours
// flow can. Neither pins fragments; only reflections take things, as the
// evidence a proposal is made from.
func TestColourScopedFlowsNeedColours(t *testing.T) {
	app := testutil.NewApp(t)
	testutil.NewRecord(t, app, "kalaidoscope_map", map[string]any{"body": json.RawMessage(coloursMapBody), "version": 1})
	c, err := newContext(app, nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(c.Colours) != 0 || len(c.Doc.Things) == 0 {
		t.Fatalf("context = %d colours, %d things", len(c.Colours), len(c.Doc.Things))
	}
	for kind, want := range map[string]bool{"colours": false, "projections": true, "reflections": true} {
		if scopesByColour[kind] != want {
			t.Fatalf("%s: scopesByColour = %v", kind, scopesByColour[kind])
		}
	}
	for _, flow := range []Flow{projectionsFlow{}, reflectionsFlow{}} {
		for _, tool := range flow.Tools(c) {
			if !json.Valid(tool.Parameters) {
				t.Fatalf("%s parameters are not valid JSON: %s", tool.Name, tool.Parameters)
			}
			if strings.Contains(string(tool.Parameters), "fragmentIds") {
				t.Fatalf("%s still offers fragment pins: %s", tool.Name, tool.Parameters)
			}
			if flow.Kind() == "projections" && strings.Contains(string(tool.Parameters), "thingIds") {
				t.Fatalf("%s still offers thing pins: %s", tool.Name, tool.Parameters)
			}
		}
	}
}
