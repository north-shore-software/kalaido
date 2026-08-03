package handlers

import (
	"github.com/pocketbase/pocketbase/core"

	"github.com/north-shore-software/kalaido/internal/engine"
)

func HandleCreateReflection(app core.App) func(e *core.RequestEvent) error {
	return handleCreate(app, engine.ReflectionStrategy{})
}

func HandleGenerateReflectionSnapshot(app core.App) func(e *core.RequestEvent) error {
	return handleGenerateSnapshot(app, engine.ReflectionStrategy{})
}

func HandleUpdateReflection(app core.App) func(e *core.RequestEvent) error {
	return handleUpdate(app, engine.ReflectionStrategy{})
}

func HandleDeleteReflection(app core.App) func(e *core.RequestEvent) error {
	return handleDelete(app, engine.ReflectionStrategy{})
}
