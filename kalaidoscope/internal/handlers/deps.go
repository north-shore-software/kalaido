// UNREVIEWED
package handlers

import (
	"context"
	"log/slog"
	"time"

	"github.com/pocketbase/pocketbase/core"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/api"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/colour"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/discover"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/engine"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/mapping"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/organize"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/reconcile"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/status"
)

func logger(app core.App) *slog.Logger {
	if app != nil {
		return app.Logger().With("component", "handlers")
	}
	return slog.Default().With("component", "handlers")
}

// Deps are the long-lived components a handler reaches beyond the database:
// the background workers it wakes or reads, and the runner that owns any
// work it starts off the request goroutine. The server builds one set and
// hands it to every route that needs it.
type Deps struct {
	Colour    *colour.Worker
	Mapping   *mapping.Worker
	Reconcile *reconcile.Worker
	Discover  *discover.Worker
	Runner    engine.Runner
}

func (d Deps) organizeWorkers() organize.Workers {
	return organize.Workers{Mapping: d.Mapping, Reconcile: d.Reconcile, Discover: d.Discover}
}

func entityStatus(ctx context.Context, app core.App, id string) (api.EntityStatus, error) {
	statuses, err := status.NewEvaluator(app, time.Now()).EvaluateAll(ctx)
	if err != nil {
		return api.EntityStatus{}, err
	}
	for _, s := range statuses {
		if s.ID == id {
			return s, nil
		}
	}
	return api.EntityStatus{}, nil
}

// joinGeneration waits for the generation already running for the target and
// returns its snapshot. Interactive callers pay at most the claim TTL.
func joinGeneration(ctx context.Context, app core.App, strat engine.Strategy, id string, w *api.Window) (string, error) {
	ctx, cancel := context.WithTimeout(ctx, engine.GenerationClaimTTL)
	defer cancel()
	logger(app).Warn("already generating; joining", "target_type", strat.TargetType(), "id", id)
	return engine.AwaitGeneration(ctx, app, strat, id, w)
}
