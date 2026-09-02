package discover

import (
	"context"
	"fmt"
	"sort"
	"strings"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/llmcontext"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/mapping"
)

const (
	thingRowSample    = 30
	maxFragmentReads  = 12
	coverageThingList = 10
)

func (c *Context) readThing(id string) string {
	t := mapping.ResolveRef(c.Doc, id)
	if t == nil {
		return fmt.Sprintf("No thing matches %q.", id)
	}
	idxs := c.ByThing[t.ID]
	var b strings.Builder
	fmt.Fprintf(&b, "%s · %s · %s", t.ID, t.Name, t.Kind)
	if len(t.Aliases) > 0 {
		fmt.Fprintf(&b, " · aka %s", strings.Join(t.Aliases, ", "))
	}
	b.WriteString("\n")
	if t.Blurb != "" {
		b.WriteString(t.Blurb + "\n")
	}
	fmt.Fprintf(&b, "%d fragments", len(idxs))
	if t.FirstSeen != "" {
		fmt.Fprintf(&b, ", %s to %s", t.FirstSeen, t.LastSeen)
	}
	b.WriteString("\n")

	var rels []string
	for _, r := range c.Doc.Relationships {
		if r.From != t.ID && r.To != t.ID {
			continue
		}
		from, to := c.Doc.Find(r.From), c.Doc.Find(r.To)
		if from == nil || to == nil {
			continue
		}
		rels = append(rels, fmt.Sprintf("  %s (%s) %s %s (%s)", from.Name, from.ID, r.Kind, to.Name, to.ID))
	}
	if len(rels) > 0 {
		b.WriteString("Relationships:\n" + strings.Join(rels, "\n") + "\n")
	}

	if len(idxs) == 0 {
		b.WriteString("No annotated fragments cite it.\n")
		return b.String()
	}
	b.WriteString("Timeline:\n" + c.timeline(idxs))
	sample := sampleEvenly(idxs, thingRowSample)
	fmt.Fprintf(&b, "Fragments (%d of %d, spread over time):\n", len(sample), len(idxs))
	for _, i := range sample {
		row := c.Rows[i]
		fmt.Fprintf(&b, "  %s · %s · %s (%s)\n", row.Date, row.Title, row.Summary, row.FragmentID)
	}
	return b.String()
}

func (c *Context) timeline(idxs []int) string {
	counts := map[string]int{}
	for _, i := range idxs {
		d := c.Rows[i].Date
		if len(d) < 7 {
			d = "undated"
		} else {
			d = d[:7]
		}
		counts[d]++
	}
	months := make([]string, 0, len(counts))
	for m := range counts {
		months = append(months, m)
	}
	sort.Strings(months)
	var b strings.Builder
	for _, m := range months {
		fmt.Fprintf(&b, "  %s: %d\n", m, counts[m])
	}
	return b.String()
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
		return fmt.Sprintf("Fragment read budget exhausted (%d per run). Work from the summaries you already have.", maxFragmentReads)
	}
	recs := llmcontext.LoadFragmentsByIDs(ctx, c.App, []string{id})
	if len(recs) == 0 {
		return fmt.Sprintf("No fragment with id %q.", id)
	}
	c.reads++
	return llmcontext.RenderFragmentRecords(recs)
}

func (c *Context) listExisting(existing []Existing) string {
	if len(existing) == 0 {
		return "Nothing exists yet."
	}
	var b strings.Builder
	for _, e := range existing {
		fmt.Fprintf(&b, "- %s (%s)", e.Name, e.ID)
		if e.Note != "" {
			fmt.Fprintf(&b, " [%s]", e.Note)
		}
		if e.Description != "" {
			fmt.Fprintf(&b, ": %s", e.Description)
		}
		fmt.Fprintf(&b, " — %d fragments\n", len(e.FragmentIDs))
	}
	return b.String()
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
	total, hit := 0, 0
	for _, row := range c.Rows {
		total++
		if covered[row.FragmentID] {
			hit++
		}
	}
	var b strings.Builder
	pct := 0
	if total > 0 {
		pct = hit * 100 / total
	}
	fmt.Fprintf(&b, "%d of %d annotated fragments (%d%%) sit inside an existing or proposed scope.\n", hit, total, pct)

	type gap struct {
		id, name  string
		uncovered int
		total     int
	}
	var gaps []gap
	for id, idxs := range c.ByThing {
		u := 0
		for _, i := range idxs {
			if !covered[c.Rows[i].FragmentID] {
				u++
			}
		}
		if u == 0 {
			continue
		}
		t := c.Doc.Find(id)
		if t == nil {
			continue
		}
		gaps = append(gaps, gap{id: id, name: t.Name, uncovered: u, total: len(idxs)})
	}
	if len(gaps) == 0 {
		return b.String()
	}
	sort.Slice(gaps, func(i, j int) bool { return gaps[i].uncovered > gaps[j].uncovered })
	if len(gaps) > coverageThingList {
		gaps = gaps[:coverageThingList]
	}
	b.WriteString("Least covered things:\n")
	for _, g := range gaps {
		fmt.Fprintf(&b, "  %s · %s · %d of %d fragments uncovered\n", g.id, g.name, g.uncovered, g.total)
	}
	return b.String()
}
