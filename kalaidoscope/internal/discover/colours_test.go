package discover

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/colour"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/testutil"
	"github.com/north-shore-software/kalaido/kalaidoscope/llm"
)

const coloursMapBody = `{"things":[
	{"id":"t_acme","name":"Acme","aliases":["ACME Ltd"],"kind":"organisation"},
	{"id":"t_me","name":"Me","aliases":[],"kind":"person"}
],"relationships":[],"narrative":"x"}`

// create_colour writes a real colour on the resolved thing ids and its members
// are the citing fragments, by id or alias, marked covered for the run.
func TestCreateColourWritesRowAndThingMembers(t *testing.T) {
	app := testutil.NewApp(t)
	testutil.NewRecord(t, app, "kalaidoscope_map", map[string]any{"body": json.RawMessage(coloursMapBody), "version": 1})
	run := testutil.NewRecord(t, app, "discover_run", map[string]any{"kind": "colours", "status": "running"})
	cites := []string{`[{"ref":"t_acme"},{"ref":"t_me"}]`, `[{"name":"ACME Ltd"}]`, `[{"ref":"t_me"}]`}
	var ids []string
	for _, c := range cites {
		f := testutil.NewRecord(t, app, "fragment", map[string]any{"content": "f", "type": "note"})
		testutil.NewRecord(t, app, "fragment_annotation", map[string]any{"fragment_id": f.Id, "title": "t", "summary": "s", "things": json.RawMessage(c)})
		ids = append(ids, f.Id)
	}
	c, err := newContext(app, run)
	if err != nil {
		t.Fatal(err)
	}

	args, _ := json.Marshal(map[string]any{"name": "Acme", "thingIds": []string{"ACME Ltd"}})
	text, out, err := coloursFlow{}.Dispatch(context.Background(), c, llm.ToolCall{Name: "create_colour", Args: args})
	if err != nil {
		t.Fatal(err)
	}
	if out == nil || out.Kind != "colour" || out.Status != "" {
		t.Fatalf("output = %+v (%s)", out, text)
	}
	rec, err := app.FindRecordById("colour", out.ID)
	if err != nil {
		t.Fatal(err)
	}
	if rec.GetString("origin_run_id") != run.Id || strings.Join(colour.ThingIDs(rec), ",") != "t_acme" {
		t.Fatalf("row = origin %s things %v, want the canonical id", rec.GetString("origin_run_id"), colour.ThingIDs(rec))
	}
	members, _ := colour.MemberIDs(app, rec.Id)
	if len(members) != 2 || !c.covered[ids[0]] || !c.covered[ids[1]] || c.covered[ids[2]] {
		t.Fatalf("members = %v, covered = %v", members, c.covered)
	}

	// The colour is listed for later flows, with its members.
	existing, err := existingEntities(c)
	if err != nil {
		t.Fatal(err)
	}
	if len(existing) != 1 || existing[0].Kind != "colour" || len(existing[0].FragmentIDs) != 2 || !strings.Contains(existing[0].Description, "Acme") {
		t.Fatalf("existing = %+v", existing)
	}

	// Unknown things are rejected without writing anything.
	args, _ = json.Marshal(map[string]any{"name": "Nope", "thingIds": []string{"t_none"}})
	text, out, err = coloursFlow{}.Dispatch(context.Background(), c, llm.ToolCall{Name: "create_colour", Args: args})
	if err != nil || out != nil || !strings.Contains(text, "Rejected") {
		t.Fatalf("unknown thing: %q %+v %v", text, out, err)
	}
}

// A thing cited by most of the workspace is the workspace, not a colour.
func TestCreateColourRejectsUbiquitousThing(t *testing.T) {
	app := testutil.NewApp(t)
	run := testutil.NewRecord(t, app, "discover_run", map[string]any{"kind": "colours", "status": "running"})
	c := rhythmContext(weeklyRows("2026-01-05", 30, "t_me"), "t_me")
	c.App, c.Run = app, run
	args, _ := json.Marshal(map[string]any{"name": "Me", "thingIds": []string{"t_me"}})
	text, out, err := coloursFlow{}.Dispatch(context.Background(), c, llm.ToolCall{Name: "create_colour", Args: args})
	if err != nil || out != nil || !strings.Contains(text, "Rejected") {
		t.Fatalf("ubiquitous: %q %+v %v", text, out, err)
	}
	if n, _ := app.CountRecords("colour"); n != 0 {
		t.Fatalf("colour rows = %d", n)
	}
}
