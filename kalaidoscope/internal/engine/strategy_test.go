// UNREVIEWED
package engine

import "github.com/north-shore-software/kalaido/kalaidoscope/schema"

type ProjectionStrategy struct{}

func (s ProjectionStrategy) TargetType() string         { return "projection" }
func (s ProjectionStrategy) CollectionName() string     { return schema.ColProjection.String() }
func (s ProjectionStrategy) LensCollectionName() string { return schema.ColLens.String() }
func (s ProjectionStrategy) SnapshotCollectionName() string {
	return schema.ColProjectionSnapshot.String()
}
func (s ProjectionStrategy) ForeignKeyCol() string     { return "projection_id" }
func (s ProjectionStrategy) EnsureFragmentsOnly() bool { return false }

type ReflectionStrategy struct{}

func (s ReflectionStrategy) TargetType() string         { return "reflection" }
func (s ReflectionStrategy) CollectionName() string     { return schema.ColReflection.String() }
func (s ReflectionStrategy) LensCollectionName() string { return schema.ColLens.String() }
func (s ReflectionStrategy) SnapshotCollectionName() string {
	return schema.ColReflectionSnapshot.String()
}
func (s ReflectionStrategy) ForeignKeyCol() string     { return "reflection_id" }
func (s ReflectionStrategy) EnsureFragmentsOnly() bool { return true }
