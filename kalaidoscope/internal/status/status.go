// UNREVIEWED
package status

import (
	"context"
	"time"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/api"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/colour"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/discover"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/ingest"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/mapping"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/reconcile"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/sourcedata"
	"github.com/north-shore-software/kalaido/kalaidoscope/schema"
)

// Workers bundles the live workers required to derive in-flight workspace status.
type Workers struct {
	Colour    *colour.Worker
	Mapping   *mapping.Worker
	Reconcile *reconcile.Worker
	Discover  *discover.Worker
}

// Evaluate derives the full Kaleidoscope system status under GET /api/status.
func Evaluate(ctx context.Context, app core.App, now time.Time, w Workers) (api.KalaidoscopeStatus, error) {
	var st api.KalaidoscopeStatus

	fragments, err := app.CountRecords(schema.ColFragment.String(), dbx.NewExp("deleted_at = ''"))
	if err != nil {
		return st, err
	}
	st.Fragments = int(fragments)

	imports, err := ingest.EvaluateStatus(app)
	if err != nil {
		return st, err
	}
	st.Imports = imports

	doc, version, err := sourcedata.LoadDocument(app)
	if err != nil {
		return st, err
	}
	things := 0
	if doc != nil {
		things = len(doc.Things)
	}

	mapStatus, err := mapping.EvaluateStatus(app, w.Mapping, version, int(fragments))
	if err != nil {
		return st, err
	}
	mapStatus.ThingsCount = things
	st.Map = mapStatus

	discoverStatus, err := discover.EvaluateStatus(app, w.Discover, version, things)
	if err != nil {
		return st, err
	}
	st.Discover = discoverStatus

	colourStatus, err := colour.EvaluateStatus(app, w.Colour)
	if err != nil {
		return st, err
	}
	st.Colour = colourStatus

	if w.Reconcile != nil {
		st.Reconcile = w.Reconcile.EvaluateStatus()
	}

	return st, nil
}
