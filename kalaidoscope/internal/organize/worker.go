package organize

import (
	"context"
	"errors"
	"fmt"
	"log"
	"sync"

	"github.com/pocketbase/pocketbase/core"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/followup"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/llmq"
	"github.com/north-shore-software/kalaido/kalaidoscope/llm"
)

const (
	maxOrganizeDepth      = 3
	maxExplorations       = 25
	maxRoundsPerLevel     = 8 // sketch, list_existing, recurse (blocking), compose over the results
	maxExpansionsPerLevel = 4
	maxThrottledAttempts  = 6
)

// Triggered by the dev button and by an onboarding ingest chained through
// internal/ingest's pipeline — never by fragment writes. Same
// coalescing-signal + single-goroutine shape as internal/mapping's worker.
var signal = make(chan struct{}, 1)

var followUps followup.Queue

var errNoMap = errors.New("organize: no finished map to explore")

var workerApp core.App

func Register(app core.App) {
	workerApp = app
	go loop()
}

func Signal() {
	select {
	case signal <- struct{}{}:
	default:
	}
}

func AfterDrain(fn func(err error)) {
	followUps.Add(fn)
}

func loop() {
	for range signal {
		active := followUps.Take()
		err := drain(workerApp)
		if err != nil && !errors.Is(err, errNoMap) {
			log.Printf("organize: drain: %v", err)
		}
		followup.Run(active, err)
	}
}

func drain(app core.App) error {
	mapBody, mapVersion, err := loadFinishedMap(app)
	if err != nil {
		return err
	}
	if mapBody == "" {
		return errNoMap
	}

	idx, err := buildMapIndexes(mapBody)
	if err != nil {
		return err
	}
	annIdx, err := buildAnnotationIndex(app)
	if err != nil {
		return err
	}

	model, err := llm.ResolveRole(llm.RoleMap)
	if err != nil {
		return err
	}

	runCol, err := app.FindCollectionByNameOrId("organize_run")
	if err != nil {
		return err
	}
	run := core.NewRecord(runCol)
	run.Set("status", "running")
	run.Set("map_version", mapVersion)
	run.Set("model", model)
	run.Set("explorations", 1) // root itself
	if err := app.Save(run); err != nil {
		return err
	}

	ctx := context.Background()
	budget := &sharedBudget{used: 1, limit: maxExplorations} // root pre-counted
	registry := &runRegistry{}
	var wg sync.WaitGroup
	var mu sync.Mutex

	wg.Add(1)
	// Root runs directly, not via `go` — drain is already the background
	// worker's own goroutine. Every fork exploreNode spawns adds its own
	// wg.Add(1) before `go`-ing, so Wait covers root plus every fork plus
	// every dispatched content-generation goroutine.
	exploreNode(ctx, app, run, mapBody, model, idx, annIdx, scopeAssignment{unconfined: true}, 0, budget, registry, &wg, &mu)
	wg.Wait()

	mu.Lock()
	defer mu.Unlock()
	if run.GetString("status") == "running" {
		run.Set("status", "done")
		if err := app.Save(run); err != nil {
			log.Printf("organize: save run: %v", err)
		}
		return nil
	}
	return fmt.Errorf("organize: run %s: %s", run.Id, run.GetString("error"))
}

// retryPreempted mirrors internal/mapping/worker.go's helper exactly: a
// preempted LLM call (another higher-priority caller took the slot) retries
// forever, and a transient/quota provider error retries a bounded number of
// times before giving up.
func retryPreempted(f func() error) error {
	throttled := 0
	for {
		err := f()
		if errors.Is(err, llmq.ErrPreempted) {
			continue
		}
		var perr *llm.ProviderError
		if errors.As(err, &perr) && (perr.Kind == llm.ErrKindQuota || perr.Kind == llm.ErrKindTransient) {
			throttled++
			if throttled <= maxThrottledAttempts {
				continue
			}
		}
		return err
	}
}
