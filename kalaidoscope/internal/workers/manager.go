package workers

import (
	"context"
	"errors"

	"github.com/pocketbase/pocketbase/core"
	"golang.org/x/sync/errgroup"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/api"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/colour"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/discover"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/engine"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/mapping"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/projections"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/reconcile"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/reflections"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/workerutil"
)

type Options struct {
	AutoWave bool
}

type Manager struct {
	app       core.App
	Colour    *colour.Worker
	Mapping   *mapping.Worker
	Reconcile *reconcile.Worker
	Discover  *discover.Worker

	services []workerutil.Service
}

func New(app core.App, opts Options) *Manager {
	maps := mapping.NewWorker(app)
	col := colour.NewWorker(app)
	rec := reconcile.NewWorker(app, reconcile.Options{AutoWave: opts.AutoWave})
	disc := discover.NewWorker(app, maps)

	maps.OnSettle(col.OnMapSettled)
	maps.OnSettle(rec.OnMapSettled)

	col.OnDrained(rec.EnqueueWave)

	return &Manager{
		app:       app,
		Colour:    col,
		Mapping:   maps,
		Reconcile: rec,
		Discover:  disc,
		services:  []workerutil.Service{col, maps, rec, disc},
	}
}

func (m *Manager) Start(ctx context.Context, g *errgroup.Group) {
	for _, svc := range m.services {
		s := svc
		g.Go(func() error {
			return s.Run(ctx)
		})
	}
}

func (m *Manager) BootKicks() {
	m.Colour.Signal()
	m.Mapping.KickIfPending()
	m.Reconcile.LogPolicy()
	m.Reconcile.EnqueueWave()
}

func (m *Manager) CancelWave() {
	m.Reconcile.CancelWave()
}

func (m *Manager) GenerateProjectionSnapshot(ctx context.Context, id, status string) (string, error) {
	if live, _ := engine.HasLiveClaim(m.app, projections.Strategy{}, id); !live {
		m.CancelWave()
	}
	snapID, err := engine.GenerateSnapshot(ctx, m.app, id, status, projections.Strategy{}, nil)
	if errors.Is(err, engine.ErrGenerationInFlight) {
		snapID, err = engine.JoinGeneration(ctx, m.app, projections.Strategy{}, id, nil)
		if errors.Is(err, engine.ErrGenerationAbandoned) {
			snapID, err = engine.GenerateSnapshot(ctx, m.app, id, status, projections.Strategy{}, nil)
		}
	}
	if err == nil && status == engine.StatusApproved {
		m.Reconcile.EnqueueWave()
	}
	return snapID, err
}

func (m *Manager) GenerateReflectionSnapshot(ctx context.Context, id, status string, window *api.Window) (string, error) {
	if live, _ := engine.HasLiveClaim(m.app, reflections.Strategy{}, id); !live {
		m.CancelWave()
	}
	snapID, err := engine.GenerateSnapshot(ctx, m.app, id, status, reflections.Strategy{}, window)
	if errors.Is(err, engine.ErrGenerationInFlight) {
		snapID, err = engine.JoinGeneration(ctx, m.app, reflections.Strategy{}, id, window)
		if errors.Is(err, engine.ErrGenerationAbandoned) {
			snapID, err = engine.GenerateSnapshot(ctx, m.app, id, status, reflections.Strategy{}, window)
		}
	}
	if err == nil && status == engine.StatusApproved {
		m.Reconcile.EnqueueWave()
	}
	return snapID, err
}

func (m *Manager) GenerateReflectionWindows(ctx context.Context, id, status string, windows []api.Window) []reflections.WindowResult {
	if live, _ := engine.HasLiveClaim(m.app, reflections.Strategy{}, id); !live {
		m.CancelWave()
	}
	results := reflections.GenerateWindows(ctx, m.app, id, status, windows)
	hasApproved := false
	for _, r := range results {
		if r.Err == nil && status == engine.StatusApproved {
			hasApproved = true
			break
		}
	}
	if hasApproved {
		m.Reconcile.EnqueueWave()
	}
	return results
}
