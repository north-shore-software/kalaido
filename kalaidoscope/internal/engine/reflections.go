package engine

import (
	"errors"
	"sort"
	"time"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/api"
)

var ErrReflectionNotFound = errors.New("reflection not found")

type ReflectionStrategy struct{}

func (s ReflectionStrategy) TargetType() string             { return "reflection" }
func (s ReflectionStrategy) CollectionName() string         { return "reflection" }
func (s ReflectionStrategy) LensCollectionName() string     { return "lens" }
func (s ReflectionStrategy) SnapshotCollectionName() string { return "reflection_snapshot" }
func (s ReflectionStrategy) ForeignKeyCol() string          { return "reflection_id" }
func (s ReflectionStrategy) EnsureFragmentsOnly() bool      { return true }

// WindowState is one window of a reflection's series with what the store
// holds for it.
type WindowState struct {
	api.Window
	Key string
	// An approved snapshot exists for this window.
	HasApproved bool
	// A generation claim is currently open for it.
	Generating bool
	// Materialized by an explicit backfill rather than by the grid.
	Backfilled bool
	// The lens that produced the window's current approved snapshot.
	LensID string

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

	backfills, _ := app.FindRecordsByFilter("reflection_window",
		"reflection_id = {:id}", "start", 0, 0, dbx.Params{"id": rec.Id})
	for _, b := range backfills {
		add(api.Window{Start: b.GetString("start"), End: b.GetString("end")}, true)
	}

	snaps, _ := app.FindRecordsByFilter("reflection_snapshot",
		"reflection_id = {:id} && window_key != '' && (status = 'approved' || status = 'generating')",
		"", 0, 0, dbx.Params{"id": rec.Id})
	for _, s := range snaps {
		var rw map[string]string
		if err := s.UnmarshalJSONField("resolved_window", &rw); err != nil || rw["start"] == "" || rw["end"] == "" {
			// A claim row carries only the key until it completes.
			continue
		}
		st := add(api.Window{Start: rw["start"], End: rw["end"]}, false)
		switch s.GetString("status") {
		case StatusApproved:
			st.HasApproved = true
			if seq := s.GetInt("approval_sequence_number"); seq >= st.approvedSeq {
				st.approvedSeq = seq
				st.LensID = s.GetString("lens_id")
			}
		case StatusGenerating:
			st.Generating = true
		}
	}
	// Claim rows have a key but no resolved_window yet; mark them by key.
	for _, s := range snaps {
		if s.GetString("status") == StatusGenerating {
			if st, ok := byKey[s.GetString("window_key")]; ok {
				st.Generating = true
			}
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
