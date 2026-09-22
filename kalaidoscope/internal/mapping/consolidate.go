// UNREVIEWED
package mapping

import (
	"context"
	"fmt"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/types"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/mapdoc"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/prompts"
	"github.com/north-shore-software/kalaido/kalaidoscope/llm"
	"github.com/north-shore-software/kalaido/kalaidoscope/schema"
)

func unintegratedRows(app core.App) ([]*core.Record, error) {
	return app.FindRecordsByFilter(schema.ColFragmentAnnotation.String(), "consolidated_at = ''", "created", 0, 0, nil)
}

func consolidate(ctx context.Context, app core.App) error {
	pending, err := unintegratedRows(app)
	if err != nil {
		return err
	}
	if len(pending) == 0 {
		return nil
	}
	input, err := LoadRows(app)
	if err != nil {
		return err
	}
	cites := make(map[string][]prompts.ThingCitation, len(input))
	for _, row := range input {
		cites[row.FragmentID] = row.Things
	}

	d, err := loadDocument(app)
	if err != nil {
		return err
	}
	model, err := llm.ResolveRole(llm.RoleMap)
	if err != nil {
		return err
	}
	runCol, err := app.FindCollectionByNameOrId(schema.ColMapRun.String())
	if err != nil {
		return err
	}
	run := core.NewRecord(runCol)
	run.Set("status", "running")
	run.Set("generated_by_model", model)
	run.Set("pending_in", len(pending))
	run.Set("version_before", d.version)
	if err := app.Save(run); err != nil {
		return err
	}
	fail := func(err error) error {
		run.Set("status", "error")
		run.Set("error", err.Error())
		if serr := app.Save(run); serr != nil {
			logger(app).Error("save run failed", "error", serr)
		}
		return err
	}

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
		now := types.NowDateTime()
		d.rec.Set("version", d.version+1)
		d.rec.Set("consolidated_at", now)
		if err := d.save(tx); err != nil {
			return err
		}
		for _, r := range pending {
			r.Set("consolidated_at", now)
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
		logger(app).Error("save run failed", "error", err)
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
			t.ID = mapdoc.MintID()
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
		from, to := next.Resolve(r.From), next.Resolve(r.To)
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
			t := next.Resolve(ref)
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
