package engine

import (
	"crypto/md5"
	"encoding/hex"
	"time"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/types"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/api"
)

// maxGridWindows bounds one enumeration of a grid. A misconfigured spec
// (hourly since 2019) must not turn a status call into a fifty-thousand-row
// walk; the newest windows are the ones kept.
const maxGridWindows = 1000

// WindowKey is the identity a reflection snapshot is filed under: one approval
// chain per key (see statusSnapshotFilter).
func WindowKey(w api.Window) string { return w.Start + "_" + w.End }

// WindowID is the id the API hands out for a window on a reflection's grid,
// stable across evaluations.
func WindowID(reflectionID string, w api.Window) string {
	hash := md5.Sum([]byte(reflectionID + w.Start + w.End))
	return hex.EncodeToString(hash[:])
}

func newWindow(reflectionID string, start, end time.Time) api.Window {
	w := api.Window{
		Start: start.UTC().Format(time.RFC3339),
		End:   end.UTC().Format(time.RFC3339),
	}
	w.ID = WindowID(reflectionID, w)
	return w
}

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

func parseRFC3339(s string) time.Time {
	if s == "" {
		return time.Time{}
	}
	t, err := time.Parse(time.RFC3339, s)
	if err != nil {
		return time.Time{}
	}
	return t
}

func parseDurationOr(s string, fallback time.Duration) time.Duration {
	d, err := time.ParseDuration(s)
	if err != nil || d <= 0 {
		return fallback
	}
	return d
}

// versionLowerBound is the instant from which a window spec version produces
// windows: its Effective From, or its Start Time when that is later (a grid
// origin in the future starts nothing before it). The create handler sets the
// first version's Effective From to its Start Time when that lies in the past,
// which is what makes "summarize from <date>" enumerate history: every grid
// window from then to now is pending. Later versions are effective from the
// moment of the edit, so a cadence change never re-enumerates history.
func versionLowerBound(v api.WindowSpecVersion) time.Time {
	eff := parseRFC3339(v.EffectiveFrom)
	if st := parseRFC3339(v.Spec.StartTime); st.After(eff) {
		return st
	}
	return eff
}

// GridWindows enumerates the windows of one window spec that have completed
// by now, oldest first (spec/model.md §Window Modes). Grid point k falls at
// StartTime + k·Period, k ≥ 1, and ends window k, which covers the Duration
// before it, truncated to StartTime (first-window truncation). Only windows
// ending after lowerBound and at or before now are produced. A missing
// StartTime anchors the grid on lowerBound; a missing Duration means tumbling
// (Duration == Period).
func GridWindows(reflectionID string, spec api.WindowSpec, lowerBound, now time.Time) []api.Window {
	period, err := time.ParseDuration(spec.Period)
	if err != nil || period <= 0 {
		return nil
	}
	duration := parseDurationOr(spec.Duration, period)

	origin := parseRFC3339(spec.StartTime)
	if origin.IsZero() {
		origin = lowerBound
	}
	if origin.IsZero() {
		return nil
	}

	// Smallest k ≥ 1 whose grid point lies strictly after lowerBound.
	k := int64(1)
	if lowerBound.After(origin) {
		k = int64(lowerBound.Sub(origin)/period) + 1
	}

	var windows []api.Window
	for {
		end := origin.Add(time.Duration(k) * period)
		if end.After(now) {
			break
		}
		start := end.Add(-duration)
		if start.Before(origin) {
			start = origin
		}
		windows = append(windows, newWindow(reflectionID, start, end))
		if len(windows) > maxGridWindows {
			windows = windows[1:]
		}
		k++
	}
	return windows
}

// CurrentGridWindows is the grid of the version governing now, from that
// version's lower bound: the windows that are materialized by the passage of
// time alone (spec/model.md §Materialized Windows). Nil for an unscheduled
// reflection.
func CurrentGridWindows(rec *core.Record, now time.Time) []api.Window {
	version, ok := GoverningVersion(LoadWindowSpecVersions(rec), now)
	if !ok || version.Spec.Period == "" {
		return nil
	}
	return GridWindows(rec.Id, version.Spec, versionLowerBound(version), now)
}

// DefaultRefinementWindow is the window a refinement of this reflection
// targets when the caller names none: the current window (the most recently
// completed grid point), or — before the first grid point has passed — the
// trailing window of one Duration ending now, which is "what this summary
// looks like today". Nil for an unscheduled reflection, whose snapshots are
// windowless.
func DefaultRefinementWindow(rec *core.Record, now time.Time) *api.Window {
	version, ok := GoverningVersion(LoadWindowSpecVersions(rec), now)
	if !ok || version.Spec.Period == "" {
		return nil
	}
	if grid := GridWindows(rec.Id, version.Spec, versionLowerBound(version), now); len(grid) > 0 {
		w := grid[len(grid)-1]
		return &w
	}
	period := parseDurationOr(version.Spec.Period, 0)
	duration := parseDurationOr(version.Spec.Duration, period)
	if duration <= 0 {
		return nil
	}
	end := now.UTC().Truncate(time.Minute)
	start := end.Add(-duration)
	if origin := parseRFC3339(version.Spec.StartTime); !origin.IsZero() && origin.After(start) {
		start = origin
	}
	if !start.Before(end) {
		return nil
	}
	w := newWindow(rec.Id, start, end)
	return &w
}

// ParseWindowPart reads a transcript "window" part into an api.Window, nil
// when it names no bounds.
func ParseWindowPart(w api.Window) *api.Window {
	if w.Start == "" || w.End == "" {
		return nil
	}
	return &w
}
