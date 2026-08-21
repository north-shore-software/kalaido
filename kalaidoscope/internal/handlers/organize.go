package handlers

import (
	"net/http"

	"github.com/pocketbase/pocketbase/core"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/organize"
)

func HandleOrganizeKick(app core.App) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		organize.Signal()
		return e.NoContent(http.StatusAccepted)
	}
}
