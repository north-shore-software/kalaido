// UNREVIEWED
package handlers

import (
	"net/http"

	"github.com/pocketbase/pocketbase/core"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/mapping"
)

func HandleMapKick(maps *mapping.Worker) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		maps.Signal()
		return e.NoContent(http.StatusAccepted)
	}
}
