package discover

import (
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/api"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/engine"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/mapping"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/testutil"
	"github.com/north-shore-software/kalaido/kalaidoscope/llm"
)

var now = time.Date(2026, 9, 2, 12, 0, 0, 0, time.UTC)

// The cadence vocabulary becomes a grid spec whose origin is the start date
// at midnight UTC and whose period and duration agree.
func TestBuildReflectionSpec(t *testing.T) {
	spec, start, reject := buildReflectionSpec("Weekly", "2026-06-04", now)
	if reject != "" {
		t.Fatal(reject)
	}
	if spec.Period != "168h" || spec.Duration != "168h" {
		t.Fatalf("spec = %+v", spec)
	}
	if spec.StartTime != "2026-06-04T00:00:00Z" || !start.Equal(time.Date(2026, 6, 4, 0, 0, 0, 0, time.UTC)) {
		t.Fatalf("start = %s / %s", spec.StartTime, start)
	}
	for _, tc := range []struct{ cadence, start, want string }{
		{"fortnightly", "2026-06-04", "not one of"},
		{"weekly", "June 4th", "not a date"},
		{"weekly", "2027-01-01", "in the future"},
		{"daily", "2020-01-01", "more than the"},
	} {
		if _, _, reject := buildReflectionSpec(tc.cadence, tc.start, now); !strings.Contains(reject, tc.want) {
			t.Fatalf("%s/%s: reject = %q, want it to mention %q", tc.cadence, tc.start, reject, tc.want)
		}
	}
	// Daily from a year back fits (365 < MaxGridWindows).
	if _, _, reject := buildReflectionSpec("daily", now.AddDate(-1, 0, 0).Format("2006-01-02"), now); reject != "" {
		t.Fatal(reject)
	}
}

// propose_reflection names the rhythm's things as evidence and writes a
// proposed row pinning the colours that cover them (never the fragments, never
// the things) and a first schedule version effective from the start date,
// which is what makes the series backfill from there once the proposal is
// committed.
func TestProposeReflectionWritesScheduleFromOnset(t *testing.T) {
	app := testutil.NewApp(t)
	run := testutil.NewRecord(t, app, "discover_run", map[string]any{"kind": "reflections", "status": "running"})
	var rows []mapping.Row
	for _, r := range weeklyRows("2026-06-01", 12, "t_news") {
		frag := testutil.NewRecord(t, app, "fragment", map[string]any{"content": r.Title, "type": "email"})
		r.FragmentID = frag.Id
		rows = append(rows, r)
	}
	// A second thing with its own colour, never cited with the newsletter.
	for _, r := range weeklyRows("2026-06-03", 12, "t_other") {
		frag := testutil.NewRecord(t, app, "fragment", map[string]any{"content": r.Title, "type": "email"})
		r.FragmentID = frag.Id
		rows = append(rows, r)
	}
	// Padding so neither thing is ubiquitous by share.
	rows = append(rows, weeklyRows("2025-01-06", 40, "t_pad")...)
	c := rhythmContext(rows, "t_news", "t_other", "t_pad")
	c.App, c.Run = app, run

	args, _ := json.Marshal(map[string]any{
		"name": "Weekly newsletter", "message": "Each week, summarise the newsletter.",
		"thingIds": []string{"Thing t_news"}, "colourIds": []string{"Colour t_news"}, "cadence": "weekly", "startTime": "2026-06-01",
	})
	text, out, err := reflectionsFlow{}.propose(c, llm.ToolCall{Name: "propose_reflection", Args: args}, now)
	if err != nil {
		t.Fatal(err)
	}
	if out == nil || out.Kind != "reflection" || out.Status != engine.EntityProposed {
		t.Fatalf("output = %+v (%s)", out, text)
	}
	rec, err := app.FindRecordById("reflection", out.ID)
	if err != nil {
		t.Fatal(err)
	}
	if rec.GetString("status") != engine.EntityProposed || rec.GetString("origin_run_id") != run.Id || rec.GetString("brief") == "" {
		t.Fatalf("row = status %s origin %s brief %q", rec.GetString("status"), rec.GetString("origin_run_id"), rec.GetString("brief"))
	}
	var spec api.ContextSpec
	_ = rec.UnmarshalJSONField("current_context_spec", &spec)
	if len(spec.ColourIDs) != 1 || spec.ColourIDs[0] != "t_news" || len(spec.FragmentIDs) != 0 {
		t.Fatalf("scope = %+v, want the colour pinned by id and no fragments", spec)
	}
	if !strings.Contains(text, "12 fragments in scope, holding 12 of 12 about Thing t_news") {
		t.Fatalf("reply = %q, want the member count and the cover", text)
	}
	versions := engine.LoadWindowSpecVersions(rec)
	if len(versions) != 1 || versions[0].VersionNumber != 1 {
		t.Fatalf("versions = %+v", versions)
	}
	if versions[0].EffectiveFrom != "2026-06-01T00:00:00Z" || versions[0].Spec.StartTime != "2026-06-01T00:00:00Z" || versions[0].Spec.Period != "168h" {
		t.Fatalf("first version = %+v, want effective from the start date", versions[0])
	}
	if grid := engine.CurrentGridWindows(rec, now); len(grid) != 13 {
		t.Fatalf("grid = %d windows, want 13 weekly windows since the onset", len(grid))
	}

	// The scope counts as covered for the rest of the run.
	if !c.covered[rows[0].FragmentID] {
		t.Fatal("proposed scope not marked covered")
	}

	// No colour, an unknown one, no thing, an unknown thing, or a colour that
	// holds none of the rhythm: each rejected without writing anything, and
	// the last one names the colour that would cover it.
	for _, bad := range []struct {
		things, colours []string
		want            string
	}{
		{[]string{"t_news"}, []string{}, "colourId"},
		{[]string{"t_news"}, []string{"c_none"}, "c_none"},
		{[]string{}, []string{"t_news"}, "thingIds"},
		{[]string{"t_none"}, []string{"t_news"}, "t_none"},
		{[]string{"t_news"}, []string{"t_other"}, "hold 0 of the 12 fragments about Thing t_news; a scope must hold most of the rhythm. Colours that do: Colour t_news (t_news, built on it) 12 of 12"},
	} {
		args, _ := json.Marshal(map[string]any{
			"name": "x", "message": "x", "thingIds": bad.things, "colourIds": bad.colours, "cadence": "weekly", "startTime": "2026-06-01",
		})
		text, out, err := reflectionsFlow{}.propose(c, llm.ToolCall{Name: "propose_reflection", Args: args}, now)
		if err != nil || out != nil || !strings.Contains(text, "Rejected") || !strings.Contains(text, bad.want) {
			t.Fatalf("%v/%v: text=%q out=%v err=%v", bad.things, bad.colours, text, out, err)
		}
	}
	if n, _ := app.CountRecords("reflection"); n != 1 {
		t.Fatalf("reflection rows = %d, want only the accepted one", n)
	}
}

// Neither a ubiquitous thing nor a ubiquitous colour can anchor a reflection.
func TestProposeReflectionRejectsUbiquitous(t *testing.T) {
	app := testutil.NewApp(t)
	run := testutil.NewRecord(t, app, "discover_run", map[string]any{"kind": "reflections", "status": "running"})
	rows := weeklyRows("2026-01-05", 30, "t_me", "t_news")
	rows = append(rows, weeklyRows("2025-01-06", 40, "t_pad")...)
	c := rhythmContext(rows, "t_me", "t_news", "t_pad")
	c.App, c.Run = app, run
	for _, ids := range [][2]string{{"t_me", "t_news"}, {"t_news", "t_me"}} {
		args, _ := json.Marshal(map[string]any{
			"name": "Me", "message": "x", "thingIds": []string{ids[0]}, "colourIds": []string{ids[1]}, "cadence": "weekly", "startTime": "2026-01-05",
		})
		text, out, err := reflectionsFlow{}.propose(c, llm.ToolCall{Name: "propose_reflection", Args: args}, now)
		if err != nil || out != nil || !strings.Contains(text, "cast, not a rhythm") {
			t.Fatalf("%v: text=%q out=%v err=%v", ids, text, out, err)
		}
	}
}
