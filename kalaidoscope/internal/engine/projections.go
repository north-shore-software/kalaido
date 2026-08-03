package engine

import (
	"errors"

	"github.com/north-shore-software/kalaido/internal/api"

	"github.com/pocketbase/pocketbase/core"
)

var ErrProjectionNotFound = errors.New("projection not found")

type ProjectionStrategy struct{}

func (s ProjectionStrategy) TargetType() string             { return "projection" }
func (s ProjectionStrategy) CollectionName() string         { return "projection" }
func (s ProjectionStrategy) LensCollectionName() string     { return "lens" }
func (s ProjectionStrategy) SnapshotCollectionName() string { return "projection_snapshot" }
func (s ProjectionStrategy) ForeignKeyCol() string          { return "projection_id" }
func (s ProjectionStrategy) EnsureFragmentsOnly() bool      { return false }
func (s ProjectionStrategy) GetPendingWindows(app core.App, record *core.Record) ([]api.Window, error) {
	return nil, nil
}
