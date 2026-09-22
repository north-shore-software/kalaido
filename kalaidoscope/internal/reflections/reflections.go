// UNREVIEWED
package reflections

import (
	"errors"

	"github.com/pocketbase/pocketbase/core"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/engine"
	"github.com/north-shore-software/kalaido/kalaidoscope/schema"
)

var ErrNotFound = errors.New("reflection not found")

// Strategy implements engine.Strategy for reflections.
type Strategy struct{}

func (s Strategy) TargetType() string             { return "reflection" }
func (s Strategy) CollectionName() string         { return schema.ColReflection.String() }
func (s Strategy) LensCollectionName() string     { return schema.ColLens.String() }
func (s Strategy) SnapshotCollectionName() string { return schema.ColReflectionSnapshot.String() }
func (s Strategy) ForeignKeyCol() string          { return "reflection_id" }
func (s Strategy) EnsureFragmentsOnly() bool      { return true }

// FindLive loads a reflection that is not soft-deleted.
func FindLive(app core.App, id string) (*core.Record, error) {
	return engine.FindLive(app, Strategy{}, id)
}
