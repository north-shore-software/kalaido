package llmcontext

import (
	stdctx "context"
	"log/slog"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/sourcedata"
	"github.com/pocketbase/pocketbase/core"
)

func logger() *slog.Logger {
	return slog.Default().With("component", "llmcontext")
}

// FragmentIDsForColours returns the members of the given colours: every
// colour_fragment row except manual_negative, which is an exclusion.
func FragmentIDsForColours(ctx stdctx.Context, app core.App, colourIDs []string) []string {
	ids, err := sourcedata.ColourMemberIDs(app, colourIDs...)
	if err != nil {
		logger().Error("colour fragment lookup failed", "error", err)
		return nil
	}
	return ids
}
