package discover

import (
	"context"
	"sort"
	"strings"

	"github.com/pocketbase/pocketbase/core"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/llmcontext"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/mapdoc"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/mapping"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/prompts"
	"github.com/north-shore-software/kalaido/kalaidoscope/llm"
)

const (
	thingRowSample    = 30
	maxFragmentReads  = 12
	chatFragmentReads = 12
	coverageThingList = 10
)

// Reader answers the map read tools — read_thing and read_fragment — over one
// snapshot of the map and its annotation rows, with a fragment read budget.
// Discover embeds it in its run Context; chat builds one per turn.
type Reader struct {
	App     core.App
	Doc     *mapdoc.Document
	Version int
	Rows    []mapping.Row
	ByThing map[string][]int

	budget    int
	reads     int
	exhausted func(int) string
}

func NewReader(app core.App, budget int) (*Reader, error) {
	doc, version, err := mapping.LoadDocument(app)
	if err != nil {
		return nil, err
	}
	rows, err := mapping.LoadRows(app)
	if err != nil {
		return nil, err
	}
	return &Reader{
		App:       app,
		Doc:       doc,
		Version:   version,
		Rows:      rows,
		ByThing:   mapping.IndexRows(doc, rows),
		budget:    budget,
		exhausted: prompts.DiscoverReadBudgetExhausted,
	}, nil
}

// NewChatReader is the chat's per-turn reader: the same reads with a per-turn
// budget and wording.
func NewChatReader(app core.App) (*Reader, error) {
	r, err := NewReader(app, chatFragmentReads)
	if err != nil {
		return nil, err
	}
	r.exhausted = prompts.ChatReadBudgetExhausted
	return r, nil
}

// ChatReadTools are the read tools as the chat advertises them: both take an
// ids array.
func ChatReadTools() []llm.Tool {
	return []llm.Tool{
		idsTool(prompts.ReadThingToolName, prompts.ChatReadThingToolDescription, prompts.ReadThingParamDescription),
		idsTool(prompts.ReadFragmentToolName, prompts.ChatReadFragmentToolDescription, prompts.ChatReadFragmentParamDescription),
	}
}

// Reads is how many fragment reads the budget has spent.
func (r *Reader) Reads() int { return r.reads }

// Dispatch answers a read tool call; ok is false for any other tool.
func (r *Reader) Dispatch(ctx context.Context, call llm.ToolCall) (result string, ok bool) {
	switch call.Name {
	case prompts.ReadThingToolName:
		return r.ReadThings(idsArg(call)), true
	case prompts.ReadFragmentToolName:
		return r.ReadFragments(ctx, idsArg(call)), true
	}
	return "", false
}

func (c *Reader) ReadThings(refs []string) string {
	var parts []string
	if len(refs) > prompts.DiscoverReadThingLimit {
		refs = refs[:prompts.DiscoverReadThingLimit]
		parts = append(parts, prompts.DiscoverTooManyThings(prompts.DiscoverReadThingLimit))
	}
	for _, ref := range refs {
		parts = append(parts, c.ReadThing(strings.TrimSpace(ref)))
	}
	return strings.Join(parts, "\n")
}

func (c *Reader) ReadThing(ref string) string {
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

func (c *Reader) ReadFragment(ctx context.Context, id string) string {
	if c.reads >= c.budget {
		return c.exhausted(c.budget)
	}
	recs := llmcontext.LoadFragmentsByIDs(ctx, c.App, []string{id})
	if len(recs) == 0 {
		return prompts.DiscoverNoFragment(id)
	}
	c.reads++
	return llmcontext.RenderFragmentRecords(recs)
}

// ReadFragments reads each id in turn; the budget message ends the list once
// it is spent.
func (c *Reader) ReadFragments(ctx context.Context, ids []string) string {
	if len(ids) == 0 {
		return prompts.DiscoverNoFragment("")
	}
	var parts []string
	for _, id := range ids {
		id = strings.TrimSpace(id)
		if id == "" {
			continue
		}
		parts = append(parts, c.ReadFragment(ctx, id))
		if c.reads >= c.budget {
			if len(parts) < len(ids) {
				parts = append(parts, c.exhausted(c.budget))
			}
			break
		}
	}
	return strings.Join(parts, "\n")
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
	for _, i := range sampleEvenly(info.RowIdx, thingRowSample) {
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
