// UNREVIEWED
package handlers

import (
	"fmt"
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
		// These configure file ingest (the `ingest` collection). A single
		// inline entry has nothing for them to apply to, so rather than
		// silently ignore them, say so.
		if msg.Format != "" || msg.Limit != 0 || msg.Extensions != "" {
			return e.BadRequestError("format, fragmentLimit and extensions apply to file ingest only", nil)
		}

		id, err := ingest.IngestSingle(app, msg)
		if err != nil {
			logger(app).Error("ingest failed", "error", err)
			return e.InternalServerError("ingest failed", err)
		}

		ingested := 0
		if id != "" {
			ingested = 1
			fragType := strings.TrimSpace(msg.Type)
			if fragType == "" {
				fragType = "note"
			}
			logger(app).Info("ingested fragment", "fragment_id", id, "fragment_type", fragType, "content", contentPreview(msg.Content))
		} else {
			logger(app).Warn("duplicate entry skipped", "content", contentPreview(msg.Content))
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
