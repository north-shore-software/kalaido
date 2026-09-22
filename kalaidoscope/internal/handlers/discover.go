// UNREVIEWED
package handlers

import (
	"net/http"

	"github.com/pocketbase/pocketbase/core"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/api"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/discover"
)

func HandleDiscoverKick(disc *discover.Worker) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		var req api.StartDiscoverRequest
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
		disc.Signal(req.Kind)
		return e.NoContent(http.StatusAccepted)
	}
}

// HandleStartDiscover is an alias for HandleDiscoverKick matching api.StartDiscoverRequest.
var HandleStartDiscover = HandleDiscoverKick
