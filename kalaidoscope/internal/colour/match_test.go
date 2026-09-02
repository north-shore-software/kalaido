package colour

import (
	"encoding/json"
	"sort"
	"testing"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/testutil"
)

const mapBody = `{"things":[
	{"id":"t_acme","name":"Acme","aliases":["ACME Ltd"],"kind":"organisation"},
	{"id":"t_lift","name":"Lift contract","aliases":[],"kind":"project"}
],"relationships":[],"narrative":""}`

// fixture: four fragments; the first cites Acme by id, the second by alias,
// the third cites the lift contract, the fourth cites nothing.
func fixture(t *testing.T) (core.App, []string) {
	t.Helper()
	app := testutil.NewApp(t)
	testutil.NewRecord(t, app, "kalaidoscope_map", map[string]any{"body": json.RawMessage(mapBody), "version": 1})
	cites := []string{`[{"ref":"t_acme"}]`, `[{"name":"ACME Ltd"}]`, `[{"ref":"t_lift"}]`, `[]`}
	var ids []string
	for i, c := range cites {
		f := testutil.NewRecord(t, app, "fragment", map[string]any{"content": "fragment", "type": "note"})
		testutil.NewRecord(t, app, "fragment_annotation", map[string]any{
			"fragment_id": f.Id, "title": "t", "summary": "s", "things": json.RawMessage(c), "folded": i%2 == 0,
		})
		ids = append(ids, f.Id)
	}
	return app, ids
}

func newColour(t *testing.T, app core.App, thingIDs ...string) *core.Record {
	t.Helper()
	raw, _ := json.Marshal(thingIDs)
	return testutil.NewRecord(t, app, "colour", map[string]any{"name": "c", "thing_ids": json.RawMessage(raw)})
}

func links(t *testing.T, app core.App, colourID string) map[string]string {
	t.Helper()
	recs, err := app.FindRecordsByFilter("colour_fragment", "colour_id = {:c}", "", 0, 0, dbx.Params{"c": colourID})
	if err != nil {
		t.Fatal(err)
	}
	out := map[string]string{}
	for _, r := range recs {
		out[r.GetString("fragment_id")] = r.GetString("match_type")
	}
	return out
}

func TestRematchThingsFollowsCitationsByIDAndAlias(t *testing.T) {
	app, f := fixture(t)
	c := newColour(t, app, "t_acme")
	if err := RematchThingsFor(app, c.Id); err != nil {
		t.Fatal(err)
	}
	got := links(t, app, c.Id)
	want := map[string]string{f[0]: MatchThing, f[1]: MatchThing}
	if len(got) != len(want) || got[f[0]] != MatchThing || got[f[1]] != MatchThing {
		t.Fatalf("links = %v, want %v", got, want)
	}

	// Things change: stale thing rows go, new ones arrive.
	c.Set("thing_ids", json.RawMessage(`["t_lift"]`))
	if err := app.Save(c); err != nil {
		t.Fatal(err)
	}
	if err := RematchThings(app); err != nil {
		t.Fatal(err)
	}
	got = links(t, app, c.Id)
	if len(got) != 1 || got[f[2]] != MatchThing {
		t.Fatalf("after thing change links = %v", got)
	}
}

func TestRematchLeavesManualRowsAlone(t *testing.T) {
	app, f := fixture(t)
	c := newColour(t, app, "t_acme")
	if err := SetManual(app, c.Id, f[0], MatchManualNegative); err != nil {
		t.Fatal(err)
	}
	if err := SetManual(app, c.Id, f[3], MatchManualPositive); err != nil {
		t.Fatal(err)
	}
	if err := RematchThingsFor(app, c.Id); err != nil {
		t.Fatal(err)
	}
	got := links(t, app, c.Id)
	if got[f[0]] != MatchManualNegative || got[f[1]] != MatchThing || got[f[3]] != MatchManualPositive || len(got) != 3 {
		t.Fatalf("links = %v", got)
	}

	members, err := MemberIDs(app, c.Id)
	if err != nil {
		t.Fatal(err)
	}
	sort.Strings(members)
	want := []string{f[1], f[3]}
	sort.Strings(want)
	if len(members) != 2 || members[0] != want[0] || members[1] != want[1] {
		t.Fatalf("members = %v, want %v", members, want)
	}
}

func TestClearManualRestoresThingMatch(t *testing.T) {
	app, f := fixture(t)
	c := newColour(t, app, "t_acme")
	if err := RematchThingsFor(app, c.Id); err != nil {
		t.Fatal(err)
	}
	// Exclude a cited fragment, then undo: the thing row comes back.
	if err := SetManual(app, c.Id, f[0], MatchManualNegative); err != nil {
		t.Fatal(err)
	}
	if got := links(t, app, c.Id)[f[0]]; got != MatchManualNegative {
		t.Fatalf("after exclude = %q", got)
	}
	if err := ClearManual(app, c.Id, f[0]); err != nil {
		t.Fatal(err)
	}
	if got := links(t, app, c.Id)[f[0]]; got != MatchThing {
		t.Fatalf("after undo = %q", got)
	}
	// Undo on an uncited pinned fragment leaves no row.
	if err := SetManual(app, c.Id, f[3], MatchManualPositive); err != nil {
		t.Fatal(err)
	}
	if err := ClearManual(app, c.Id, f[3]); err != nil {
		t.Fatal(err)
	}
	if _, ok := links(t, app, c.Id)[f[3]]; ok {
		t.Fatal("uncited pair should have no row after undo")
	}
}

func TestPastWatermarkPagesInCreatedIDOrder(t *testing.T) {
	app := testutil.NewApp(t)
	var ids []string
	for i := 0; i < 3; i++ {
		ids = append(ids, testutil.NewRecord(t, app, "fragment", map[string]any{"content": "f", "type": "note"}).Id)
	}
	all, err := pastWatermark(app, "")
	if err != nil || len(all) != 3 {
		t.Fatalf("all = %d, %v", len(all), err)
	}
	// Whatever order created/id produced, the page after the second row is
	// exactly the third row.
	rest, err := pastWatermark(app, all[1].Id)
	if err != nil || len(rest) != 1 || rest[0].Id != all[2].Id {
		t.Fatalf("rest = %v, %v", rest, err)
	}
	if rest, _ := pastWatermark(app, all[2].Id); len(rest) != 0 {
		t.Fatalf("past the last row = %d", len(rest))
	}
	// A vanished watermark starts over.
	if rest, _ := pastWatermark(app, "gone"); len(rest) != 3 {
		t.Fatalf("vanished watermark = %d", len(rest))
	}
}
