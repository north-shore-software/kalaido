package workers

import (
	"context"

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

// yieldWave cancels a running background wave so an interactive generation
// for an entity the wave is not already producing gets the provider to
// itself. It reports whether a wave was cut short.
func (m *Manager) yieldWave(strat engine.Strategy, id string) bool {
	if live, _ := engine.HasLiveClaim(m.app, strat, id); live {
		// The wave (or another request) is producing this very entity; the
		// caller joins that run instead of pre-empting it.
		return false
	}
	return m.Reconcile.CancelWave()
}

// afterGenerate asks for a wave when the generation moved the entity on (an
// approved snapshot its dependents have not consumed) or when it cut a wave
// short, so the stale set that wave had not reached is picked up again.
// Whether the request runs is the reconcile worker's policy (AutoWave).
func (m *Manager) afterGenerate(status string, produced bool, yielded bool) {
	if yielded || (produced && status == engine.StatusApproved) {
		m.Reconcile.EnqueueWave()
	}
}

// GenerateProjectionSnapshot generates (or joins the running generation of)
// a projection snapshot on behalf of a request. The generation outlives the
// request (ctx); waiting on someone else's run does not (joinCtx).
func (m *Manager) GenerateProjectionSnapshot(ctx, joinCtx context.Context, id, status string) (string, error) {
	strat := projections.Strategy{}
	yielded := m.yieldWave(strat, id)
	snapID, err := engine.GenerateOrJoin(ctx, joinCtx, m.app, strat, id, status, nil)
	m.afterGenerate(status, err == nil, yielded)
	return snapID, err
}

// GenerateReflectionSnapshot generates (or joins the running generation of)
// one reflection window on behalf of a request; ctx and joinCtx as for
// GenerateProjectionSnapshot.
func (m *Manager) GenerateReflectionSnapshot(ctx, joinCtx context.Context, id, status string, window *api.Window) (string, error) {
	strat := reflections.Strategy{}
	yielded := m.yieldWave(strat, id)
	snapID, err := engine.GenerateOrJoin(ctx, joinCtx, m.app, strat, id, status, window)
	m.afterGenerate(status, err == nil, yielded)
	return snapID, err
}

// GenerateReflectionWindows generates several reflection windows at once on
// behalf of a request; see reflections.GenerateWindows.
func (m *Manager) GenerateReflectionWindows(ctx context.Context, id, status string, windows []api.Window) []reflections.WindowResult {
	yielded := m.yieldWave(reflections.Strategy{}, id)
	results := reflections.GenerateWindows(ctx, m.app, id, status, windows)
	produced := false
	for _, r := range results {
		if r.Err == nil {
			produced = true
			break
		}
	}
	m.afterGenerate(status, produced, yielded)
	return results
}
