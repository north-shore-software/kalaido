package engine

import (
	"context"
	"log/slog"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/api"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/llmcontext"
)

func logger(app core.App) *slog.Logger {
	if app != nil {
		return app.Logger().With("component", "engine")
	}
	return slog.Default().With("component", "engine")
}

type Strategy interface {
	TargetType() string
	CollectionName() string
	LensCollectionName() string
	SnapshotCollectionName() string
	ForeignKeyCol() string
	RefinementForeignKeyCol() string

	EnsureFragmentsOnly() bool

	ApplySnapshotWindow(snap *core.Record, win *api.Window)
	SnapshotWindowFilter(win *api.Window) (string, dbx.Params)

	InheritsCandidateTrigger() bool
	CommitRefinementSnapshot(ctx context.Context, tx core.App, parentRec *core.Record, lensRec *core.Record, output string, pinned llmcontext.PinnedIDs, spec api.ContextSpec, trigger string, refinementID string) (newSnapID string, err error)

	ScrubSpec(spec *api.ContextSpec, id string)
}
