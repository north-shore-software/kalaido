package discover

import (
	"testing"
	"time"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/mapdoc"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/mapping"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/prompts"
)

func rhythmContext(rows []mapping.Row, things ...string) *Context {
	doc := &mapdoc.Document{}
	for _, id := range things {
		doc.Things = append(doc.Things, mapdoc.Thing{ID: id, Name: "Thing " + id, Fragments: 99})
	}
	return &Context{Doc: doc, Rows: rows, ByThing: mapping.IndexRows(doc, rows), covered: map[string]bool{}}
}

func row(date string, things ...string) mapping.Row {
	r := mapping.Row{FragmentID: "f-" + date + "-" + things[0], Date: date, Title: "on " + date}
	for _, t := range things {
		r.Things = append(r.Things, prompts.ThingCitation{Ref: t})
	}
	return r
}

func weeklyRows(from string, weeks int, things ...string) []mapping.Row {
	start, _ := time.Parse("2006-01-02", from)
	var rows []mapping.Row
	for k := 0; k < weeks; k++ {
		rows = append(rows, row(start.AddDate(0, 0, 7*k).Format("2006-01-02"), things...))
	}
	return rows
}

func findRhythm(rs []Rhythm, ids ...string) *Rhythm {
	for i := range rs {
		if len(rs[i].ThingIDs) != len(ids) {
			continue
		}
		match := true
		for j := range ids {
			if rs[i].ThingIDs[j] != ids[j] {
				match = false
			}
		}
		if match {
			return &rs[i]
		}
	}
	return nil
}

// A thing cited every Monday for ten weeks is regular at the week grain, and
// its onset is the start of that run — a stray mention months earlier is
// neither the onset nor a reason to lower the regularity below the run's.
func TestThingRhythmOnsetSkipsStrayMention(t *testing.T) {
	rows := append([]mapping.Row{row("2024-06-05", "t_a")}, weeklyRows("2025-03-03", 10, "t_a")...)
	c := rhythmContext(rows, "t_a")
	r := findRhythm(c.thingRhythms(rhythmGrainWeek, 1, nil), "t_a")
	if r == nil {
		t.Fatal("no rhythm for t_a")
	}
	if r.ActiveBuckets != 11 || r.Total != 11 {
		t.Fatalf("active=%d total=%d, want 11/11", r.ActiveBuckets, r.Total)
	}
	if got := r.Onset.Format("2006-01-02"); got != "2025-03-03" {
		t.Fatalf("onset = %s, want 2025-03-03 (the steady run), not the stray 2024 mention", got)
	}
	if r.First.Format("2006-01-02") != "2024-06-03" {
		t.Fatalf("first = %s, want the Monday of the stray mention's week", r.First.Format("2006-01-02"))
	}
	if r.SpanBuckets <= r.ActiveBuckets {
		t.Fatalf("span %d should exceed active %d given the gap", r.SpanBuckets, r.ActiveBuckets)
	}
}

// One burst is not a rhythm: ten fragments in one week are one active bucket.
func TestBurstIsOneBucket(t *testing.T) {
	var rows []mapping.Row
	for i := 0; i < 10; i++ {
		r := row("2025-03-04", "t_b")
		r.FragmentID = r.FragmentID + string(rune('a'+i))
		rows = append(rows, r)
	}
	c := rhythmContext(rows, "t_b")
	r := findRhythm(c.thingRhythms(rhythmGrainWeek, 1, nil), "t_b")
	if r == nil || r.ActiveBuckets != 1 || r.SpanBuckets != 1 || r.Total != 10 {
		t.Fatalf("burst rhythm = %+v, want one active bucket of ten", r)
	}
	if r.Onset.Format("2006-01-02") != "2025-03-03" {
		t.Fatalf("onset = %s, want the burst's Monday", r.Onset.Format("2006-01-02"))
	}
}

// Month grain buckets by calendar month, with consecutive months adjacent
// across a year boundary.
func TestMonthGrainSpansYearBoundary(t *testing.T) {
	rows := []mapping.Row{row("2024-11-10", "t_c"), row("2024-12-02", "t_c"), row("2025-01-20", "t_c"), row("2025-03-01", "t_c")}
	c := rhythmContext(rows, "t_c")
	r := findRhythm(c.thingRhythms(rhythmGrainMonth, 1, nil), "t_c")
	if r == nil || r.ActiveBuckets != 4 || r.SpanBuckets != 5 {
		t.Fatalf("rhythm = %+v, want 4 active of 5 months", r)
	}
	if r.Onset.Format("2006-01-02") != "2024-11-01" {
		t.Fatalf("onset = %s, want 2024-11-01", r.Onset.Format("2006-01-02"))
	}
}

// Pairs count the buckets in which both things are cited in the same
// fragment; a thing cited in most of the workspace is ubiquitous and never
// paired.
func TestPairRhythmsExcludeUbiquitousThings(t *testing.T) {
	// t_u appears on every row (the user); t_a and t_b appear together for
	// four weeks; t_a alone for a further twenty.
	rows := weeklyRows("2025-01-06", 4, "t_a", "t_b", "t_u")
	rows = append(rows, weeklyRows("2025-02-03", 20, "t_a", "t_u")...)
	c := rhythmContext(rows, "t_a", "t_b", "t_u")

	singles := c.thingRhythms(rhythmGrainWeek, 1, nil)
	if u := findRhythm(singles, "t_u"); u == nil || !u.Ubiquitous {
		t.Fatalf("t_u should be flagged ubiquitous: %+v", u)
	}
	if a := findRhythm(singles, "t_a"); a == nil || !a.Ubiquitous {
		t.Fatalf("t_a (24 of 24 rows) is ubiquitous by share too; got %+v", a)
	}

	pairs := c.pairRhythms(rhythmGrainWeek, 1, nil)
	for _, p := range pairs {
		for _, id := range p.ThingIDs {
			if id == "t_u" || id == "t_a" {
				t.Fatalf("ubiquitous thing %s paired: %+v", id, p)
			}
		}
	}
	if len(pairs) != 0 {
		t.Fatalf("with only ubiquitous partners, want no pairs; got %+v", pairs)
	}

	// Drop the ubiquity by adding unrelated rows: the a+b pair now surfaces
	// with exactly its four shared weeks.
	rows = append(rows, weeklyRows("2025-06-02", 40, "t_d")...)
	c = rhythmContext(rows, "t_a", "t_b", "t_u", "t_d")
	pairs = c.pairRhythms(rhythmGrainWeek, 1, nil)
	ab := findRhythm(pairs, "t_a", "t_b")
	if ab == nil || ab.ActiveBuckets != 4 || ab.SpanBuckets != 4 {
		t.Fatalf("a+b pair = %+v, want 4 of 4 weeks", ab)
	}
	if ab.Onset.Format("2006-01-02") != "2025-01-06" {
		t.Fatalf("pair onset = %s", ab.Onset.Format("2006-01-02"))
	}
}

// The restriction passed to the rhythms tool keeps singles to the given
// things and pairs to those containing one of them.
func TestRhythmsRestriction(t *testing.T) {
	rows := weeklyRows("2025-01-06", 5, "t_a", "t_b")
	rows = append(rows, weeklyRows("2025-01-06", 5, "t_c", "t_d")...)
	rows = append(rows, weeklyRows("2025-06-02", 30, "t_e")...)
	c := rhythmContext(rows, "t_a", "t_b", "t_c", "t_d", "t_e")
	only := map[string]bool{"t_a": true}
	singles := c.thingRhythms(rhythmGrainWeek, 1, only)
	if len(singles) != 1 || singles[0].ThingIDs[0] != "t_a" {
		t.Fatalf("singles = %+v, want only t_a", singles)
	}
	pairs := c.pairRhythms(rhythmGrainWeek, 1, only)
	if len(pairs) != 1 || findRhythm(pairs, "t_a", "t_b") == nil {
		t.Fatalf("pairs = %+v, want only a+b", pairs)
	}
}
