package handlers

import (
	"log"
	"net/http"
	"strings"

	"github.com/pocketbase/pocketbase/core"

	"github.com/north-shore-software/kalaido/internal/api"
	"github.com/north-shore-software/kalaido/internal/ingest"
)

func HandleIngest(app core.App) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		msg := api.IngestMessage{}
		if err := e.BindBody(&msg); err != nil {
			return e.BadRequestError("invalid request body", err)
		}
		if strings.TrimSpace(msg.Content) == "" {
			return e.BadRequestError("content required", nil)
		}

		id, err := ingest.IngestSingle(app, msg)
		if err != nil {
			log.Printf("ingest: single entry failed: %v", err)
			return e.InternalServerError("ingest failed", err)
		}

		ingested := 0
		if id != "" {
			ingested = 1
		}
		return e.JSON(http.StatusOK, api.IngestResponse{
			FragmentID: id,
			Ingested:   ingested,
		})
	}
}
