package discover

import (
	"sort"
	"time"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/mapping"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/prompts"
)

// Rhythm detection is the reflections flow's evidence: a reflection is about
// a rhythm, not a thing, so the flow needs to know which scopes (one thing,
// or a pair of things cited together) keep producing material at a steady
// cadence, and since when. All of it is computed here from the annotation
// rows; the model only reads the result.
const (
	rhythmGrainWeek  = "week"
	rhythmGrainMonth = "month"

	// A scope needs this many active buckets before it counts as recurring at
	// all, and this many consecutive ones before a run is called the onset.
	rhythmActiveFloor = 3
	rhythmOnsetRun    = 3

	// A thing cited in more than this share of all rows is the ever-present
	// cast (the user, their own company): flagged, and never paired.
	ubiquityShare   = 0.4
	ubiquityMinRows = 20

	rhythmPairLimit    = 25
	rhythmSingleLimit  = 25
	rhythmBucketSample = 12
)

type rhythmBucket struct {
	ordinal int
	start   time.Time
	count   int
	title   string
}

// Rhythm is one scope's cadence at one grain. Buckets holds only the active
// buckets, in order.
type Rhythm struct {
	ThingIDs      []string
	Grain         string
	Total         int
	ActiveBuckets int
	SpanBuckets   int
	First, Last   time.Time
	Onset         time.Time
	Ubiquitous    bool
	buckets       []rhythmBucket
}

func (r Rhythm) regularity() float64 {
	if r.SpanBuckets == 0 {
		return 0
	}
	return float64(r.ActiveBuckets) / float64(r.SpanBuckets)
}

// bucketOf places a row date (YYYY-MM-DD) in a grain bucket: its ordinal
// (consecutive buckets differ by one) and its start date.
func bucketOf(date, grain string) (int, time.Time, bool) {
	if len(date) < 10 {
		return 0, time.Time{}, false
	}
	d, err := time.Parse("2006-01-02", date[:10])
	if err != nil {
		return 0, time.Time{}, false
	}
	switch grain {
	case rhythmGrainWeek:
		// Monday of the ISO week; ordinal = weeks since the epoch's Monday.
		offset := (int(d.Weekday()) + 6) % 7
		monday := d.AddDate(0, 0, -offset)
		return int(monday.Unix()/(7*24*3600)) + 1, monday, true
	default:
		first := time.Date(d.Year(), d.Month(), 1, 0, 0, 0, 0, time.UTC)
		return d.Year()*12 + int(d.Month()) - 1, first, true
	}
}

type rhythmAccumulator struct {
	grain   string
	total   int
	buckets map[int]*rhythmBucket
}

func newRhythmAccumulator(grain string) *rhythmAccumulator {
	return &rhythmAccumulator{grain: grain, buckets: map[int]*rhythmBucket{}}
}

func (a *rhythmAccumulator) add(row mapping.Row) {
	a.total++
	ord, start, ok := bucketOf(row.Date, a.grain)
	if !ok {
		return
	}
	b := a.buckets[ord]
	if b == nil {
		b = &rhythmBucket{ordinal: ord, start: start, title: row.Title}
		a.buckets[ord] = b
	}
	b.count++
}

func (a *rhythmAccumulator) rhythm(thingIDs []string) Rhythm {
	r := Rhythm{ThingIDs: thingIDs, Grain: a.grain, Total: a.total}
	if len(a.buckets) == 0 {
		return r
	}
	for _, b := range a.buckets {
		r.buckets = append(r.buckets, *b)
	}
	sort.Slice(r.buckets, func(i, j int) bool { return r.buckets[i].ordinal < r.buckets[j].ordinal })
	r.ActiveBuckets = len(r.buckets)
	r.First = r.buckets[0].start
	r.Last = r.buckets[len(r.buckets)-1].start
	r.SpanBuckets = r.buckets[len(r.buckets)-1].ordinal - r.buckets[0].ordinal + 1
	r.Onset = onset(r.buckets)
	return r
}

// onset is the start of the first run of rhythmOnsetRun consecutive active
// buckets — the point the rhythm actually began — falling back to the first
// active bucket when no such run exists. A stray mention long before the
// steady stream must not drag a backfill back to it.
func onset(buckets []rhythmBucket) time.Time {
	if len(buckets) == 0 {
		return time.Time{}
	}
	runStart := 0
	for i := 1; i <= len(buckets); i++ {
		if i < len(buckets) && buckets[i].ordinal == buckets[i-1].ordinal+1 {
			continue
		}
		if i-runStart >= rhythmOnsetRun {
			return buckets[runStart].start
		}
		runStart = i
	}
	return buckets[0].start
}

func (c *Context) ubiquitous(thingID string) bool {
	if len(c.Rows) < ubiquityMinRows {
		return false
	}
	return float64(len(c.ByThing[thingID])) > ubiquityShare*float64(len(c.Rows))
}

// thingRhythms scores every thing above the fragment floor (or only `only`,
// when given) at one grain.
func (c *Context) thingRhythms(grain string, floor int, only map[string]bool) []Rhythm {
	var out []Rhythm
	for id, idxs := range c.ByThing {
		if only != nil && !only[id] {
			continue
		}
		if len(idxs) < floor || c.Doc.Find(id) == nil {
			continue
		}
		acc := newRhythmAccumulator(grain)
		for _, i := range idxs {
			acc.add(c.Rows[i])
		}
		r := acc.rhythm([]string{id})
		r.Ubiquitous = c.ubiquitous(id)
		out = append(out, r)
	}
	sortRhythms(out)
	return out
}

// pairRhythms scores pairs of non-ubiquitous things cited in the same rows.
// With `only` set, a pair must include one of the given things.
func (c *Context) pairRhythms(grain string, floor int, only map[string]bool) []Rhythm {
	eligible := map[string]bool{}
	for id, idxs := range c.ByThing {
		if len(idxs) >= floor && c.Doc.Find(id) != nil && !c.ubiquitous(id) {
			eligible[id] = true
		}
	}
	rowThings := make([][]string, len(c.Rows))
	for id := range eligible {
		for _, i := range c.ByThing[id] {
			rowThings[i] = append(rowThings[i], id)
		}
	}
	accs := map[[2]string]*rhythmAccumulator{}
	for i, things := range rowThings {
		if len(things) < 2 {
			continue
		}
		sort.Strings(things)
		for a := 0; a < len(things); a++ {
			for b := a + 1; b < len(things); b++ {
				if only != nil && !only[things[a]] && !only[things[b]] {
					continue
				}
				key := [2]string{things[a], things[b]}
				acc := accs[key]
				if acc == nil {
					acc = newRhythmAccumulator(grain)
					accs[key] = acc
				}
				acc.add(c.Rows[i])
			}
		}
	}
	var out []Rhythm
	for key, acc := range accs {
		r := acc.rhythm([]string{key[0], key[1]})
		if r.ActiveBuckets < rhythmActiveFloor {
			continue
		}
		out = append(out, r)
	}
	sortRhythms(out)
	if len(out) > rhythmPairLimit {
		out = out[:rhythmPairLimit]
	}
	return out
}

func sortRhythms(rs []Rhythm) {
	sort.SliceStable(rs, func(i, j int) bool {
		if rs[i].ActiveBuckets != rs[j].ActiveBuckets && (rs[i].ActiveBuckets < rhythmActiveFloor || rs[j].ActiveBuckets < rhythmActiveFloor) {
			return rs[i].ActiveBuckets > rs[j].ActiveBuckets
		}
		if ri, rj := rs[i].regularity(), rs[j].regularity(); ri != rj {
			return ri > rj
		}
		if rs[i].Total != rs[j].Total {
			return rs[i].Total > rs[j].Total
		}
		return rs[i].ThingIDs[0] < rs[j].ThingIDs[0]
	})
}

// rhythmsBlock renders singles and pairs at a grain for the model. `only`
// restricts both lists to the given things (nil = everything).
func (c *Context) rhythmsBlock(grain string, only map[string]bool) string {
	if grain != rhythmGrainWeek {
		grain = rhythmGrainMonth
	}
	singles := c.thingRhythms(grain, worklistFloor, only)
	if len(singles) > rhythmSingleLimit {
		singles = singles[:rhythmSingleLimit]
	}
	pairs := c.pairRhythms(grain, worklistFloor, only)
	return prompts.DiscoverRhythmsBlock(grain, c.rhythmCards(singles), c.rhythmCards(pairs))
}

func (c *Context) rhythmCards(rs []Rhythm) []prompts.DiscoverRhythm {
	out := make([]prompts.DiscoverRhythm, 0, len(rs))
	for _, r := range rs {
		card := prompts.DiscoverRhythm{
			Grain: r.Grain, Total: r.Total, Active: r.ActiveBuckets, Span: r.SpanBuckets,
			Ubiquitous: r.Ubiquitous,
		}
		for _, id := range r.ThingIDs {
			name := id
			if t := c.Doc.Find(id); t != nil {
				name = t.Name
			}
			card.Things = append(card.Things, prompts.DiscoverRhythmThing{ID: id, Name: name})
		}
		if r.ActiveBuckets > 0 {
			card.First = r.First.Format("2006-01-02")
			card.Last = r.Last.Format("2006-01-02")
			card.Onset = r.Onset.Format("2006-01-02")
		}
		idxs := make([]int, len(r.buckets))
		for i := range idxs {
			idxs[i] = i
		}
		for _, i := range sampleEvenly(idxs, rhythmBucketSample) {
			b := r.buckets[i]
			card.Buckets = append(card.Buckets, prompts.DiscoverBucket{
				Start: b.start.Format("2006-01-02"), Count: b.count, Title: b.title,
			})
		}
		out = append(out, card)
	}
	return out
}
