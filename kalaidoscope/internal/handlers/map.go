package handlers

import (
	"net/http"

	"github.com/pocketbase/pocketbase/core"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/mapping"
)

func HandleMapKick(app core.App) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		mapping.Signal()
		return e.NoContent(http.StatusAccepted)
	}
}
