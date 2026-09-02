package discover

import (
	"errors"
	"log"
	"sync"

	"github.com/pocketbase/pocketbase/core"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/followup"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/llmq"
	"github.com/north-shore-software/kalaido/kalaidoscope/llm"
)

const maxThrottledAttempts = 6

var (
	wake      = make(chan struct{}, 1)
	pendingMu sync.Mutex
	pending   = map[string]bool{}
	followUps followup.Queue
	workerApp core.App
)

func Register(app core.App) {
	workerApp = app
	go loop()
}

func Signal(kind string) {
	if _, ok := flows[kind]; !ok {
		return
	}
	pendingMu.Lock()
	pending[kind] = true
	pendingMu.Unlock()
	select {
	case wake <- struct{}{}:
	default:
	}
}

func AfterDrain(fn func(err error)) {
	followUps.Add(fn)
}

func takePending() []string {
	pendingMu.Lock()
	defer pendingMu.Unlock()
	kinds := make([]string, 0, len(pending))
	for k := range pending {
		kinds = append(kinds, k)
	}
	pending = map[string]bool{}
	return kinds
}

func loop() {
	for range wake {
		active := followUps.Take()
		var last error
		for _, kind := range takePending() {
			if err := Run(workerApp, flows[kind]); err != nil {
				log.Printf("discover: %s: %v", kind, err)
				last = err
			}
		}
		followup.Run(active, last)
	}
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
