// UNREVIEWED
package handlers

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/api"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/colour"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/llmcontext"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/llmq"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/pbutil"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/prompts"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/usage"
	"github.com/north-shore-software/kalaido/kalaidoscope/llm"
	"github.com/north-shore-software/kalaido/kalaidoscope/schema"
	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
	"golang.org/x/sync/errgroup"
)

// previewWorkers bounds how many fragments a preview judges at once; the
// scheduler still gates the actual model calls.
const previewWorkers = 20

func HandlePreviewColour(app core.App) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		var req api.PreviewColourRequest
		if err := e.BindBody(&req); err != nil {
			return e.BadRequestError("invalid request body", err)
		}

		// RoleColour schedules as idle work by default, but the preview is the
		// one colour call the user actively watches — make it jump the queue.
		ctx := llmq.WithPriority(e.Request.Context(), llmq.Interactive)

		positiveBlock := llmcontext.RenderFragmentRecords(llmcontext.LoadFragmentsByIDs(ctx, app, req.PositiveExamples))
		negativeBlock := llmcontext.RenderFragmentRecords(llmcontext.LoadFragmentsByIDs(ctx, app, req.NegativeExamples))

		recs, err := app.FindRecordsByFilter(schema.ColFragment.String(), "deleted_at = ''", "-created", 20, 0, dbx.Params{})
		if err != nil {
			logger().Error("colour preview: find fragments failed", "error", err)
			return e.InternalServerError("failed to fetch fragments", err)
		}

		// Resolved before the SSE stream commits its 200 — past that point an
		// error can no longer become a status code.
		model, err := llm.ResolveRole(llm.RoleColour)
		if err != nil {
			return e.InternalServerError("no model configured for colour matching", err)
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

		results := make(chan *core.Record, len(recs))
		g := new(errgroup.Group)
		g.SetLimit(previewWorkers)

		for _, rec := range recs {
			g.Go(func() error {
				targetDoc := llmcontext.RenderFragmentRecords([]*core.Record{rec})
				prompt := prompts.ColourEvalPrompt(req.Prompt, positiveBlock, negativeBlock, targetDoc)

				// Tie the evaluation to the request context so it aborts when the
				// client disconnects — the live preview deliberately cancels the
				// prior in-flight request whenever the prompt changes, which
				// would otherwise leave these LLM calls running for stale input.
				out, err := usage.GenerateOnce(ctx, app, prompt, llm.RoleColour, model, nil)
				if err != nil {
					// A canceled context is the expected outcome of that
					// superseded request, not a failure worth logging.
					if ctx.Err() == nil {
						logger().Error("colour preview evaluation failed", "fragment_id", rec.Id, "error", err)
					}
					return nil
				}

				if prompts.ParseYesNo(out) {
					results <- rec
				}
				return nil
			})
		}

		go func() {
			_ = g.Wait()
			close(results)
		}()

		for rec := range results {
			jsonData, err := json.Marshal(rec)
			if err != nil {
				logger().Warn("colour preview: marshal fragment failed, skipping", "error", err)
				continue
			}

			_, err = fmt.Fprintf(w, "data: %s\n\n", string(jsonData))
			if err != nil {
				// Client likely disconnected
				return nil
			}
			flusher.Flush()
		}

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
				logger().Warn("colour create: seeding prompt match failed", "fragment_id", fragID, "error", err)
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
			for _, collection := range []string{"projection", "reflection"} {
				if err := scrubIDFromSpecs(tx, collection, colourIDs, colourRec.Id); err != nil {
					return err
				}
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

// specIDs selects one id list of a context spec, for scrubbing.
type specIDs func(spec *api.ContextSpec) *[]string

func colourIDs(spec *api.ContextSpec) *[]string           { return &spec.ColourIDs }
func sourceProjectionIDs(spec *api.ContextSpec) *[]string { return &spec.SourceProjectionIDs }
func sourceReflectionIDs(spec *api.ContextSpec) *[]string { return &spec.SourceReflectionIDs }

// scrubIDFromSpecs drops one id from the chosen list of every live
// current_context_spec in the collection, so a deleted colour or a
// soft-deleted upstream entity leaves no dangling reference behind.
func scrubIDFromSpecs(app core.App, collection string, field specIDs, id string) error {
	recs, err := app.FindRecordsByFilter(collection, "current_context_spec ~ {:id}", "", 0, 0, dbx.Params{"id": id})
	if err != nil {
		return err
	}
	for _, rec := range recs {
		var spec api.ContextSpec
		if err := rec.UnmarshalJSONField("current_context_spec", &spec); err != nil {
			continue
		}
		list := field(&spec)
		kept := (*list)[:0]
		for _, x := range *list {
			if x != id {
				kept = append(kept, x)
			}
		}
		if len(kept) == len(*list) {
			continue
		}
		*list = kept
		rec.Set("current_context_spec", pbutil.JSONObject(spec))
		if err := app.Save(rec); err != nil {
			return err
		}
	}
	return nil
}
