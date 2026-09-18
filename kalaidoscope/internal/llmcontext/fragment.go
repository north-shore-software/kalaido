package llmcontext

import (
	stdctx "context"

	"github.com/north-shore-software/kalaido/kalaidoscope/schema"
	"github.com/pocketbase/pocketbase/core"
)

func LoadFragmentsByIDs(ctx stdctx.Context, app core.App, ids []string) []*core.Record {
	if len(ids) == 0 {
		return nil
	}
	recs, err := app.FindRecordsByIds(schema.ColFragment.String(), ids)
	if err != nil {
		return nil
	}
	return recs
}
