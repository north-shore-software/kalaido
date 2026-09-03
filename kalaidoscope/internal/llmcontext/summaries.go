package llmcontext

import (
	stdctx "context"
	"strings"

	"github.com/pocketbase/pocketbase/core"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/mapping"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/prompts"
)

// hydrateSummaries renders fragments as annotation rows: one per fragment, or
// a stub for a fragment not yet annotated. Rows are loaded in one pass and
// filtered in Go — a whole-scope selection is thousands of ids, too many for a
// filter clause.
func hydrateSummaries(ctx stdctx.Context, app core.App, fragmentIDs []string) (string, error) {
	var sb strings.Builder
	rows, err := mapping.LoadRows(app)
	if err != nil {
		return "", err
	}
	byFragment := make(map[string]mapping.Row, len(rows))
	for _, r := range rows {
		byFragment[r.FragmentID] = r
	}
	names := map[string]string{}
	if doc, _, err := mapping.LoadDocument(app); err == nil {
		for _, t := range doc.Things {
			names[t.ID] = t.Name
		}
	}
	recs := LoadFragmentsByIDs(ctx, app, fragmentIDs)
	sortFragmentsByEventTime(recs)
	for _, rec := range recs {
		if row, ok := byFragment[rec.Id]; ok {
			sb.WriteString(prompts.SummaryRowLine(row, names))
			continue
		}
		sb.WriteString(prompts.SummaryStubLine(
			rec.GetString("type"),
			rec.GetString("source"),
			rec.Id,
			fragmentEventDate(rec),
			prompts.SummarySnippet(rec.GetString("content"))))
	}
	sb.WriteString("\n")
	return sb.String(), nil
}

// fragmentEventDate is the fragment's event day: its source time, else the day
// it arrived — the same fallback resolution applies to windows.
func fragmentEventDate(rec *core.Record) string {
	if st := rec.GetDateTime("source_time"); !st.IsZero() {
		return st.Time().Format("2006-01-02")
	}
	if c := rec.GetDateTime("created"); !c.IsZero() {
		return c.Time().Format("2006-01-02")
	}
	return ""
}

func sortFragmentsByEventTime(recs []*core.Record) {
	key := func(r *core.Record) string {
		if st := r.GetDateTime("source_time"); !st.IsZero() {
			return st.String()
		}
		return r.GetDateTime("created").String()
	}
	// Insertion sort keeps the code dependency-free; the slice is already
	// roughly ordered by id lookup and the cost is dwarfed by the DB reads.
	for i := 1; i < len(recs); i++ {
		for j := i; j > 0 && key(recs[j]) < key(recs[j-1]); j-- {
			recs[j], recs[j-1] = recs[j-1], recs[j]
		}
	}
}
