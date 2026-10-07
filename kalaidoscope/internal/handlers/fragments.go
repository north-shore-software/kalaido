package handlers

import (
	"net/http"
	"strings"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/types"

	"github.com/north-shore-software/kalaido/kalaidoscope/schema"
)

// HandleArchiveFragment sets or clears a fragment's archived_at. An archived
// fragment stays on disk and readable by id, but leaves the stream and the
// whole-scope context. The record collection has no update rule for the
// app's user, so this route is the one write path.
func HandleArchiveFragment(app core.App, archive bool) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		id := e.Request.PathValue("id")
		if id == "" {
			return e.BadRequestError("id required", nil)
		}
		rec, err := app.FindRecordById(schema.ColFragment.String(), id)
		if err != nil || rec.GetString("deleted_at") != "" {
			return e.NotFoundError("fragment not found", err)
		}
		if archive == !rec.GetDateTime("archived_at").IsZero() {
			return e.JSON(http.StatusOK, map[string]string{"id": id})
		}
		if archive {
			rec.Set("archived_at", types.NowDateTime())
		} else {
			rec.Set("archived_at", nil)
		}
		if err := app.Save(rec); err != nil {
			logger().Error("archive fragment failed", "id", id, "archive", archive, "error", err)
			return e.InternalServerError("archive fragment failed", err)
		}
		return e.JSON(http.StatusOK, map[string]string{"id": id})
	}
}

// HandleRenameFragment sets the user's title on a fragment; an empty title
// clears it, so the stream falls back to the annotation's. Same write-path
// reasoning as HandleArchiveFragment.
func HandleRenameFragment(app core.App) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		id := e.Request.PathValue("id")
		if id == "" {
			return e.BadRequestError("id required", nil)
		}
		var body struct {
			Title string `json:"title"`
		}
		if err := e.BindBody(&body); err != nil {
			return e.BadRequestError("invalid request body", err)
		}
		rec, err := app.FindRecordById(schema.ColFragment.String(), id)
		if err != nil || rec.GetString("deleted_at") != "" {
			return e.NotFoundError("fragment not found", err)
		}
		title := strings.TrimSpace(body.Title)
		if rec.GetString("title") != title {
			rec.Set("title", title)
			if err := app.Save(rec); err != nil {
				logger().Error("rename fragment failed", "id", id, "error", err)
				return e.InternalServerError("rename fragment failed", err)
			}
		}
		return e.JSON(http.StatusOK, map[string]string{"id": id, "title": title})
	}
}
