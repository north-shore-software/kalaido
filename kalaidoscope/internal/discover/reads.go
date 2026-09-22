// UNREVIEWED
package discover

import (
	"sort"
	"strings"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/mapreader"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/pbutil"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/prompts"
)

const (
	maxFragmentReads  = 12
	coverageThingList = 10
)

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

// ReadColours answers read_colour: each colour in depth, over its member rows.
func (c *Context) ReadColours(refs []string) string {
	var parts []string
	if len(refs) > prompts.DiscoverReadThingLimit {
		refs = refs[:prompts.DiscoverReadThingLimit]
		parts = append(parts, prompts.DiscoverTooManyColours(prompts.DiscoverReadThingLimit))
	}
	for _, ref := range refs {
		parts = append(parts, c.ReadColour(strings.TrimSpace(ref)))
	}
	return strings.Join(parts, "\n")
}

func (c *Context) ReadColour(ref string) string {
	info := c.colourByRef(ref)
	if info == nil {
		return prompts.DiscoverNoRecord("colour", ref)
	}
	timeline := map[string]int{}
	for _, i := range info.RowIdx {
		d := c.Rows[i].Date
		if len(d) < 7 {
			d = prompts.DiscoverUndated
		} else {
			d = d[:7]
		}
		timeline[d]++
	}
	var sample []prompts.DiscoverRow
	for _, i := range pbutil.SampleEvenly(info.RowIdx, mapreader.ThingRowSample) {
		row := c.Rows[i]
		sample = append(sample, prompts.DiscoverRow{FragmentID: row.FragmentID, Date: row.Date, Title: row.Title, Summary: row.Summary})
	}
	line := prompts.DiscoverColourLine{
		ID: info.ID, Name: info.Name, ThingNames: info.ThingNames,
		Members: len(info.Members), First: info.First, Last: info.Last,
	}
	return prompts.DiscoverColourCard(line, len(info.RowIdx), timeline, sample)
}

// colourCoverage is the coverage tool for the flows that scope by colour:
// only projection and reflection scopes count as covering (a colour is the
// unit being covered, not a cover), and the gaps are colours.
func (c *Context) colourCoverage(existing []Existing) string {
	covered := map[string]bool{}
	for id := range c.covered {
		covered[id] = true
	}
	for _, e := range existing {
		if e.Kind != "projection" && e.Kind != "reflection" {
			continue
		}
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
	for _, info := range c.Colours {
		u := 0
		for _, i := range info.RowIdx {
			if !covered[c.Rows[i].FragmentID] {
				u++
			}
		}
		if u == 0 {
			continue
		}
		gaps = append(gaps, prompts.DiscoverGap{ID: info.ID, Name: info.Name, Uncovered: u, Total: len(info.RowIdx)})
	}
	sort.Slice(gaps, func(i, j int) bool { return gaps[i].Uncovered > gaps[j].Uncovered })
	if len(gaps) > coverageThingList {
		gaps = gaps[:coverageThingList]
	}
	return prompts.DiscoverColourCoverage(hit, len(c.Rows), gaps)
}
