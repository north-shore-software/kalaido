// UNREVIEWED
package engine

import (
	"context"
	"errors"
	"sync"
	"time"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/types"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/api"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/llmq"
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

func setSnapshotWindow(rec *core.Record, w *api.Window) {
	SetSnapshotWindow(rec, w)
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

// WindowResult is one window's outcome from GenerateWindows.
type WindowResult struct {
	SnapshotID string
	Err        error
}

// GenerateWindows generates every window at once, one goroutine each, and
// returns their outcomes in the same order. Concurrency is not throttled
// here: every model call passes through llmq, which caps in-flight calls per
// provider (one on local Ollama, wide on hosted APIs), so windows run as
// parallel as the provider allows and no more. A preempted call retries;
// the retry blocks in the scheduler until a slot frees up.
func GenerateWindows(ctx context.Context, app core.App, targetID, status string, strat Strategy, windows []api.Window) []WindowResult {
	results := make([]WindowResult, len(windows))
	var wg sync.WaitGroup
	for i := range windows {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			w := windows[i]
			for {
				id, err := GenerateSnapshot(ctx, app, targetID, status, strat, &w)
				if errors.Is(err, llmq.ErrPreempted) {
					continue
				}
				results[i] = WindowResult{SnapshotID: id, Err: err}
				return
			}
		}(i)
	}
	wg.Wait()
	return results
}
