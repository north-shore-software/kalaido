package mapping

import (
	"context"
	"fmt"
	"log"
	"sort"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/types"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/mapdoc"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/prompts"
	"github.com/north-shore-software/kalaido/kalaidoscope/llm"
)

func unintegratedRows(app core.App) ([]*core.Record, error) {
	return app.FindRecordsByFilter("fragment_annotation", "folded = false", "created", 0, 0, nil)
}

func consolidate(app core.App) error {
	pending, err := unintegratedRows(app)
	if err != nil {
		return err
	}
	if len(pending) == 0 {
		return nil
	}
	rows, err := app.FindRecordsByFilter("fragment_annotation", "1=1", "created", 0, 0, nil)
	if err != nil {
		return err
	}
	dates, err := fragmentDates(app)
	if err != nil {
		return err
	}
	input := make([]prompts.AnnotationRow, 0, len(rows))
	cites := make(map[string][]prompts.ThingCitation, len(rows))
	for _, r := range rows {
		var things []prompts.ThingCitation
		if err := r.UnmarshalJSONField("things", &things); err != nil {
			things = nil
		}
		fragID := r.GetString("fragment_id")
		cites[fragID] = things
		input = append(input, prompts.AnnotationRow{
			FragmentID: fragID,
			Date:       dates[fragID],
			Title:      r.GetString("title"),
			Summary:    r.GetString("summary"),
			Things:     things,
		})
	}
	sortRowsByDate(input)

	d, err := loadDocument(app)
	if err != nil {
		return err
	}
	model, err := llm.ResolveRole(llm.RoleMap)
	if err != nil {
		return err
	}
	runCol, err := app.FindCollectionByNameOrId("map_run")
	if err != nil {
		return err
	}
	run := core.NewRecord(runCol)
	run.Set("status", "running")
	run.Set("model", model)
	run.Set("pending_in", len(pending))
	run.Set("version_before", d.version)
	if err := app.Save(run); err != nil {
		return err
	}
	fail := func(err error) error {
		run.Set("status", "error")
		run.Set("error", err.Error())
		if serr := app.Save(run); serr != nil {
			log.Printf("mapping: save run: %v", serr)
		}
		return err
	}

	ctx := context.Background()
	msgs := []llm.Message{{Role: "user", Content: prompts.ConsolidatePrompt(d.doc, input)}}
	reply, err := generate(ctx, app, llm.RoleMap, model, msgs)
	if err != nil {
		return fail(err)
	}
	next, ok := prompts.ParseConsolidateReply(reply)
	if !ok {
		msgs = append(msgs,
			llm.Message{Role: "assistant", Content: reply},
			llm.Message{Role: "user", Content: prompts.ConsolidateJSONRetryNudge})
		reply, err = generate(ctx, app, llm.RoleMap, model, msgs)
		if err != nil {
			return fail(err)
		}
		if next, ok = prompts.ParseConsolidateReply(reply); !ok {
			return fail(fmt.Errorf("unparseable map reply"))
		}
	}

	admits, merges := finishDocument(d.doc, next, input, cites)
	d.doc = next
	err = app.RunInTransaction(func(tx core.App) error {
		d.rec.Set("version", d.version+1)
		d.rec.Set("consolidated_at", types.NowDateTime())
		if err := d.save(tx); err != nil {
			return err
		}
		for _, r := range pending {
			r.Set("folded", true)
			if err := tx.Save(r); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		return fail(err)
	}
	run.Set("status", "done")
	run.Set("admits", admits)
	run.Set("merges", merges)
	run.Set("version_after", d.version+1)
	if err := app.Save(run); err != nil {
		log.Printf("mapping: save run: %v", err)
	}
	return nil
}

func finishDocument(prev, next *mapdoc.Document, rows []prompts.AnnotationRow, cites map[string][]prompts.ThingCitation) (admits, merges int) {
	if next.Relationships == nil {
		next.Relationships = []mapdoc.Relationship{}
	}
	kept := map[string]bool{}
	for i := range next.Things {
		t := &next.Things[i]
		if t.ID == "" {
			t.ID = mintID()
			admits++
		}
		kept[t.ID] = true
		t.Kind = mapdoc.NormalizeKind(t.Kind)
		if t.Aliases == nil {
			t.Aliases = []string{}
		}
		t.Fragments = 0
		t.FirstSeen, t.LastSeen = "", ""
		t.ExemplarIDs = []string{}
	}
	for _, t := range prev.Things {
		if !kept[t.ID] {
			merges++
		}
	}
	rels := next.Relationships[:0]
	seen := map[string]bool{}
	for _, r := range next.Relationships {
		from, to := resolveRef(next, r.From), resolveRef(next, r.To)
		if from == nil || to == nil || from.ID == to.ID {
			continue
		}
		key := from.ID + "|" + to.ID + "|" + r.Kind
		if seen[key] {
			continue
		}
		seen[key] = true
		rels = append(rels, mapdoc.Relationship{From: from.ID, To: to.ID, Kind: r.Kind})
	}
	next.Relationships = rels
	for _, row := range rows {
		bumped := map[string]bool{}
		for _, c := range cites[row.FragmentID] {
			ref := c.Ref
			if ref == "" {
				ref = c.Name
			}
			t := resolveRef(next, ref)
			if t == nil || bumped[t.ID] {
				continue
			}
			bumped[t.ID] = true
			t.Fragments++
			if row.Date != "" {
				if t.FirstSeen == "" || row.Date < t.FirstSeen {
					t.FirstSeen = row.Date
				}
				if t.LastSeen == "" || row.Date > t.LastSeen {
					t.LastSeen = row.Date
				}
			}
			if len(t.ExemplarIDs) < maxExemplars {
				t.ExemplarIDs = append(t.ExemplarIDs, row.FragmentID)
			}
		}
	}
	return admits, merges
}

func resolveRef(d *mapdoc.Document, ref string) *mapdoc.Thing {
	if t := d.Find(ref); t != nil {
		return t
	}
	return findByName(d, ref)
}

func fragmentDates(app core.App) (map[string]string, error) {
	recs, err := app.FindRecordsByFilter("fragment", "deleted_at = ''", "", 0, 0, nil)
	if err != nil {
		return nil, err
	}
	dates := make(map[string]string, len(recs))
	for _, r := range recs {
		if st := r.GetDateTime("source_time"); !st.IsZero() {
			dates[r.Id] = st.Time().Format("2006-01-02")
		}
	}
	return dates, nil
}

func sortRowsByDate(rows []prompts.AnnotationRow) {
	sort.SliceStable(rows, func(i, j int) bool { return rows[i].Date < rows[j].Date })
}
