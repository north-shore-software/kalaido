package handlers

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strings"
	"sync"

	"github.com/north-shore-software/kalaido/internal/api"
	"github.com/north-shore-software/kalaido/internal/colour"
	"github.com/north-shore-software/kalaido/internal/llmcontext"
	"github.com/north-shore-software/kalaido/internal/prompts"
	"github.com/north-shore-software/kalaido/internal/usage"
	"github.com/north-shore-software/kalaido/llm"
	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
)

func HandlePreviewColour(app core.App) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		var req api.PreviewColourRequest
		if err := e.BindBody(&req); err != nil {
			return e.BadRequestError("invalid request body", err)
		}

		ctx := e.Request.Context()

		positiveBlock := llmcontext.RenderFragmentRecords(llmcontext.LoadFragmentsByIDs(ctx, app, req.PositiveExamples))
		negativeBlock := llmcontext.RenderFragmentRecords(llmcontext.LoadFragmentsByIDs(ctx, app, req.NegativeExamples))

		recs, err := app.FindRecordsByFilter("fragment", "", "-created", 20, 0, dbx.Params{})
		if err != nil {
			log.Printf("colour preview: find fragments failed: %v", err)
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

		results := make(chan *core.Record, len(recs))
		var wg sync.WaitGroup

		for _, r := range recs {
			wg.Add(1)
			go func(rec *core.Record) {
				defer wg.Done()

				targetDoc := llmcontext.RenderFragmentRecords([]*core.Record{rec})
				prompt := prompts.ColourEvalPrompt(req.Filter.Prompt, positiveBlock, negativeBlock, targetDoc)

				// Tie the evaluation to the request context so it aborts when the
				// client disconnects — the live preview deliberately cancels the
				// prior in-flight request whenever the criteria change, which
				// would otherwise leave these LLM calls running for stale input.
				out, err := usage.GenerateOnce(ctx, app, prompt, llm.RoleColour, nil)
				if err != nil {
					// A canceled context is the expected outcome of that
					// superseded request, not a failure worth logging.
					if ctx.Err() == nil {
						log.Printf("colour preview: evaluation failed for fragment %s: %v", rec.Id, err)
					}
					return
				}

				if strings.Contains(strings.ToUpper(out), "YES") {
					results <- rec
				}
			}(r)
		}

		go func() {
			wg.Wait()
			close(results)
		}()

		for rec := range results {
			jsonData, err := json.Marshal(rec)
			if err != nil {
				log.Printf("colour preview: marshal fragment failed: %v", err)
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

func HandleCreateColour(app core.App) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		var req api.CreateColourRequest
		if err := e.BindBody(&req); err != nil {
			return e.BadRequestError("invalid request body", err)
		}

		collection, _ := app.FindCollectionByNameOrId("colour")
		colourRec := core.NewRecord(collection)
		colourRec.Set("name", req.Name)
		colourRec.Set("criteria", req.Prompt)
		if err := app.Save(colourRec); err != nil {
			return e.InternalServerError("failed to save colour", err)
		}

		// Immediately record any already matched preview fragments
		cfCollection, _ := app.FindCollectionByNameOrId("colour_fragment")
		for _, fragID := range req.FragmentIDs {
			cf := core.NewRecord(cfCollection)
			cf.Set("colour_id", colourRec.Id)
			cf.Set("fragment_id", fragID)
			cf.Set("match_type", "llm_matched_backfill")
			_ = app.Save(cf)
		}

		if req.ApplyRetroactively {
			colour.EnqueueRetroactiveEvaluation(app, colourRec.Id)
		}

		return e.JSON(http.StatusOK, api.CreateColourResponse{
			ColourID: colourRec.Id,
		})
	}
}

func HandleUpdateColour(app core.App) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		id := e.Request.PathValue("id")
		if id == "" {
			return e.BadRequestError("missing id", nil)
		}

		colourRec, err := app.FindRecordById("colour", id)
		if err != nil {
			return e.NotFoundError("colour not found", err)
		}

		var req api.UpdateColourRequest
		if err := e.BindBody(&req); err != nil {
			return e.BadRequestError("invalid request body", err)
		}

		cfCollection, _ := app.FindCollectionByNameOrId("colour_fragment")

		// Remove/Update negative examples
		for _, fragID := range req.NegativeExamples {
			links, err := app.FindRecordsByFilter("colour_fragment", "colour_id = {:col} && fragment_id = {:frag}", "", 1, 0, dbx.Params{
				"col":  colourRec.Id,
				"frag": fragID,
			})
			var cf *core.Record
			if err == nil && len(links) > 0 {
				cf = links[0]
			} else {
				cf = core.NewRecord(cfCollection)
				cf.Set("colour_id", colourRec.Id)
				cf.Set("fragment_id", fragID)
			}
			cf.Set("match_type", "manual_negative")
			_ = app.Save(cf)
		}

		// Add positive examples
		for _, fragID := range req.PositiveExamples {
			links, err := app.FindRecordsByFilter("colour_fragment", "colour_id = {:col} && fragment_id = {:frag}", "", 1, 0, dbx.Params{
				"col":  colourRec.Id,
				"frag": fragID,
			})
			var cf *core.Record
			if err == nil && len(links) > 0 {
				cf = links[0]
			} else {
				cf = core.NewRecord(cfCollection)
				cf.Set("colour_id", colourRec.Id)
				cf.Set("fragment_id", fragID)
			}
			cf.Set("match_type", "manual_positive")
			_ = app.Save(cf)
		}

		updatedPrompt := colourRec.GetString("criteria")

		// Update prompt independently
		if req.Prompt != nil {
			colourRec.Set("criteria", *req.Prompt)
			updatedPrompt = *req.Prompt
		}

		if err := app.Save(colourRec); err != nil {
			return e.InternalServerError("failed to save colour", err)
		}

		return e.JSON(http.StatusOK, api.UpdateColourResponse{
			ColourID: colourRec.Id,
			Prompt:   updatedPrompt,
		})
	}
}
