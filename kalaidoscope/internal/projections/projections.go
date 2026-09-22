// UNREVIEWED
package projections

import (
	"errors"

	"github.com/pocketbase/pocketbase/core"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/engine"
	"github.com/north-shore-software/kalaido/kalaidoscope/schema"
)

var ErrNotFound = errors.New("projection not found")

// Strategy implements engine.Strategy for projections.
type Strategy struct{}

func (s Strategy) TargetType() string             { return "projection" }
func (s Strategy) CollectionName() string         { return schema.ColProjection.String() }
func (s Strategy) LensCollectionName() string     { return schema.ColLens.String() }
func (s Strategy) SnapshotCollectionName() string { return schema.ColProjectionSnapshot.String() }
func (s Strategy) ForeignKeyCol() string          { return "projection_id" }
func (s Strategy) EnsureFragmentsOnly() bool      { return false }

// FindLive loads a projection that is not soft-deleted.
func FindLive(app core.App, id string) (*core.Record, error) {
	return engine.FindLive(app, Strategy{}, id)
}
