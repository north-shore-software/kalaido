// UNREVIEWED
package colour

import (
	"context"
	"errors"
	"fmt"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
	"golang.org/x/sync/errgroup"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/api"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/llmcontext"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/prompts"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/usage"
	"github.com/north-shore-software/kalaido/kalaidoscope/llm"
	"github.com/north-shore-software/kalaido/kalaidoscope/llm/queue"
	"github.com/north-shore-software/kalaido/kalaidoscope/schema"
)

// PreviewWorkers bounds how many fragments a preview judges at once; the
// scheduler still gates the actual model calls.
const PreviewWorkers = 20

// ErrNoModel indicates no model is configured for colour matching.
var ErrNoModel = errors.New("no model configured for colour matching")

// PreviewSession holds the prepared inputs and resolved model for a preview run.
type PreviewSession struct {
	recs  []*core.Record
	model string
}

// PreparePreview loads the newest live fragments and resolves the colour model
// prior to opening the streaming response.
func PreparePreview(app core.App) (*PreviewSession, error) {
	recs, err := app.FindRecordsByFilter(schema.ColFragment.String(), "deleted_at = ''", "-created", 20, 0, dbx.Params{})
	if err != nil {
		return nil, fmt.Errorf("failed to fetch fragments: %w", err)
	}

	model, err := llm.ResolveRole(llm.RoleColour)
	if err != nil {
		return nil, ErrNoModel
	}

	return &PreviewSession{recs: recs, model: model}, nil
}

// Run executes the parallel judgments and streams matching records to emit.
func (s *PreviewSession) Run(ctx context.Context, app core.App, req api.PreviewColourRequest, emit func(*core.Record) error) error {
	// RoleColour schedules as idle work by default, but the preview is the
	// one colour call the user actively watches — make it jump the queue.
	evalCtx := queue.WithPriority(ctx, queue.Interactive)

	positiveBlock := llmcontext.RenderFragmentRecords(llmcontext.LoadFragmentsByIDs(evalCtx, app, req.PositiveExamples))
	negativeBlock := llmcontext.RenderFragmentRecords(llmcontext.LoadFragmentsByIDs(evalCtx, app, req.NegativeExamples))

	results := make(chan *core.Record, len(s.recs))
	g := new(errgroup.Group)
	g.SetLimit(PreviewWorkers)

	for _, rec := range s.recs {
		g.Go(func() error {
			targetDoc := llmcontext.RenderFragmentRecords([]*core.Record{rec})
			prompt := prompts.ColourEvalPrompt(req.Prompt, positiveBlock, negativeBlock, targetDoc)

			// Tie the evaluation to the request context so it aborts when the
			// client disconnects — the live preview deliberately cancels the
			// prior in-flight request whenever the prompt changes, which
			// would otherwise leave these LLM calls running for stale input.
			out, err := usage.GenerateOnce(evalCtx, app, prompt, llm.RoleColour, s.model, nil)
			if err != nil {
				// A canceled context is the expected outcome of that
				// superseded request, not a failure worth logging.
				if evalCtx.Err() == nil {
					logger(app).Error("colour preview evaluation failed", "fragment_id", rec.Id, "error", err)
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
		if err := emit(rec); err != nil {
			return err
		}
	}

	return nil
}
