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
	"log"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/llmcontext"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/llmq"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/prompts"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/usage"
	"github.com/north-shore-software/kalaido/kalaidoscope/llm"
)

const (
	pageSize     = 200
	exampleLimit = 20
)

var (
	signal    = make(chan struct{}, 1)
	workerApp core.App
)

// Register starts the prompt worker and kicks it once the server is up, so a
// watermark left behind by a crash or an offline provider resumes.
func Register(app core.App) {
	workerApp = app
	go loop()
	app.OnServe().BindFunc(func(se *core.ServeEvent) error {
		if err := se.Next(); err != nil {
			return err
		}
		Signal()
		return nil
	})
}

// Signal asks the worker to drain. Coalesces.
func Signal() {
	select {
	case signal <- struct{}{}:
	default:
	}
}

// Rematch restarts a colour from scratch: prompt rows go, the watermark
// resets, thing rows are recomputed, and the worker is kicked. Used when the
// prompt changes or the user asks for it.
func Rematch(app core.App, colourID string) error {
	rec, err := app.FindRecordById("colour", colourID)
	if err != nil {
		return err
	}
	rows, err := app.FindRecordsByFilter("colour_fragment", "colour_id = {:c} && match_type = {:t}", "", 0, 0, dbx.Params{"c": colourID, "t": MatchPrompt})
	if err != nil {
		return err
	}
	for _, r := range rows {
		if err := app.Delete(r); err != nil {
			return err
		}
	}
	rec.Set("prompt_matched_through", "")
	if err := app.Save(rec); err != nil {
		return err
	}
	if err := RematchThingsFor(app, colourID); err != nil {
		return err
	}
	Signal()
	return nil
}

func loop() {
	for range signal {
		if err := drain(workerApp); err != nil {
			log.Printf("colour: drain: %v", err)
		}
	}
}

func drain(app core.App) error {
	cols, err := app.FindRecordsByFilter("colour", "prompt != ''", "created", 0, 0, nil)
	if err != nil {
		return err
	}
	if len(cols) == 0 {
		return nil
	}
	// Colour matching stays role-level on purpose: it is workspace utility
	// work, not entity generation, so no per-entity override applies.
	model, err := llm.ResolveRole(llm.RoleColour)
	if err != nil {
		return err
	}
	ctx := context.Background()
	var firstErr error
	for _, c := range cols {
		err := drainColour(ctx, app, model, c)
		if errors.Is(err, usage.ErrExhausted) {
			return err
		}
		if err != nil && firstErr == nil {
			firstErr = err
		}
	}
	return firstErr
}

// drainColour judges every fragment past the colour's watermark, oldest
// first, and advances the watermark a page at a time. Pairs that already hold
// a row (manual, thing, or an earlier prompt match) are not judged again.
func drainColour(ctx context.Context, app core.App, model string, c *core.Record) error {
	prompt := c.GetString("prompt")
	positiveBlock, negativeBlock := exampleBlocks(ctx, app, c.Id)
	for {
		frags, err := pastWatermark(app, c.GetString("prompt_matched_through"))
		if err != nil {
			return err
		}
		if len(frags) == 0 {
			return nil
		}
		linked, err := linkedFragmentIDs(app, c.Id, frags)
		if err != nil {
			return err
		}
		for _, f := range frags {
			if linked[f.Id] {
				continue
			}
			target := llmcontext.RenderFragmentRecords([]*core.Record{f})
			reply, err := judge(ctx, app, model, prompts.ColourEvalPrompt(prompt, positiveBlock, negativeBlock, target))
			if err != nil {
				recordProviderErrorKind(app, c, err)
				return err
			}
			clearProviderErrorKind(app, c)
			if !prompts.ParseYesNo(reply) {
				continue
			}
			if err := insertLink(app, c.Id, f.Id, MatchPrompt, model); err != nil {
				return err
			}
		}
		c.Set("prompt_matched_through", frags[len(frags)-1].Id)
		if err := app.Save(c); err != nil {
			return err
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
		wm, err := app.FindRecordById("fragment", watermark)
		if err == nil {
			filter += " && (created > {:c} || (created = {:c} && id > {:id}))"
			params["c"] = wm.GetDateTime("created")
			params["id"] = wm.Id
		}
	}
	return app.FindRecordsByFilter("fragment", filter, "created,id", pageSize, 0, params)
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
	err := app.DB().Select("fragment_id").From("colour_fragment").
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
		links, err := app.FindRecordsByFilter("colour_fragment", "colour_id = {:c} && match_type = {:t}", "-created", exampleLimit, 0, dbx.Params{"c": colourID, "t": matchType})
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
		log.Printf("colour: record provider error kind: %v", err)
	}
}

func clearProviderErrorKind(app core.App, colourRec *core.Record) {
	if colourRec.GetString("last_provider_error_kind") == "" {
		return
	}
	colourRec.Set("last_provider_error_kind", "")
	if err := app.Save(colourRec); err != nil {
		log.Printf("colour: clear provider error kind: %v", err)
	}
}
