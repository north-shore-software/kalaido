package handlers

import (
	"fmt"
	"log"
	"net/http"
	"strings"

	"github.com/pocketbase/pocketbase/core"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/api"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/ingest"
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
			fragType := strings.TrimSpace(msg.Type)
			if fragType == "" {
				fragType = "note"
			}
			log.Printf("ingest: fragment %s (%s): %s", id, fragType, contentPreview(msg.Content))
		} else {
			log.Printf("ingest: duplicate entry skipped: %s", contentPreview(msg.Content))
		}
		return e.JSON(http.StatusOK, api.IngestResponse{
			FragmentID: id,
			Ingested:   ingested,
		})
	}
}

// contentPreview compacts free text to one quoted log-friendly line.
func contentPreview(s string) string {
	const maxRunes = 120
	compact := strings.Join(strings.Fields(s), " ")
	if r := []rune(compact); len(r) > maxRunes {
		compact = string(r[:maxRunes]) + "…"
	}
	return fmt.Sprintf("%q", compact)
}
