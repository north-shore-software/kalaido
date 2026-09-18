package llmcontext

import (
	stdctx "context"
	"fmt"
	"strings"

	"github.com/north-shore-software/kalaido/kalaidoscope/schema"
	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
)

// FragmentIDsForColours returns the members of the given colours: every
// colour_fragment row except manual_negative, which is an exclusion.
func FragmentIDsForColours(ctx stdctx.Context, app core.App, colourIDs []string) []string {
	if len(colourIDs) == 0 {
		return nil
	}
	ors := make([]string, 0, len(colourIDs))
	params := dbx.Params{}
	for i, id := range colourIDs {
		key := fmt.Sprintf("col%d", i)
		ors = append(ors, "colour_id = {:"+key+"}")
		params[key] = id
	}
	params["neg"] = "manual_negative"
	recs, err := app.FindRecordsByFilter(schema.ColColourFragment.String(), "("+strings.Join(ors, " || ")+") && match_type != {:neg}", "", 0, 0, params)
	if err != nil {
		logger().Error("colour fragment lookup failed", "error", err)
		return nil
	}
	seen := make(map[string]bool, len(recs))
	ids := make([]string, 0, len(recs))
	for _, r := range recs {
		fid := r.GetString("fragment_id")
		if fid == "" || seen[fid] {
			continue
		}
		seen[fid] = true
		ids = append(ids, fid)
	}
	return ids
}
