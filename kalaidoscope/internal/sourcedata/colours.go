// UNREVIEWED
package sourcedata

import (
	"fmt"
	"strings"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"

	"github.com/north-shore-software/kalaido/kalaidoscope/schema"
)

const MatchManualNegative = "manual_negative"

// ColourMemberIDs returns the fragment IDs held by the specified colours.
// It includes all colour_fragment links except manual_negative exclusions.
// The resulting fragment IDs are deduplicated in order of appearance.
func ColourMemberIDs(app core.App, colourIDs ...string) ([]string, error) {
	var valid []string
	for _, id := range colourIDs {
		trimmed := strings.TrimSpace(id)
		if trimmed != "" {
			valid = append(valid, trimmed)
		}
	}
	if len(valid) == 0 {
		return nil, nil
	}

	ors := make([]string, 0, len(valid))
	params := dbx.Params{}
	for i, id := range valid {
		key := fmt.Sprintf("col%d", i)
		ors = append(ors, "colour_id = {:"+key+"}")
		params[key] = id
	}
	params["neg"] = MatchManualNegative

	filter := "(" + strings.Join(ors, " || ") + ") && match_type != {:neg}"
	recs, err := app.FindRecordsByFilter(schema.ColColourFragment.String(), filter, "", 0, 0, params)
	if err != nil {
		return nil, err
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
	return ids, nil
}

// ColourMembersMap loads membership for multiple colours in a single query,
// returning a map of colour ID to its member fragment IDs (excluding manual_negative).
// If colourIDs is empty, it loads membership across all colours.
func ColourMembersMap(app core.App, colourIDs []string) (map[string][]string, error) {
	var valid []string
	for _, id := range colourIDs {
		trimmed := strings.TrimSpace(id)
		if trimmed != "" {
			valid = append(valid, trimmed)
		}
	}

	params := dbx.Params{"neg": MatchManualNegative}
	filter := "match_type != {:neg}"
	if len(valid) > 0 {
		ors := make([]string, 0, len(valid))
		for i, id := range valid {
			key := fmt.Sprintf("col%d", i)
			ors = append(ors, "colour_id = {:"+key+"}")
			params[key] = id
		}
		filter = "(" + strings.Join(ors, " || ") + ") && match_type != {:neg}"
	}

	recs, err := app.FindRecordsByFilter(schema.ColColourFragment.String(), filter, "", 0, 0, params)
	if err != nil {
		return nil, err
	}

	out := make(map[string][]string)
	seen := make(map[string]map[string]bool)
	for _, id := range valid {
		out[id] = nil
	}

	for _, r := range recs {
		cid := r.GetString("colour_id")
		fid := r.GetString("fragment_id")
		if cid == "" || fid == "" {
			continue
		}
		if seen[cid] == nil {
			seen[cid] = make(map[string]bool)
		}
		if !seen[cid][fid] {
			seen[cid][fid] = true
			out[cid] = append(out[cid], fid)
		}
	}

	return out, nil
}

// FindColourByID returns a single colour record by ID.
func FindColourByID(app core.App, id string) (*core.Record, error) {
	return app.FindRecordById(schema.ColColour.String(), id)
}

// FindAllColours returns all colour records ordered by created time.
func FindAllColours(app core.App) ([]*core.Record, error) {
	return app.FindRecordsByFilter(schema.ColColour.String(), "1=1", "created", 0, 0, nil)
}
