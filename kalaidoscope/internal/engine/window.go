package engine

import (
	"time"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/types"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/api"
)

// WindowBounds parses a window's timestamps for prompt rendering and SQL
// comparison. Zero values for a nil window, so callers can pass one straight
// through to prompts.ApplyPrompt.
func WindowBounds(w *api.Window) (start, end types.DateTime) {
	if w == nil {
		return start, end
	}
	start, _ = types.ParseDateTime(w.Start)
	end, _ = types.ParseDateTime(w.End)
	return start, end
}

// SetSnapshotWindow stamps a window's bounds onto a row; a nil window leaves
// the row windowless.
func SetSnapshotWindow(rec *core.Record, w *api.Window) {
	if w == nil {
		return
	}
	start, end := WindowBounds(w)
	rec.Set("window_start", start)
	rec.Set("window_end", end)
}

// SnapshotWindow is the window a snapshot row is filed under, or nil when the
// row is windowless.
func SnapshotWindow(rec *core.Record) *api.Window {
	start, end := rec.GetDateTime("window_start"), rec.GetDateTime("window_end")
	if start.IsZero() || end.IsZero() {
		return nil
	}
	return &api.Window{
		Start: start.Time().UTC().Format(time.RFC3339),
		End:   end.Time().UTC().Format(time.RFC3339),
	}
}
