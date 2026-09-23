package sourcedata

import (
	"fmt"
	"sort"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/types"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/api"
	"github.com/north-shore-software/kalaido/kalaidoscope/schema"
)

// FindFragmentByID returns a single fragment record by its id, or an error if not found.
func FindFragmentByID(app core.App, id string) (*core.Record, error) {
	return app.FindRecordById(schema.ColFragment.String(), id)
}

// FindFragmentsByIDs loads fragment records for the given ids. If ids is empty,
// it returns nil, nil without issuing a database query.
func FindFragmentsByIDs(app core.App, ids []string) ([]*core.Record, error) {
	if len(ids) == 0 {
		return nil, nil
	}
	return app.FindRecordsByIds(schema.ColFragment.String(), ids)
}

// WindowClause produces the SQL filter and parameters restricting fragment event dates
// to the [start, end) interval. An empty or invalid window returns an empty clause.
func WindowClause(win *api.Window) (string, dbx.Params) {
	if win == nil || win.Start == "" || win.End == "" {
		return "", dbx.Params{}
	}
	start, err1 := types.ParseDateTime(win.Start)
	end, err2 := types.ParseDateTime(win.End)
	if err1 != nil || err2 != nil || start.IsZero() || end.IsZero() {
		return "", dbx.Params{}
	}
	return " && ((occurred_at != '' && occurred_at >= {:ws} && occurred_at < {:we}) || (occurred_at = '' && created >= {:ws} && created < {:we}))",
		dbx.Params{"ws": start, "we": end}
}

// FindLiveFragments returns all non-deleted fragments matching the optional window.
func FindLiveFragments(app core.App, win *api.Window) ([]*core.Record, error) {
	winClause, winParams := WindowClause(win)
	filter := schema.NotDeleted() + winClause
	return app.FindRecordsByFilter(schema.ColFragment.String(), filter, "", 0, 0, winParams)
}

// FindLiveFragmentIDs returns the IDs of all non-deleted fragments matching the optional window.
func FindLiveFragmentIDs(app core.App, win *api.Window) ([]string, error) {
	recs, err := FindLiveFragments(app, win)
	if err != nil {
		return nil, fmt.Errorf("find live fragment IDs: %w", err)
	}
	ids := make([]string, len(recs))
	for i, r := range recs {
		ids[i] = r.Id
	}
	return ids, nil
}

// FragmentDates returns a map of fragment id to occurred date (YYYY-MM-DD) for all
// non-deleted fragments that have an occurred_at timestamp.
func FragmentDates(app core.App) (map[string]string, error) {
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

// AnnotatedFragmentIDs returns the set of fragment ids that have an annotation row.
func AnnotatedFragmentIDs(app core.App) (map[string]bool, error) {
	recs, err := app.FindRecordsByFilter(schema.ColFragmentAnnotation.String(), "1=1", "", 0, 0, nil)
	if err != nil {
		return nil, err
	}
	ids := make(map[string]bool, len(recs))
	for _, r := range recs {
		ids[r.GetString("fragment_id")] = true
	}
	return ids, nil
}

// PendingAnnotationFragments returns all live fragments that lack a fragment_annotation
// record, ordered with non-import fragments first and then by occurred_at ascending.
func PendingAnnotationFragments(app core.App) ([]*core.Record, error) {
	done, err := AnnotatedFragmentIDs(app)
	if err != nil {
		return nil, err
	}
	recs, err := app.FindRecordsByFilter(schema.ColFragment.String(), schema.NotDeleted(), "", 0, 0, nil)
	if err != nil {
		return nil, err
	}
	var pending []*core.Record
	for _, r := range recs {
		if !done[r.Id] {
			pending = append(pending, r)
		}
	}
	sort.SliceStable(pending, func(i, j int) bool {
		li, lj := pending[i].GetString("ingested_via") == "import", pending[j].GetString("ingested_via") == "import"
		if li != lj {
			return !li
		}
		return pending[i].GetDateTime("occurred_at").Compare(pending[j].GetDateTime("occurred_at")) < 0
	})
	return pending, nil
}

// PendingAnnotationCount returns the count of live fragments awaiting annotation.
func PendingAnnotationCount(app core.App) (int, error) {
	pending, err := PendingAnnotationFragments(app)
	if err != nil {
		return 0, err
	}
	return len(pending), nil
}
