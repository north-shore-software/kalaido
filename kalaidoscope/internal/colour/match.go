package colour

import (
	"fmt"
	"log"
	"sync"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/mapdoc"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/mapping"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/prompts"
)

// colour_fragment.match_type values. One row per (colour, fragment); when a
// pair could carry several reasons the higher one wins, in this order.
const (
	MatchManualNegative = "manual_negative"
	MatchManualPositive = "manual_positive"
	MatchThing          = "thing"
	MatchPrompt         = "prompt"
)

// rematchMu serialises the mechanical writers: the map-settle hook and the
// handlers both diff-and-write the same rows.
var rematchMu sync.Mutex

// Watermark for the map-settle hook: rematching is a whole-scope pass, so it
// only runs when the map or the annotations changed since the last one.
var (
	settledMu        sync.Mutex
	settledVersion   = -1
	settledAnnotated = -1
)

// ThingIDs returns a colour's thing_ids.
func ThingIDs(rec *core.Record) []string {
	var ids []string
	if err := rec.UnmarshalJSONField("thing_ids", &ids); err != nil {
		return nil
	}
	return ids
}

// OnMapSettled is registered with mapping as a settle hook: after every
// annotate drain and consolidate, thing-backed membership is recomputed from
// the citations, unless nothing changed.
func OnMapSettled(app core.App) {
	_, version, err := mapping.LoadDocument(app)
	if err != nil {
		log.Printf("colour: map version: %v", err)
		return
	}
	annotated, err := app.CountRecords("fragment_annotation")
	if err != nil {
		log.Printf("colour: annotation count: %v", err)
		return
	}
	settledMu.Lock()
	same := version == settledVersion && int(annotated) == settledAnnotated
	settledVersion, settledAnnotated = version, int(annotated)
	settledMu.Unlock()
	if same {
		return
	}
	if err := RematchThings(app); err != nil {
		log.Printf("colour: rematch things: %v", err)
	}
}

// RematchThings recomputes the "thing" rows of every colour from the current
// map and annotations.
func RematchThings(app core.App) error {
	cols, err := app.FindRecordsByFilter("colour", "1=1", "created", 0, 0, nil)
	if err != nil {
		return err
	}
	return rematch(app, cols)
}

// RematchThingsFor recomputes one colour's "thing" rows.
func RematchThingsFor(app core.App, colourID string) error {
	rec, err := app.FindRecordById("colour", colourID)
	if err != nil {
		return err
	}
	return rematch(app, []*core.Record{rec})
}

func rematch(app core.App, cols []*core.Record) error {
	rematchMu.Lock()
	defer rematchMu.Unlock()

	var doc *mapdoc.Document
	var rows []mapping.Row
	var byThing map[string][]int
	for _, c := range cols {
		want := map[string]bool{}
		if ids := ThingIDs(c); len(ids) > 0 {
			if doc == nil {
				var err error
				doc, rows, byThing, err = loadIndex(app)
				if err != nil {
					return err
				}
			}
			for _, ref := range ids {
				t := mapping.ResolveRef(doc, ref)
				if t == nil {
					continue
				}
				for _, i := range byThing[t.ID] {
					want[rows[i].FragmentID] = true
				}
			}
		}
		if err := applyThingRows(app, c.Id, want); err != nil {
			return fmt.Errorf("colour %s: %w", c.Id, err)
		}
	}
	return nil
}

func loadIndex(app core.App) (*mapdoc.Document, []mapping.Row, map[string][]int, error) {
	doc, _, err := mapping.LoadDocument(app)
	if err != nil {
		return nil, nil, nil, err
	}
	rows, err := mapping.LoadRows(app)
	if err != nil {
		return nil, nil, nil, err
	}
	return doc, rows, mapping.IndexRows(doc, rows), nil
}

// applyThingRows diffs the colour's existing rows against the fragments its
// things cite: stale "thing" rows go, missing pairs get a "thing" row, and
// rows of any other type are left alone (they outrank a thing match).
func applyThingRows(app core.App, colourID string, want map[string]bool) error {
	existing, err := app.FindRecordsByFilter("colour_fragment", "colour_id = {:c}", "", 0, 0, dbx.Params{"c": colourID})
	if err != nil {
		return err
	}
	have := make(map[string]bool, len(existing))
	for _, r := range existing {
		fid := r.GetString("fragment_id")
		have[fid] = true
		if r.GetString("match_type") == MatchThing && !want[fid] {
			if err := app.Delete(r); err != nil {
				return err
			}
		}
	}
	for fid := range want {
		if have[fid] {
			continue
		}
		if err := insertLink(app, colourID, fid, MatchThing, ""); err != nil {
			return err
		}
	}
	return nil
}

// MatchPair re-derives one pair mechanically after its manual row was removed:
// if the fragment cites one of the colour's things it gets a "thing" row back.
// A prompt match is not re-judged here; the next rematch does that.
func MatchPair(app core.App, colourID, fragmentID string) error {
	rematchMu.Lock()
	defer rematchMu.Unlock()

	col, err := app.FindRecordById("colour", colourID)
	if err != nil {
		return err
	}
	ids := ThingIDs(col)
	if len(ids) == 0 {
		return nil
	}
	anns, err := app.FindRecordsByFilter("fragment_annotation", "fragment_id = {:f}", "", 1, 0, dbx.Params{"f": fragmentID})
	if err != nil || len(anns) == 0 {
		return err
	}
	var cites []prompts.ThingCitation
	if err := anns[0].UnmarshalJSONField("things", &cites); err != nil {
		return nil
	}
	doc, _, err := mapping.LoadDocument(app)
	if err != nil {
		return err
	}
	wanted := map[string]bool{}
	for _, ref := range ids {
		if t := mapping.ResolveRef(doc, ref); t != nil {
			wanted[t.ID] = true
		}
	}
	for _, c := range cites {
		ref := c.Ref
		if ref == "" {
			ref = c.Name
		}
		if t := mapping.ResolveRef(doc, ref); t != nil && wanted[t.ID] {
			existing, err := findLink(app, colourID, fragmentID)
			if err != nil {
				return err
			}
			if existing != nil {
				return nil
			}
			return insertLink(app, colourID, fragmentID, MatchThing, "")
		}
	}
	return nil
}

// MemberIDs returns the fragments a colour currently holds: every row except
// the exclusions.
func MemberIDs(app core.App, colourID string) ([]string, error) {
	recs, err := app.FindRecordsByFilter("colour_fragment", "colour_id = {:c} && match_type != {:neg}", "", 0, 0, dbx.Params{"c": colourID, "neg": MatchManualNegative})
	if err != nil {
		return nil, err
	}
	ids := make([]string, 0, len(recs))
	for _, r := range recs {
		ids = append(ids, r.GetString("fragment_id"))
	}
	return ids, nil
}

func findLink(app core.App, colourID, fragmentID string) (*core.Record, error) {
	recs, err := app.FindRecordsByFilter("colour_fragment", "colour_id = {:c} && fragment_id = {:f}", "", 1, 0, dbx.Params{"c": colourID, "f": fragmentID})
	if err != nil {
		return nil, err
	}
	if len(recs) == 0 {
		return nil, nil
	}
	return recs[0], nil
}

func insertLink(app core.App, colourID, fragmentID, matchType, model string) error {
	col, err := app.FindCollectionByNameOrId("colour_fragment")
	if err != nil {
		return err
	}
	rec := core.NewRecord(col)
	rec.Set("colour_id", colourID)
	rec.Set("fragment_id", fragmentID)
	rec.Set("match_type", matchType)
	rec.Set("model", model)
	return app.Save(rec)
}

// SetPromptMatch records a prompt match decided outside the worker (the
// create-time preview). A pair that already holds a row keeps it.
func SetPromptMatch(app core.App, colourID, fragmentID, model string) error {
	existing, err := findLink(app, colourID, fragmentID)
	if err != nil || existing != nil {
		return err
	}
	return insertLink(app, colourID, fragmentID, MatchPrompt, model)
}

// SetManual writes a manual example, overriding whatever row the pair holds.
func SetManual(app core.App, colourID, fragmentID, matchType string) error {
	existing, err := findLink(app, colourID, fragmentID)
	if err != nil {
		return err
	}
	if existing == nil {
		return insertLink(app, colourID, fragmentID, matchType, "")
	}
	if existing.GetString("match_type") == matchType {
		return nil
	}
	existing.Set("match_type", matchType)
	existing.Set("model", "")
	return app.Save(existing)
}

// ClearManual removes a manual example and re-derives the pair mechanically.
func ClearManual(app core.App, colourID, fragmentID string) error {
	existing, err := findLink(app, colourID, fragmentID)
	if err != nil {
		return err
	}
	if existing != nil {
		switch existing.GetString("match_type") {
		case MatchManualPositive, MatchManualNegative:
			if err := app.Delete(existing); err != nil {
				return err
			}
		default:
			return nil
		}
	}
	return MatchPair(app, colourID, fragmentID)
}
