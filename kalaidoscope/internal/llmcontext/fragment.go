// UNREVIEWED
package llmcontext

import (
	stdctx "context"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/sourcedata"
	"github.com/pocketbase/pocketbase/core"
)

func LoadFragmentsByIDs(ctx stdctx.Context, app core.App, ids []string) []*core.Record {
	recs, _ := sourcedata.FindFragmentsByIDs(app, ids)
	return recs
}
