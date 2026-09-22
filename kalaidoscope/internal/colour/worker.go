// UNREVIEWED
// Package colour keeps colour_fragment in step with each colour's definition.
// Thing-backed membership is mechanical (match.go); prompt-backed membership
// is judged by the colour role in a watermark worker (this file): every colour
// with a prompt records the newest fragment it has judged, and a drain walks
// each colour forward from there. A prompt edit resets the watermark. There is
// no queue to lose: the watermark is the state, so a restart resumes.
package colour

import (
	"context"
	"errors"
	"log/slog"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/llmcontext"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/llmq"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/prompts"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/usage"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/workerutil"
	"github.com/north-shore-software/kalaido/kalaidoscope/llm"
	"github.com/north-shore-software/kalaido/kalaidoscope/schema"
)

const (
	pageSize     = 200
	exampleLimit = 20
)

func logger(app core.App) *slog.Logger {
	if app != nil {
		return app.Logger().With("component", "colour")
	}
	return slog.Default().With("component", "colour")
}

// Worker is the prompt-matching worker: one per process, owned by the
// server, woken by Signal and drained on its own goroutine (Run).
type Worker struct {
	app     core.App
	logger  *slog.Logger
	signal  workerutil.Signal
	drained []func()
	settled *settledMark
}

// NewWorker builds the worker over app. Nothing runs until Run.
func NewWorker(app core.App) *Worker {
	return &Worker{app: app, logger: logger(app), signal: workerutil.NewSignal(), settled: newSettledMark()}
}

// Signal asks the worker to drain. Coalesces.
func (w *Worker) Signal() {
	w.signal.Notify()
}

// OnDrained registers fn to run after any drain that wrote links. Register
// before Run; the slice is not guarded.
func (w *Worker) OnDrained(fn func()) {
	w.drained = append(w.drained, fn)
}

// Run drains on every signal until ctx is cancelled, then returns ctx.Err().
// A drain in progress finishes its current colour page first.
func (w *Worker) Run(ctx context.Context) error {
	for {
		if err := w.signal.Wait(ctx); err != nil {
			return err
		}
		wrote, err := drain(ctx, w.app)
		if err != nil && !errors.Is(err, context.Canceled) {
			w.logger.Error("drain failed", "error", err)
		}
		if wrote > 0 {
			for _, fn := range w.drained {
				fn()
			}
		}
	}
}

// Rematch restarts a colour from scratch: prompt rows go, the watermark
// resets, thing rows are recomputed, and the worker is kicked. Used when the
// prompt changes or the user asks for it.
func (w *Worker) Rematch(colourID string) error {
	app := w.app
	rec, err := app.FindRecordById(schema.ColColour.String(), colourID)
	if err != nil {
		return err
	}
	rows, err := app.FindRecordsByFilter(schema.ColColourFragment.String(), "colour_id = {:c} && match_type = {:t}", "", 0, 0, dbx.Params{"c": colourID, "t": MatchPrompt})
	if err != nil {
		return err
	}
	for _, r := range rows {
		if err := app.Delete(r); err != nil {
			return err
		}
	}
	rec.Set("prompt_match_completed_up_to_fragment_id", "")
	if err := app.Save(rec); err != nil {
		return err
	}
	if err := RematchThingsFor(app, colourID); err != nil {
		return err
	}
	w.Signal()
	return nil
}

// drainedHooks run after a drain that linked at least one fragment: prompt
// membership just changed, so every lens naming a colour may resolve
// differently. Registered by server wiring (the reconcile wave), so this
// package does not know its consumers.
func drain(ctx context.Context, app core.App) (int, error) {
	cols, err := app.FindRecordsByFilter(schema.ColColour.String(), "prompt != ''", "created", 0, 0, nil)
	if err != nil {
		return 0, err
	}
	if len(cols) == 0 {
		return 0, nil
	}
	// Colour matching stays role-level on purpose: it is workspace utility
	// work, not entity generation, so no per-entity override applies.
	model, err := llm.ResolveRole(llm.RoleColour)
	if err != nil {
		return 0, err
	}
	var firstErr error
	wrote := 0
	for _, c := range cols {
		if ctx.Err() != nil {
			return wrote, ctx.Err()
		}
		n, err := drainColour(ctx, app, model, c)
		wrote += n
		if errors.Is(err, usage.ErrExhausted) {
			return wrote, err
		}
		if err != nil && firstErr == nil {
			firstErr = err
		}
	}
	return wrote, firstErr
}

// drainColour judges every fragment past the colour's watermark, oldest
// first, and advances the watermark a page at a time. Pairs that already hold
// a row (manual, thing, or an earlier prompt match) are not judged again.
// Returns how many links it wrote, whatever else happened.
func drainColour(ctx context.Context, app core.App, model string, c *core.Record) (int, error) {
	prompt := c.GetString("prompt")
	positiveBlock, negativeBlock := exampleBlocks(ctx, app, c.Id)
	wrote := 0
	for {
		frags, err := pastWatermark(app, c.GetString("prompt_match_completed_up_to_fragment_id"))
		if err != nil {
			return wrote, err
		}
		if len(frags) == 0 {
			return wrote, nil
		}
		linked, err := linkedFragmentIDs(app, c.Id, frags)
		if err != nil {
			return wrote, err
		}
		for _, f := range frags {
			if linked[f.Id] {
				continue
			}
			target := llmcontext.RenderFragmentRecords([]*core.Record{f})
			reply, err := judge(ctx, app, model, prompts.ColourEvalPrompt(prompt, positiveBlock, negativeBlock, target))
			if err != nil {
				recordProviderErrorKind(app, c, err)
				return wrote, err
			}
			clearProviderErrorKind(app, c)
			if !prompts.ParseYesNo(reply) {
				continue
			}
			if err := insertLink(app, c.Id, f.Id, MatchPrompt); err != nil {
				return wrote, err
			}
			wrote++
		}
		c.Set("prompt_match_completed_up_to_fragment_id", frags[len(frags)-1].Id)
		if err := app.Save(c); err != nil {
			return wrote, err
		}
	}
}

// pastWatermark pages live fragments in (created, id) order from just after
// the watermark fragment. Ordering on the pair makes same-millisecond imports
// safe; a watermark whose fragment is gone starts over.
func pastWatermark(app core.App, watermark string) ([]*core.Record, error) {
	filter := "deleted_at = ''"
	params := dbx.Params{}
	if watermark != "" {
		wm, err := app.FindRecordById(schema.ColFragment.String(), watermark)
		if err == nil {
			filter += " && (created > {:c} || (created = {:c} && id > {:id}))"
			params["c"] = wm.GetDateTime("created")
			params["id"] = wm.Id
		}
	}
	return app.FindRecordsByFilter(schema.ColFragment.String(), filter, "created,id", pageSize, 0, params)
}

func linkedFragmentIDs(app core.App, colourID string, frags []*core.Record) (map[string]bool, error) {
	if len(frags) == 0 {
		return nil, nil
	}
	ids := make([]any, 0, len(frags))
	for _, f := range frags {
		ids = append(ids, f.Id)
	}
	var rows []struct {
		FragmentID string `db:"fragment_id"`
	}
	err := app.DB().Select("fragment_id").From(schema.ColColourFragment.String()).
		Where(dbx.HashExp{"colour_id": colourID}).
		AndWhere(dbx.In("fragment_id", ids...)).
		All(&rows)
	if err != nil {
		return nil, err
	}
	linked := make(map[string]bool, len(rows))
	for _, r := range rows {
		linked[r.FragmentID] = true
	}
	return linked, nil
}

// exampleBlocks renders the colour's manual examples as the few-shot block.
func exampleBlocks(ctx context.Context, app core.App, colourID string) (positive, negative string) {
	ids := func(matchType string) []string {
		links, err := app.FindRecordsByFilter(schema.ColColourFragment.String(), "colour_id = {:c} && match_type = {:t}", "-created", exampleLimit, 0, dbx.Params{"c": colourID, "t": matchType})
		if err != nil {
			return nil
		}
		out := make([]string, 0, len(links))
		for _, l := range links {
			out = append(out, l.GetString("fragment_id"))
		}
		return out
	}
	positive = llmcontext.RenderFragmentRecords(llmcontext.LoadFragmentsByIDs(ctx, app, ids(MatchManualPositive)))
	negative = llmcontext.RenderFragmentRecords(llmcontext.LoadFragmentsByIDs(ctx, app, ids(MatchManualNegative)))
	return positive, negative
}

func judge(ctx context.Context, app core.App, model, prompt string) (string, error) {
	for {
		out, err := usage.GenerateOnce(ctx, app, prompt, llm.RoleColour, model, nil)
		if errors.Is(err, llmq.ErrPreempted) {
			// Higher-priority work took the slot mid-generation. Go around;
			// the retry blocks in the scheduler until the next idle window.
			continue
		}
		return out, err
	}
}

// recordProviderErrorKind marks a colour whose evaluation is failing for a
// reason the user has to act on. The worker has no request to return an error
// on, so a durable marker on the record is how a stuck key becomes visible.
// Transient failures are left unmarked — the next drain retries.
func recordProviderErrorKind(app core.App, colourRec *core.Record, err error) {
	var perr *llm.ProviderError
	if !errors.As(err, &perr) {
		return
	}
	if perr.Kind != llm.ErrKindAuth && perr.Kind != llm.ErrKindQuota {
		return
	}
	if colourRec.GetString("last_provider_error_kind") == string(perr.Kind) {
		return
	}
	colourRec.Set("last_provider_error_kind", string(perr.Kind))
	if err := app.Save(colourRec); err != nil {
		logger(app).Error("record provider error kind failed", "error", err)
	}
}

func clearProviderErrorKind(app core.App, colourRec *core.Record) {
	if colourRec.GetString("last_provider_error_kind") == "" {
		return
	}
	colourRec.Set("last_provider_error_kind", "")
	if err := app.Save(colourRec); err != nil {
		logger(app).Error("clear provider error kind failed", "error", err)
	}
}
