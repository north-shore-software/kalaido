package handlers

import (
	"net/http"

	"github.com/pocketbase/pocketbase/core"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/discover"
)

func HandleDiscoverKick(app core.App) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		var req struct {
			Kind string `json:"kind"`
		}
		if err := e.BindBody(&req); err != nil {
			return e.BadRequestError("invalid request body", err)
		}
		known := false
		for _, k := range discover.Kinds() {
			if k == req.Kind {
				known = true
			}
		}
		if !known {
			return e.BadRequestError("unknown discover kind", nil)
		}
		discover.Signal(req.Kind)
		return e.NoContent(http.StatusAccepted)
	}
}
