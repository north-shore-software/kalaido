package mapreader

import (
	"context"
	"strings"

	"github.com/pocketbase/pocketbase/core"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/agent"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/llmcontext"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/mapdoc"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/mapping"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/pbutil"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/prompts"
	"github.com/north-shore-software/kalaido/kalaidoscope/llm"
)

const (
	ThingRowSample    = 30
	ChatFragmentReads = 12
)

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

func New(app core.App, budget int) (*Reader, error) {
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

func NewChatReader(app core.App) (*Reader, error) {
	r, err := New(app, ChatFragmentReads)
	if err != nil {
		return nil, err
	}
	r.exhausted = prompts.ChatReadBudgetExhausted
	return r, nil
}

func ChatReadTools() []llm.Tool {
	return []llm.Tool{
		agent.IDsTool(prompts.ReadThingToolName, prompts.ChatReadThingToolDescription, prompts.ReadThingParamDescription),
		agent.IDsTool(prompts.ReadFragmentToolName, prompts.ChatReadFragmentToolDescription, prompts.ChatReadFragmentParamDescription),
	}
}

func (r *Reader) Reads() int { return r.reads }

func (r *Reader) Dispatch(ctx context.Context, call llm.ToolCall) (result string, ok bool) {
	switch call.Name {
	case prompts.ReadThingToolName:
		return r.ReadThings(agent.IDsArg(call)), true
	case prompts.ReadFragmentToolName:
		return r.ReadFragments(ctx, agent.IDsArg(call)), true
	}
	return "", false
}

func (r *Reader) ReadThings(refs []string) string {
	var parts []string
	if len(refs) > prompts.DiscoverReadThingLimit {
		refs = refs[:prompts.DiscoverReadThingLimit]
		parts = append(parts, prompts.DiscoverTooManyThings(prompts.DiscoverReadThingLimit))
	}
	for _, ref := range refs {
		parts = append(parts, r.ReadThing(strings.TrimSpace(ref)))
	}
	return strings.Join(parts, "\n")
}

func (r *Reader) ReadThing(ref string) string {
	t := mapping.ResolveRef(r.Doc, ref)
	if t == nil {
		return prompts.DiscoverNoThing(ref)
	}
	idxs := r.ByThing[t.ID]
	var rels []string
	for _, rel := range r.Doc.Relationships {
		if rel.From != t.ID && rel.To != t.ID {
			continue
		}
		from, to := r.Doc.Find(rel.From), r.Doc.Find(rel.To)
		if from == nil || to == nil {
			continue
		}
		rels = append(rels, prompts.DiscoverRelationshipLine(from.Name, from.ID, rel.Kind, to.Name, to.ID))
	}
	timeline := map[string]int{}
	for _, i := range idxs {
		d := r.Rows[i].Date
		if len(d) < 7 {
			d = prompts.DiscoverUndated
		} else {
			d = d[:7]
		}
		timeline[d]++
	}
	var sample []prompts.DiscoverRow
	for _, i := range pbutil.SampleEvenly(idxs, ThingRowSample) {
		row := r.Rows[i]
		sample = append(sample, prompts.DiscoverRow{FragmentID: row.FragmentID, Date: row.Date, Title: row.Title, Summary: row.Summary})
	}
	return prompts.DiscoverThingCard(t, rels, len(idxs), timeline, sample)
}

func (r *Reader) ReadFragment(ctx context.Context, id string) string {
	if r.reads >= r.budget {
		return r.exhausted(r.budget)
	}
	recs := llmcontext.LoadFragmentsByIDs(ctx, r.App, []string{id})
	if len(recs) == 0 {
		return prompts.DiscoverNoFragment(id)
	}
	r.reads++
	return llmcontext.RenderFragmentRecords(recs)
}

func (r *Reader) ReadFragments(ctx context.Context, ids []string) string {
	if len(ids) == 0 {
		return prompts.DiscoverNoFragment("")
	}
	var parts []string
	for _, id := range ids {
		id = strings.TrimSpace(id)
		if id == "" {
			continue
		}
		parts = append(parts, r.ReadFragment(ctx, id))
		if r.reads >= r.budget {
			if len(parts) < len(ids) {
				parts = append(parts, r.exhausted(r.budget))
			}
			break
		}
	}
	return strings.Join(parts, "\n")
}
