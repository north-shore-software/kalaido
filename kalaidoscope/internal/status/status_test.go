package status_test

import (
	"context"
	"testing"
	"time"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/api"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/discover"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/mapping"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/reconcile"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/status"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/testutil"
)

func TestEvaluateEmptyWorkspace(t *testing.T) {
	app := testutil.NewApp(t)

	maps := mapping.NewWorker(app)
	disc := discover.NewWorker(app, maps)
	rec := reconcile.NewWorker(app, reconcile.Options{})

	w := status.Workers{
		Mapping:   maps,
		Discover:  disc,
		Reconcile: rec,
	}

	st, err := status.Evaluate(context.Background(), app, time.Now(), w)
	if err != nil {
		t.Fatalf("Evaluate failed: %v", err)
	}

	if st.Fragments != 0 {
		t.Errorf("Fragments = %d, want 0", st.Fragments)
	}
	if st.Imports.Pending != 0 {
		t.Errorf("Imports.Pending = %d, want 0", st.Imports.Pending)
	}
	if st.Map.State != api.MapStateEmpty {
		t.Errorf("Map.State = %s, want %s", st.Map.State, api.MapStateEmpty)
	}
	if st.Discover.State != api.DiscoverStateNeverRun {
		t.Errorf("Discover.State = %s, want %s", st.Discover.State, api.DiscoverStateNeverRun)
	}
	if st.Reconcile.Running {
		t.Errorf("Reconcile.Running = true, want false")
	}
}

func TestEvaluateWithFragments(t *testing.T) {
	app := testutil.NewApp(t)

	testutil.NewRecord(t, app, "fragment", map[string]any{
		"type":    "note",
		"content": "A test fragment",
	})

	maps := mapping.NewWorker(app)
	disc := discover.NewWorker(app, maps)
	rec := reconcile.NewWorker(app, reconcile.Options{})

	w := status.Workers{
		Mapping:   maps,
		Discover:  disc,
		Reconcile: rec,
	}

	st, err := status.Evaluate(context.Background(), app, time.Now(), w)
	if err != nil {
		t.Fatalf("Evaluate failed: %v", err)
	}

	if st.Fragments != 1 {
		t.Errorf("Fragments = %d, want 1", st.Fragments)
	}
	if st.Map.State != api.MapStateUnannotated {
		t.Errorf("Map.State = %s, want %s", st.Map.State, api.MapStateUnannotated)
	}
}
