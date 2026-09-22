// UNREVIEWED
package engine

import (
	"log/slog"

	"github.com/pocketbase/pocketbase/core"
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

	EnsureFragmentsOnly() bool
}
