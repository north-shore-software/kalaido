package discover

import (
	"context"
	"sort"
	"strings"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/llmcontext"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/mapping"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/prompts"
)

const (
	thingRowSample    = 30
	maxFragmentReads  = 12
	coverageThingList = 10
)

func (c *Context) readThing(ref string) string {
	t := mapping.ResolveRef(c.Doc, ref)
	if t == nil {
		return prompts.DiscoverNoThing(ref)
	}
	idxs := c.ByThing[t.ID]
	var rels []string
	for _, r := range c.Doc.Relationships {
		if r.From != t.ID && r.To != t.ID {
			continue
		}
		from, to := c.Doc.Find(r.From), c.Doc.Find(r.To)
		if from == nil || to == nil {
			continue
		}
		rels = append(rels, prompts.DiscoverRelationshipLine(from.Name, from.ID, r.Kind, to.Name, to.ID))
	}
	timeline := map[string]int{}
	for _, i := range idxs {
		d := c.Rows[i].Date
		if len(d) < 7 {
			d = prompts.DiscoverUndated
		} else {
			d = d[:7]
		}
		timeline[d]++
	}
	var sample []prompts.DiscoverRow
	for _, i := range sampleEvenly(idxs, thingRowSample) {
		row := c.Rows[i]
		sample = append(sample, prompts.DiscoverRow{FragmentID: row.FragmentID, Date: row.Date, Title: row.Title, Summary: row.Summary})
	}
	return prompts.DiscoverThingCard(t, rels, len(idxs), timeline, sample)
}

func sampleEvenly(idxs []int, n int) []int {
	if len(idxs) <= n {
		return idxs
	}
	out := make([]int, 0, n)
	for k := 0; k < n; k++ {
		out = append(out, idxs[k*len(idxs)/n])
	}
	return out
}

func (c *Context) readFragment(ctx context.Context, id string) string {
	if c.reads >= maxFragmentReads {
		return prompts.DiscoverReadBudgetExhausted(maxFragmentReads)
	}
	recs := llmcontext.LoadFragmentsByIDs(ctx, c.App, []string{id})
	if len(recs) == 0 {
		return prompts.DiscoverNoFragment(id)
	}
	c.reads++
	return llmcontext.RenderFragmentRecords(recs)
}

func (c *Context) listExisting(existing []Existing) string {
	if len(existing) == 0 {
		return prompts.DiscoverExistingNone
	}
	lines := make([]string, 0, len(existing))
	for _, e := range existing {
		lines = append(lines, prompts.DiscoverExistingLine(e.Kind, e.ID, e.Name, e.Description, e.Note, len(e.FragmentIDs)))
	}
	return strings.Join(lines, "\n")
}

func (c *Context) coverage(existing []Existing) string {
	covered := map[string]bool{}
	for id := range c.covered {
		covered[id] = true
	}
	for _, e := range existing {
		for _, id := range e.FragmentIDs {
			covered[id] = true
		}
	}
	hit := 0
	for _, row := range c.Rows {
		if covered[row.FragmentID] {
			hit++
		}
	}
	var gaps []prompts.DiscoverGap
	for id, idxs := range c.ByThing {
		u := 0
		for _, i := range idxs {
			if !covered[c.Rows[i].FragmentID] {
				u++
			}
		}
		t := c.Doc.Find(id)
		if u == 0 || t == nil {
			continue
		}
		gaps = append(gaps, prompts.DiscoverGap{ID: id, Name: t.Name, Uncovered: u, Total: len(idxs)})
	}
	sort.Slice(gaps, func(i, j int) bool { return gaps[i].Uncovered > gaps[j].Uncovered })
	if len(gaps) > coverageThingList {
		gaps = gaps[:coverageThingList]
	}
	return prompts.DiscoverCoverage(hit, len(c.Rows), gaps)
}
