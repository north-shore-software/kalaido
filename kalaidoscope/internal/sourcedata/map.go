// UNREVIEWED
package sourcedata

import (
	"sort"

	"github.com/pocketbase/pocketbase/core"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/mapdoc"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/pbutil"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/prompts"
	"github.com/north-shore-software/kalaido/kalaidoscope/schema"
)

// Row represents an annotation row with occurred date and citations.
type Row = prompts.AnnotationRow

// MapIndex encapsulates the map document, its version, the annotation rows,
// and the reverse index mapping Thing IDs to row indices.
type MapIndex struct {
	Doc     *mapdoc.Document
	Version int
	Rows    []Row
	ByThing map[string][]int
}

// LoadDocument loads the workspace map document and its version.
// If no map record exists yet, it creates the initial record with version 0 and an empty body.
func LoadDocument(app core.App) (*mapdoc.Document, int, error) {
	recs, err := app.FindRecordsByFilter(schema.ColKalaidoscopeMap.String(), "1=1", "", 1, 0, nil)
	if err != nil {
		return nil, 0, err
	}
	var rec *core.Record
	if len(recs) > 0 {
		rec = recs[0]
	} else {
		col, err := app.FindCollectionByNameOrId(schema.ColKalaidoscopeMap.String())
		if err != nil {
			return nil, 0, err
		}
		rec = core.NewRecord(col)
		rec.Set("version", 0)
		if err := app.Save(rec); err != nil {
			return nil, 0, err
		}
	}
	doc, _ := mapdoc.Parse(pbutil.RawJSONField(rec, "body"))
	return doc, rec.GetInt("version"), nil
}

// LoadAnnotationRows loads all fragment_annotation records joined with each fragment's
// occurred date (from live fragments), sorted by date ascending.
func LoadAnnotationRows(app core.App) ([]Row, error) {
	recs, err := app.FindRecordsByFilter(schema.ColFragmentAnnotation.String(), "1=1", "created", 0, 0, nil)
	if err != nil {
		return nil, err
	}
	dates, err := FragmentDates(app)
	if err != nil {
		return nil, err
	}
	rows := make([]Row, 0, len(recs))
	for _, r := range recs {
		var things []prompts.ThingCitation
		if err := r.UnmarshalJSONField("things", &things); err != nil {
			things = nil
		}
		fragID := r.GetString("fragment_id")
		rows = append(rows, Row{
			FragmentID: fragID,
			Date:       dates[fragID],
			Title:      r.GetString("title"),
			Summary:    r.GetString("summary"),
			Things:     things,
		})
	}
	SortRowsByDate(rows)
	return rows, nil
}

// SortRowsByDate sorts annotation rows in-place by Date ascending.
func SortRowsByDate(rows []Row) {
	sort.SliceStable(rows, func(i, j int) bool { return rows[i].Date < rows[j].Date })
}

// IndexRows builds a lookup table mapping each resolved Thing ID to the row indices citing it.
func IndexRows(d *mapdoc.Document, rows []Row) map[string][]int {
	byThing := make(map[string][]int)
	if d == nil {
		return byThing
	}
	for i, row := range rows {
		seen := make(map[string]bool)
		for _, c := range row.Things {
			ref := c.Ref
			if ref == "" {
				ref = c.Name
			}
			t := d.Resolve(ref)
			if t == nil || seen[t.ID] {
				continue
			}
			seen[t.ID] = true
			byThing[t.ID] = append(byThing[t.ID], i)
		}
	}
	return byThing
}

// ResolveRef resolves a thing reference (by exact ID, normalized name, or alias) in the document.
func ResolveRef(d *mapdoc.Document, ref string) *mapdoc.Thing {
	if d == nil {
		return nil
	}
	return d.Resolve(ref)
}

// LoadMapIndex loads the document, annotation rows, and Thing index in a single operation.
func LoadMapIndex(app core.App) (*MapIndex, error) {
	doc, version, err := LoadDocument(app)
	if err != nil {
		return nil, err
	}
	rows, err := LoadAnnotationRows(app)
	if err != nil {
		return nil, err
	}
	return &MapIndex{
		Doc:     doc,
		Version: version,
		Rows:    rows,
		ByThing: IndexRows(doc, rows),
	}, nil
}
