package colour

import (
	"context"
	"errors"
	"log"
	"strings"
	"time"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/llmcontext"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/prompts"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/usage"
	"github.com/north-shore-software/kalaido/kalaidoscope/llm"
	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
)

type evalTask struct {
	fragmentID string
	colourID   string
	isBackfill bool
}

var taskQueue = make(chan evalTask, 1000)

func init() {
	go workerLoop()
}

func EnqueueRetroactiveEvaluation(app core.App, colourID string) {

	recs, err := app.FindRecordsByFilter("fragment", "", "-created", 10000, 0, dbx.Params{})
	if err != nil {
		log.Printf("colour eval queue: find fragments failed: %v", err)
		return
	}

	for _, r := range recs {
		taskQueue <- evalTask{
			fragmentID: r.Id,
			colourID:   colourID,
			isBackfill: true,
		}
	}
}

func EnqueueNewFragmentEvaluation(app core.App, fragmentID string) {

	recs, err := app.FindRecordsByFilter("colour", "", "", 10000, 0, dbx.Params{})
	if err != nil {
		log.Printf("colour eval queue: find colours failed: %v", err)
		return
	}

	for _, r := range recs {
		taskQueue <- evalTask{
			fragmentID: fragmentID,
			colourID:   r.Id,
			isBackfill: false,
		}
	}
}

var workerApp core.App

func SetWorkerApp(app core.App) {
	workerApp = app
}

func workerLoop() {
	for task := range taskQueue {
		if workerApp == nil {
			time.Sleep(1 * time.Second)
			// Put it back
			taskQueue <- task
			continue
		}

		// Stub LLM call
		evaluateTask(task)
	}
}

// recordProviderErrorKind marks a colour whose evaluation is failing for a
// reason the user has to act on. The worker has no request to return an error
// on, so a durable marker on the record is how a stuck key becomes visible.
// Transient failures are left unmarked — the next queued fragment retries.
func recordProviderErrorKind(colourRec *core.Record, err error) {
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
	if err := workerApp.Save(colourRec); err != nil {
		log.Printf("colour eval worker: failed to record provider error kind: %v", err)
	}
}

func clearProviderErrorKind(colourRec *core.Record) {
	if colourRec.GetString("last_provider_error_kind") == "" {
		return
	}
	colourRec.Set("last_provider_error_kind", "")
	if err := workerApp.Save(colourRec); err != nil {
		log.Printf("colour eval worker: failed to clear provider error kind: %v", err)
	}
}

func evaluateTask(task evalTask) {

	colourRec, err := workerApp.FindRecordById("colour", task.colourID)
	if err != nil {
		log.Printf("colour eval worker: find colour failed: %v", err)
		return
	}
	criteria := colourRec.GetString("criteria")

	links, err := workerApp.FindRecordsByFilter("colour_fragment", "colour_id = {:col} && fragment_id = {:frag}", "", 1, 0, dbx.Params{
		"col":  task.colourID,
		"frag": task.fragmentID,
	})
	if err == nil && len(links) > 0 {
		return
	}

	positiveLinks, _ := workerApp.FindRecordsByFilter("colour_fragment", "colour_id = {:col} && match_type = 'manual_positive'", "", 20, 0, dbx.Params{
		"col": task.colourID,
	})
	negativeLinks, _ := workerApp.FindRecordsByFilter("colour_fragment", "colour_id = {:col} && match_type = 'manual_negative'", "", 20, 0, dbx.Params{
		"col": task.colourID,
	})

	var positiveIDs, negativeIDs []string
	for _, l := range positiveLinks {
		positiveIDs = append(positiveIDs, l.GetString("fragment_id"))
	}
	for _, l := range negativeLinks {
		negativeIDs = append(negativeIDs, l.GetString("fragment_id"))
	}

	ctx := context.Background()

	positiveBlock := llmcontext.RenderFragmentRecords(llmcontext.LoadFragmentsByIDs(ctx, workerApp, positiveIDs))
	negativeBlock := llmcontext.RenderFragmentRecords(llmcontext.LoadFragmentsByIDs(ctx, workerApp, negativeIDs))

	targetRec, err := workerApp.FindRecordById("fragment", task.fragmentID)
	if err != nil {
		log.Printf("colour eval worker: find fragment failed: %v", err)
		return
	}
	targetDoc := llmcontext.RenderFragmentRecords([]*core.Record{targetRec})

	prompt := prompts.ColourEvalPrompt(criteria, positiveBlock, negativeBlock, targetDoc)

	out, err := usage.GenerateOnce(ctx, workerApp, prompt, llm.RoleColour, nil)
	if err != nil {
		log.Printf("colour eval worker: evaluation failed for fragment %s: %v", task.fragmentID, err)
		recordProviderErrorKind(colourRec, err)
		return
	}
	clearProviderErrorKind(colourRec)

	if !strings.Contains(strings.ToUpper(out), "YES") {
		return
	}

	cfCollection, err := workerApp.FindCollectionByNameOrId("colour_fragment")
	if err != nil {
		log.Printf("colour eval worker: find collection failed: %v", err)
		return
	}

	cf := core.NewRecord(cfCollection)
	cf.Set("colour_id", task.colourID)
	cf.Set("fragment_id", task.fragmentID)

	matchType := "llm_matched_tag_on_input"
	if task.isBackfill {
		matchType = "llm_matched_backfill"
	}
	cf.Set("match_type", matchType)

	if model, err := llm.ResolveRole(llm.RoleColour); err == nil {
		cf.Set("model", model)
	}

	if err := workerApp.Save(cf); err != nil {
		log.Printf("colour eval worker: failed to save colour_fragment: %v", err)
	} else {
		log.Printf("colour eval worker: matched fragment %s to colour %s", task.fragmentID, task.colourID)
	}
}
