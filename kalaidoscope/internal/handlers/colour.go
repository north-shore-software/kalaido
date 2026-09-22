// UNREVIEWED
package handlers

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/api"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/colour"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/engine"
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
			logger(app).Error("colour preview: find fragments failed", "error", err)
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

		return session.Run(e.Request.Context(), app, req, func(rec *core.Record) error {
			jsonData, err := json.Marshal(rec)
			if err != nil {
				logger(app).Warn("colour preview: marshal fragment failed, skipping", "error", err)
				return nil
			}

			_, err = fmt.Fprintf(w, "data: %s\n\n", string(jsonData))
			if err != nil {
				// Client likely disconnected
				return err
			}
			flusher.Flush()
			return nil
		})
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

		collection, err := app.FindCollectionByNameOrId(schema.ColColour.String())
		if err != nil {
			return e.InternalServerError("colour collection", err)
		}
		swatch, err := colour.NextSwatch(app)
		if err != nil {
			return e.InternalServerError("colour swatch", err)
		}
		colourRec := core.NewRecord(collection)
		colourRec.Set("name", strings.TrimSpace(req.Name))
		colourRec.Set("prompt", strings.TrimSpace(req.Prompt))
		colourRec.Set("swatch", swatch)
		if err := app.Save(colourRec); err != nil {
			return e.InternalServerError("failed to save colour", err)
		}

		// The preview's matches were judged by this prompt already: record
		// them so the colour has members the moment it appears. The worker
		// skips pairs that hold a row, so they are not judged twice.
		for _, fragID := range req.FragmentIDs {
			if err := colour.SetPromptMatch(app, colourRec.Id, fragID); err != nil {
				logger(app).Warn("colour create: seeding prompt match failed", "fragment_id", fragID, "error", err)
			}
		}
		if err := applyExamples(app, colourRec.Id, req.PositiveExamples, req.NegativeExamples, nil); err != nil {
			return e.InternalServerError("failed to save examples", err)
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

		if err := applyExamples(app, colourRec.Id, req.PositiveExamples, req.NegativeExamples, req.ClearExamples); err != nil {
			return e.InternalServerError("failed to save examples", err)
		}

		if req.Name != nil && strings.TrimSpace(*req.Name) != "" {
			colourRec.Set("name", strings.TrimSpace(*req.Name))
		}
		promptChanged := false
		if req.Prompt != nil {
			next := strings.TrimSpace(*req.Prompt)
			promptChanged = next != colourRec.GetString("prompt")
			colourRec.Set("prompt", next)
		}
		if err := app.Save(colourRec); err != nil {
			return e.InternalServerError("failed to save colour", err)
		}
		if promptChanged {
			if err := deps.Colour.Rematch(colourRec.Id); err != nil {
				return e.InternalServerError("failed to restart matching", err)
			}
			deps.Reconcile.EnqueueWave()
		}

		return e.JSON(http.StatusOK, api.UpdateColourResponse{
			ColourID: colourRec.Id,
			Name:     colourRec.GetString("name"),
			Prompt:   colourRec.GetString("prompt"),
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
		err = app.RunInTransaction(func(tx core.App) error {
			if err := engine.ScrubContextSpecs(tx, "colour", colourRec.Id); err != nil {
				return err
			}
			return tx.Delete(colourRec)
		})
		if err != nil {
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

// applyExamples writes manual rows. Negatives first, then positives, so a
// fragment named in both ends up pinned; clears run last and re-derive the
// pair mechanically.
func applyExamples(app core.App, colourID string, positive, negative, clear []string) error {
	for _, fragID := range negative {
		if err := colour.SetManual(app, colourID, fragID, colour.MatchManualNegative); err != nil {
			return err
		}
	}
	for _, fragID := range positive {
		if err := colour.SetManual(app, colourID, fragID, colour.MatchManualPositive); err != nil {
			return err
		}
	}
	for _, fragID := range clear {
		if err := colour.ClearManual(app, colourID, fragID); err != nil {
			return err
		}
	}
	return nil
}
