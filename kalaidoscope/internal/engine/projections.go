package engine

import "errors"

var ErrProjectionNotFound = errors.New("projection not found")

type ProjectionStrategy struct{}

func (s ProjectionStrategy) TargetType() string             { return "projection" }
func (s ProjectionStrategy) CollectionName() string         { return "projection" }
func (s ProjectionStrategy) LensCollectionName() string     { return "lens" }
func (s ProjectionStrategy) SnapshotCollectionName() string { return "projection_snapshot" }
func (s ProjectionStrategy) ForeignKeyCol() string          { return "projection_id" }
func (s ProjectionStrategy) EnsureFragmentsOnly() bool      { return false }
