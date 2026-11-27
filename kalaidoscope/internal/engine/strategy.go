package engine

import (
	"log/slog"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/api"
)

func logger() *slog.Logger {
	return slog.Default().With("component", "engine")
}

type Strategy interface {
	TargetType() string
	CollectionName() string
	LensCollectionName() string
	SnapshotCollectionName() string
	ForeignKeyCol() string
	RefinementForeignKeyCol() string

	ApplySnapshotWindow(snap *core.Record, win *api.Window)
	SnapshotWindowFilter(win *api.Window) (string, dbx.Params)

	ScrubSpec(spec *api.ContextSpec, id string)
}
