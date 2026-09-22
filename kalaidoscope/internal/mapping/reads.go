// UNREVIEWED
package mapping

import (
	"github.com/pocketbase/pocketbase/core"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/mapdoc"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/sourcedata"
)

type Row = sourcedata.Row

func LoadDocument(app core.App) (*mapdoc.Document, int, error) {
	return sourcedata.LoadDocument(app)
}

func LoadRows(app core.App) ([]Row, error) {
	return sourcedata.LoadAnnotationRows(app)
}

func ResolveRef(d *mapdoc.Document, ref string) *mapdoc.Thing {
	return sourcedata.ResolveRef(d, ref)
}

func IndexRows(d *mapdoc.Document, rows []Row) map[string][]int {
	return sourcedata.IndexRows(d, rows)
}

func PendingCount(app core.App) (int, error) {
	return sourcedata.PendingAnnotationCount(app)
}

func sortRowsByDate(rows []Row) {
	sourcedata.SortRowsByDate(rows)
}
