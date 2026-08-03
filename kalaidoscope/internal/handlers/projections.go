package handlers

import (
	"github.com/pocketbase/pocketbase/core"

	"github.com/north-shore-software/kalaido/internal/engine"
)

func HandleCreateProjection(app core.App) func(e *core.RequestEvent) error {
	return handleCreate(app, engine.ProjectionStrategy{})
}

func HandleGenerateCandidate(app core.App) func(e *core.RequestEvent) error {
	return handleGenerateSnapshot(app, engine.ProjectionStrategy{})
}

func HandleApproveCandidate(app core.App) func(e *core.RequestEvent) error {
	return handleApproveCandidate(app, engine.ProjectionStrategy{})
}

func HandleUpdateProjection(app core.App) func(e *core.RequestEvent) error {
	return handleUpdate(app, engine.ProjectionStrategy{})
}

func HandleDeleteProjection(app core.App) func(e *core.RequestEvent) error {
	return handleDelete(app, engine.ProjectionStrategy{})
}
