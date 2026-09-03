package mapping

import (
	"context"
	"errors"
	"log"
	"sort"
	"sync"
	"sync/atomic"

	"github.com/pocketbase/pocketbase/core"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/followup"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/llmq"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/usage"
	"github.com/north-shore-software/kalaido/kalaidoscope/llm"
)

const (
	annotateWorkers      = 100
	maxThrottledAttempts = 6
)

var signal = make(chan struct{}, 1)

var wantSettle atomic.Bool

var followUps followup.Queue

var workerApp core.App

var (
	annotating     atomic.Bool
	drainErrMu     sync.Mutex
	lastDrainError string
)

func Annotating() bool { return annotating.Load() }

func LastDrainError() string {
	drainErrMu.Lock()
	defer drainErrMu.Unlock()
	return lastDrainError
}

func setLastDrainError(err error) {
	drainErrMu.Lock()
	defer drainErrMu.Unlock()
	if err == nil {
		lastDrainError = ""
		return
	}
	lastDrainError = err.Error()
}

func Register(app core.App) {
	workerApp = app
	go loop()
	go aggregateLoop()
	app.OnServe().BindFunc(func(se *core.ServeEvent) error {
		if err := se.Next(); err != nil {
			return err
		}
		if n, err := pendingCount(app); err == nil && n > 0 {
			SignalAnnotate()
		}
		return nil
	})
}

func Signal() {
	wantSettle.Store(true)
	SignalAnnotate()
}

func SignalAnnotate() {
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
		full := wantSettle.Swap(false)
		annotating.Store(true)
		err := drain(workerApp, full)
		annotating.Store(false)
		setLastDrainError(err)
		if err != nil {
			log.Printf("mapping: drain: %v", err)
		}
		followup.Run(active, err)
	}
}

func annotatedIDs(app core.App) (map[string]bool, error) {
	recs, err := app.FindRecordsByFilter("fragment_annotation", "1=1", "", 0, 0, nil)
	if err != nil {
		return nil, err
	}
	ids := make(map[string]bool, len(recs))
	for _, r := range recs {
		ids[r.GetString("fragment_id")] = true
	}
	return ids, nil
}

func pendingFragments(app core.App) ([]*core.Record, error) {
	done, err := annotatedIDs(app)
	if err != nil {
		return nil, err
	}
	recs, err := app.FindRecordsByFilter("fragment", "deleted_at = ''", "", 0, 0, nil)
	if err != nil {
		return nil, err
	}
	var pending []*core.Record
	for _, r := range recs {
		if !done[r.Id] {
			pending = append(pending, r)
		}
	}
	sort.SliceStable(pending, func(i, j int) bool {
		li, lj := pending[i].GetString("origin") == "import", pending[j].GetString("origin") == "import"
		if li != lj {
			return !li
		}
		return pending[i].GetDateTime("source_time").Compare(pending[j].GetDateTime("source_time")) < 0
	})
	return pending, nil
}

func pendingCount(app core.App) (int, error) {
	pending, err := pendingFragments(app)
	if err != nil {
		return 0, err
	}
	return len(pending), nil
}

func drain(app core.App, full bool) error {
	model, err := llm.ResolveRole(llm.RoleAnnotate)
	if err != nil {
		return err
	}
	ctx := context.Background()
	failed := map[string]bool{}
	var firstErr error
	var mu sync.Mutex
	for {
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
		exhausted := false
		sem := make(chan struct{}, annotateWorkers)
		var wg sync.WaitGroup
		for _, f := range todo {
			mu.Lock()
			stop := exhausted
			mu.Unlock()
			if stop {
				break
			}
			wg.Add(1)
			sem <- struct{}{}
			go func(f *core.Record) {
				defer wg.Done()
				defer func() { <-sem }()
				err := annotateOne(ctx, app, model, f)
				if err == nil {
					return
				}
				log.Printf("mapping: annotate %s: %v", f.Id, err)
				mu.Lock()
				failed[f.Id] = true
				if firstErr == nil {
					firstErr = err
				}
				if errors.Is(err, usage.ErrExhausted) {
					exhausted = true
				}
				mu.Unlock()
			}(f)
		}
		wg.Wait()
		if exhausted {
			break
		}
	}
	if full {
		settle(app)
	}
	return firstErr
}

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
