package llmcontext

import (
	stdctx "context"

	"github.com/pocketbase/pocketbase/core"
)

func LoadFragmentsByIDs(ctx stdctx.Context, app core.App, ids []string) []*core.Record {
	if len(ids) == 0 {
		return nil
	}
	recs, err := app.FindRecordsByIds("fragment", ids)
	if err != nil {
		return nil
	}
	return recs
}
