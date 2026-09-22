// UNREVIEWED
package reflections

import (
	"crypto/md5"
	"encoding/hex"
	"sort"
	"time"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/api"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/engine"
	"github.com/north-shore-software/kalaido/kalaidoscope/schema"
)

// MaxGridWindows bounds one enumeration of a grid. A misconfigured spec
// (hourly since 2019) must not turn a status call into a fifty-thousand-row
// walk; the newest windows are the ones kept.
const MaxGridWindows = 1000

// WindowKey is a window's in-memory identity (start_end), used to join the
// grid, the backfilled windows and the snapshot rows in SeriesWindows and
// served to the client as WindowInfo.Key. It is never stored: rows carry the
// bounds themselves as window_start / window_end.
func WindowKey(w api.Window) string { return w.Start + "_" + w.End }

// SnapshotWindow is the window a reflection_snapshot or reflection_window
// row is filed under, or nil when the row is windowless.
func SnapshotWindow(rec *core.Record) *api.Window {
	start, end := rec.GetDateTime("window_start"), rec.GetDateTime("window_end")
	if start.IsZero() || end.IsZero() {
		return nil
	}
	w := newWindow(rec.GetString("reflection_id"), start.Time(), end.Time())
	return &w
}

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
		if len(windows) > MaxGridWindows {
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

// WindowState is one window of a reflection's series with what the store
// holds for it.
type WindowState struct {
	api.Window
	Key         string
	HasApproved bool
	Generating  bool
	Backfilled  bool
	LensID      string
	approvedSeq int
}

// SeriesWindows is a reflection's materialized windows, oldest first
// (spec/model.md §Materialized Windows): the governing version's grid since
// its lower bound, every explicitly backfilled window, and every window that
// already has an approved snapshot — the last so that windows generated under
// an earlier schedule version stay in the series after an edit.
func SeriesWindows(app core.App, rec *core.Record, now time.Time) []WindowState {
	byKey := make(map[string]*WindowState)
	var order []string
	add := func(w api.Window, backfilled bool) *WindowState {
		key := WindowKey(w)
		if st, ok := byKey[key]; ok {
			st.Backfilled = st.Backfilled || backfilled
			return st
		}
		if w.ID == "" {
			w.ID = WindowID(rec.Id, w)
		}
		st := &WindowState{Window: w, Key: key, Backfilled: backfilled}
		byKey[key] = st
		order = append(order, key)
		return st
	}

	for _, w := range CurrentGridWindows(rec, now) {
		add(w, false)
	}

	backfills, _ := app.FindRecordsByFilter(schema.ColReflectionWindow.String(),
		"reflection_id = {:id}", "window_start", 0, 0, dbx.Params{"id": rec.Id})
	for _, b := range backfills {
		if w := SnapshotWindow(b); w != nil {
			add(*w, true)
		}
	}

	snaps, _ := app.FindRecordsByFilter(schema.ColReflectionSnapshot.String(),
		"reflection_id = {:id} && window_start != '' && (status = 'approved' || status = 'generating')",
		"", 0, 0, dbx.Params{"id": rec.Id})
	for _, s := range snaps {
		w := SnapshotWindow(s)
		if w == nil {
			continue
		}
		st := add(*w, false)
		switch s.GetString("status") {
		case engine.StatusApproved:
			st.HasApproved = true
			if seq := s.GetInt("approval_sequence_number"); seq >= st.approvedSeq {
				st.approvedSeq = seq
				st.LensID = s.GetString("lens_id")
			}
		case engine.StatusGenerating:
			st.Generating = true
		}
	}
	out := make([]WindowState, 0, len(order))
	for _, key := range order {
		out = append(out, *byKey[key])
	}
	sort.SliceStable(out, func(i, j int) bool {
		if out[i].Start != out[j].Start {
			return out[i].Start < out[j].Start
		}
		return out[i].End < out[j].End
	})
	return out
}

// PendingWindows are the materialized windows that still need a snapshot:
// no approved output yet and no generation in flight. Oldest first, so a
// catch-up (or a backfill) walks history forward.
func PendingWindows(app core.App, rec *core.Record, now time.Time) []api.Window {
	var pending []api.Window
	for _, st := range SeriesWindows(app, rec, now) {
		if st.HasApproved || st.Generating {
			continue
		}
		pending = append(pending, st.Window)
	}
	return pending
}
