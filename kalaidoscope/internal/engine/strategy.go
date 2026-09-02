package engine

type Strategy interface {
	TargetType() string
	CollectionName() string
	LensCollectionName() string
	SnapshotCollectionName() string
	ForeignKeyCol() string

	EnsureFragmentsOnly() bool
}
