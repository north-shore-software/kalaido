// UNREVIEWED
package mapping

import (
	"sort"

	"github.com/pocketbase/pocketbase/core"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/mapdoc"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/prompts"
	"github.com/north-shore-software/kalaido/kalaidoscope/schema"
)

type Row = prompts.AnnotationRow

func LoadDocument(app core.App) (*mapdoc.Document, int, error) {
	d, err := loadDocument(app)
	if err != nil {
		return nil, 0, err
	}
	return d.doc, d.version, nil
}

func LoadRows(app core.App) ([]Row, error) {
	recs, err := app.FindRecordsByFilter(schema.ColFragmentAnnotation.String(), "1=1", "created", 0, 0, nil)
	if err != nil {
		return nil, err
	}
	dates, err := fragmentDates(app)
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
	sortRowsByDate(rows)
	return rows, nil
}

func fragmentDates(app core.App) (map[string]string, error) {
	recs, err := app.FindRecordsByFilter(schema.ColFragment.String(), schema.NotDeleted(), "", 0, 0, nil)
	if err != nil {
		return nil, err
	}
	dates := make(map[string]string, len(recs))
	for _, r := range recs {
		if st := r.GetDateTime("occurred_at"); !st.IsZero() {
			dates[r.Id] = st.Time().Format("2006-01-02")
		}
	}
	return dates, nil
}

func sortRowsByDate(rows []prompts.AnnotationRow) {
	sort.SliceStable(rows, func(i, j int) bool { return rows[i].Date < rows[j].Date })
}

func ResolveRef(d *mapdoc.Document, ref string) *mapdoc.Thing {
	return d.Resolve(ref)
}

func IndexRows(d *mapdoc.Document, rows []Row) map[string][]int {
	byThing := map[string][]int{}
	for i, row := range rows {
		seen := map[string]bool{}
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

func PendingCount(app core.App) (int, error) { return pendingCount(app) }
