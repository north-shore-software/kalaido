// UNREVIEWED
package workers

import (
	"context"

	"github.com/pocketbase/pocketbase/core"
	"golang.org/x/sync/errgroup"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/colour"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/discover"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/mapping"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/reconcile"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/workerutil"
)

// Options tune background workers.
type Options struct {
	AutoWave bool
}

// Manager owns, coordinates, and manages the lifecycle of all background workers.
type Manager struct {
	Colour    *colour.Worker
	Mapping   *mapping.Worker
	Reconcile *reconcile.Worker
	Discover  *discover.Worker

	services []workerutil.Service
}

// New constructs all background workers over app and wires their interdependencies.
// Nothing runs until Start is called.
func New(app core.App, opts Options) *Manager {
	maps := mapping.NewWorker(app)
	col := colour.NewWorker(app)
	rec := reconcile.NewWorker(app, reconcile.Options{AutoWave: opts.AutoWave})
	disc := discover.NewWorker(app, maps)

	// Order matters: colour recomputes thing-backed membership from the
	// settled map, then the wave regenerates whatever that membership feeds.
	maps.OnSettle(col.OnMapSettled)
	maps.OnSettle(rec.OnMapSettled)

	// A colour drain that wrote links starts a wave to consume them.
	col.OnDrained(rec.EnqueueWave)

	return &Manager{
		Colour:    col,
		Mapping:   maps,
		Reconcile: rec,
		Discover:  disc,
		services:  []workerutil.Service{col, maps, rec, disc},
	}
}

// Start launches all background workers on their run loops within the provided errgroup.
func (m *Manager) Start(ctx context.Context, g *errgroup.Group) {
	for _, svc := range m.services {
		s := svc
		g.Go(func() error {
			return s.Run(ctx)
		})
	}
}

// BootKicks kicks the workers so work left by a crash or an offline provider
// resumes from the state in the database.
func (m *Manager) BootKicks() {
	m.Colour.Signal()
	m.Mapping.KickIfPending()
	m.Reconcile.LogPolicy()
	m.Reconcile.EnqueueWave()
}
