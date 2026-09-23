package handlers

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/api"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/colour"
	"github.com/north-shore-software/kalaido/kalaidoscope/schema"
	"github.com/pocketbase/pocketbase/core"
)

func HandlePreviewColour(app core.App) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		var req api.PreviewColourRequest
		if err := e.BindBody(&req); err != nil {
			return e.BadRequestError("invalid request body", err)
		}

		session, err := colour.PreparePreview(app)
		if errors.Is(err, colour.ErrNoModel) {
			return e.InternalServerError("no model configured for colour matching", err)
		}
		if err != nil {
			logger().Error("colour preview: find fragments failed", "error", err)
			return e.InternalServerError("failed to fetch fragments", err)
		}

		w := e.Response
		w.Header().Set("Content-Type", "text/event-stream")
		w.Header().Set("Cache-Control", "no-cache")
		w.Header().Set("Connection", "keep-alive")

		flusher, ok := w.(http.Flusher)
		if !ok {
			return e.InternalServerError("streaming unsupported", nil)
		}

		// Commit the 200 + SSE headers up front so the stream opens immediately
		// and the zero-match case is an unambiguous empty stream rather than
		// leaving the status to be inferred on the first (possibly absent) write.
		w.WriteHeader(http.StatusOK)
		flusher.Flush()

		// The 200 is already on the wire: a failed write means the client went
		// away, which ends the stream but is not an error to report.
		_ = session.Run(e.Request.Context(), app, req, func(rec *core.Record) error {
			jsonData, err := json.Marshal(rec)
			if err != nil {
				logger().Warn("colour preview: marshal fragment failed, skipping", "error", err)
				return nil
			}

			_, err = fmt.Fprintf(w, "data: %s\n\n", string(jsonData))
			if err != nil {
				return err
			}
			flusher.Flush()
			return nil
		})
		return nil
	}
}

func HandleCreateColour(app core.App, deps Deps) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		var req api.CreateColourRequest
		if err := e.BindBody(&req); err != nil {
			return e.BadRequestError("invalid request body", err)
		}
		if strings.TrimSpace(req.Name) == "" {
			return e.BadRequestError("name is required", nil)
		}

		colourRec, err := colour.Create(app, colour.CreateParams{
			Name:             req.Name,
			Prompt:           req.Prompt,
			FragmentIDs:      req.FragmentIDs,
			PositiveExamples: req.PositiveExamples,
			NegativeExamples: req.NegativeExamples,
		})
		if err != nil {
			return e.InternalServerError("failed to create colour", err)
		}

		if colourRec.GetString("prompt") != "" {
			deps.Colour.Signal()
		}
		// Seeded members are in scope for any lens that names this colour.
		deps.Reconcile.EnqueueWave()

		return e.JSON(http.StatusOK, api.CreateColourResponse{ColourID: colourRec.Id})
	}
}

func HandleUpdateColour(app core.App, deps Deps) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		colourRec, err := findColour(app, e)
		if err != nil {
			return err
		}
		var req api.UpdateColourRequest
		if err := e.BindBody(&req); err != nil {
			return e.BadRequestError("invalid request body", err)
		}

		updatedRec, promptChanged, err := colour.Update(app, colourRec.Id, colour.UpdateParams{
			Name:             req.Name,
			Prompt:           req.Prompt,
			PositiveExamples: req.PositiveExamples,
			NegativeExamples: req.NegativeExamples,
			ClearExamples:    req.ClearExamples,
		})
		if err != nil {
			return e.InternalServerError("failed to update colour", err)
		}

		if promptChanged {
			if err := deps.Colour.Rematch(updatedRec.Id); err != nil {
				return e.InternalServerError("failed to restart matching", err)
			}
			deps.Reconcile.EnqueueWave()
		}

		return e.JSON(http.StatusOK, api.UpdateColourResponse{
			ColourID: updatedRec.Id,
			Name:     updatedRec.GetString("name"),
			Prompt:   updatedRec.GetString("prompt"),
		})
	}
}

// HandleRematchColour starts the colour over: prompt rows and the watermark
// go, thing rows are recomputed, and the worker re-judges everything.
func HandleRematchColour(app core.App, deps Deps) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		colourRec, err := findColour(app, e)
		if err != nil {
			return err
		}
		if err := deps.Colour.Rematch(colourRec.Id); err != nil {
			return e.InternalServerError("failed to restart matching", err)
		}
		deps.Reconcile.EnqueueWave()
		return e.NoContent(http.StatusAccepted)
	}
}

// HandleDeleteColour removes the colour (links cascade) and drops its id from
// every live context spec so no projection or reflection keeps a dangling
// reference. Frozen snapshot specs are history and stay as they are.
func HandleDeleteColour(app core.App) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		colourRec, err := findColour(app, e)
		if err != nil {
			return err
		}
		if err := colour.Delete(app, colourRec.Id); err != nil {
			return e.InternalServerError("failed to delete colour", err)
		}
		return e.NoContent(http.StatusNoContent)
	}
}

func findColour(app core.App, e *core.RequestEvent) (*core.Record, error) {
	id := e.Request.PathValue("id")
	if id == "" {
		return nil, e.BadRequestError("missing id", nil)
	}
	rec, err := app.FindRecordById(schema.ColColour.String(), id)
	if err != nil {
		return nil, e.NotFoundError("colour not found", err)
	}
	return rec, nil
}
