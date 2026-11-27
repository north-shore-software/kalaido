package workers

import (
	"context"

	"github.com/pocketbase/pocketbase/core"
	"golang.org/x/sync/errgroup"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/colour"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/discover"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/mapping"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/workerutil"
)

type Manager struct {
	app      core.App
	Colour   *colour.Worker
	Mapping  *mapping.Worker
	Discover *discover.Worker

	services []workerutil.Service
}

func New(app core.App) *Manager {
	maps := mapping.NewWorker(app)
	col := colour.NewWorker(app)
	disc := discover.NewWorker(app, maps)

	maps.OnSettle(col.OnMapSettled)

	return &Manager{
		app:      app,
		Colour:   col,
		Mapping:  maps,
		Discover: disc,
		services: []workerutil.Service{col, maps, disc},
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
}
