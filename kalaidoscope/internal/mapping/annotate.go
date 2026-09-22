// UNREVIEWED
package mapping

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sync"
	"sync/atomic"

	"github.com/pocketbase/pocketbase/core"
	"golang.org/x/sync/errgroup"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/prompts"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/sourcedata"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/usage"
	"github.com/north-shore-software/kalaido/kalaidoscope/llm"
	"github.com/north-shore-software/kalaido/kalaidoscope/schema"
)

const (
	annotateWorkers = 100
)

func (w *Worker) annotateLoop(ctx context.Context) error {
	for {
		if err := w.signal.Wait(ctx); err != nil {
			return err
		}
		active := w.followUps.Detach()
		full := w.wantSettle.Swap(false)
		w.annotating.Store(true)
		err := w.drain(ctx, full)
		w.annotating.Store(false)
		w.setLastDrainError(err)
		if err != nil && !errors.Is(err, context.Canceled) {
			w.logger.Error("drain failed", "error", err)
		}
		active.Invoke(err)
	}
}

func pendingFragments(app core.App) ([]*core.Record, error) {
	return sourcedata.PendingAnnotationFragments(app)
}

func pendingCount(app core.App) (int, error) {
	return sourcedata.PendingAnnotationCount(app)
}

// drain annotates every pending fragment, annotateWorkers at a time, until
// none is left or the quota is exhausted; a fragment that fails is skipped
// for the rest of this drain. With full, the map is then consolidated.
func (w *Worker) drain(ctx context.Context, full bool) error {
	app := w.app
	model, err := llm.ResolveRole(llm.RoleAnnotate)
	if err != nil {
		return err
	}
	failed := map[string]bool{}
	var firstErr error
	var mu sync.Mutex
	for {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		frags, err := pendingFragments(app)
		if err != nil {
			return err
		}
		var todo []*core.Record
		for _, f := range frags {
			if !failed[f.Id] {
				todo = append(todo, f)
			}
		}
		if len(todo) == 0 {
			break
		}
		var exhausted atomic.Bool
		g := new(errgroup.Group)
		g.SetLimit(annotateWorkers)
		for _, f := range todo {
			if exhausted.Load() || ctx.Err() != nil {
				break
			}
			g.Go(func() error {
				err := annotateOne(ctx, app, model, f)
				if err == nil {
					return nil
				}
				logger(app).Error("annotate failed", "fragment_id", f.Id, "error", err)
				mu.Lock()
				failed[f.Id] = true
				if firstErr == nil {
					firstErr = err
				}
				mu.Unlock()
				if errors.Is(err, usage.ErrExhausted) {
					exhausted.Store(true)
				}
				return nil // recorded above; one failure must not stop the others
			})
		}
		_ = g.Wait()
		if exhausted.Load() {
			break
		}
	}
	if full && ctx.Err() == nil {
		w.settle(ctx)
	}
	return firstErr
}

func annotateOne(ctx context.Context, app core.App, model string, frag *core.Record) error {
	d, err := loadDocument(app)
	if err != nil {
		return err
	}
	block := prompts.FragmentBlock(frag.GetString("type"), frag.GetString("source"), frag.Id, frag.GetString("content"))
	msgs := []llm.Message{{Role: "user", Content: prompts.AnnotatePrompt(d.doc, block)}}
	reply, err := generate(ctx, app, llm.RoleAnnotate, model, msgs)
	if err != nil {
		return err
	}
	ann, ok := prompts.ParseAnnotateReply(reply)
	if !ok {
		msgs = append(msgs,
			llm.Message{Role: "assistant", Content: reply},
			llm.Message{Role: "user", Content: prompts.MapJSONRetryNudge})
		reply, err = generate(ctx, app, llm.RoleAnnotate, model, msgs)
		if err != nil {
			return err
		}
		if ann, ok = prompts.ParseAnnotateReply(reply); !ok {
			return fmt.Errorf("unparseable annotate reply")
		}
	}
	col, err := app.FindCollectionByNameOrId(schema.ColFragmentAnnotation.String())
	if err != nil {
		return err
	}
	rec := core.NewRecord(col)
	rec.Set("fragment_id", frag.Id)
	rec.Set("title", ann.Title)
	rec.Set("summary", ann.Summary)
	for name, v := range map[string]any{
		"things":      ann.Things,
		"decisions":   ann.Decisions,
		"questions":   ann.Questions,
		"conclusions": ann.Conclusions,
	} {
		b, err := json.Marshal(v)
		if err != nil {
			return err
		}
		rec.Set(name, json.RawMessage(b))
	}
	rec.Set("generated_from_map_version", d.version)
	rec.Set("generated_by_model", model)
	return app.Save(rec)
}

func generate(ctx context.Context, app core.App, role llm.Role, model string, msgs []llm.Message) (string, error) {
	return usage.GenerateOnceMsgsThrottled(ctx, app, msgs, role, model, nil)
}
