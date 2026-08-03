package engine

import (
	"github.com/pocketbase/pocketbase/core"

	"github.com/north-shore-software/kalaido/internal/api"
)

type Strategy interface {
	TargetType() string
	CollectionName() string
	LensCollectionName() string
	SnapshotCollectionName() string
	ForeignKeyCol() string

	EnsureFragmentsOnly() bool

	GetPendingWindows(app core.App, record *core.Record) ([]api.Window, error)
}
