package discover

import (
	"sync"

	"github.com/pocketbase/pocketbase/core"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/followup"
)

var (
	wake      = make(chan struct{}, 1)
	pendingMu sync.Mutex
	pending   = map[string]bool{}
	followUps followup.Queue
	workerApp core.App
	runningMu sync.Mutex
	running   string
)

func Running() string {
	runningMu.Lock()
	defer runningMu.Unlock()
	return running
}

func setRunning(kind string) {
	runningMu.Lock()
	running = kind
	runningMu.Unlock()
}

func Pending() []string {
	pendingMu.Lock()
	defer pendingMu.Unlock()
	kinds := make([]string, 0, len(pending))
	for _, k := range kindOrder {
		if pending[k] {
			kinds = append(kinds, k)
		}
	}
	return kinds
}

func KindOrder() []string { return append([]string(nil), kindOrder...) }

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

// kindOrder is the pipeline order when several kinds are pending at once:
// colours first, so projection and reflection scopes can name them.
var kindOrder = []string{"colours", "projections", "reflections"}

func takePending() []string {
	pendingMu.Lock()
	defer pendingMu.Unlock()
	kinds := make([]string, 0, len(pending))
	for _, k := range kindOrder {
		if pending[k] {
			kinds = append(kinds, k)
		}
	}
	pending = map[string]bool{}
	return kinds
}

func loop() {
	for range wake {
		active := followUps.Take()
		var last error
		for _, kind := range takePending() {
			setRunning(kind)
			err := Run(workerApp, flows[kind])
			setRunning("")
			if err != nil {
				logger().Error("flow run failed", "kind", kind, "error", err)
				last = err
			}
		}
		followup.Run(active, last)
	}
}
