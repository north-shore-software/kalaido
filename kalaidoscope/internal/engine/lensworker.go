package engine

import (
	"context"
	"errors"
	"log"

	"github.com/pocketbase/pocketbase/core"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/llmq"
	"github.com/north-shore-software/kalaido/kalaidoscope/llm"
)

// The distillation worker follows the reconcile wave's shape: a coalescing
// signal, and each pass re-deriving its worklist from DB state instead of a
// payload queue. A refinement commit marks its snapshot (lens_distill_requested,
// with lens_id left empty until a lens lands), so the work survives a restart —
// SetLensWorkerApp fires one startup signal to resume anything unfinished — and
// a newer commit supersedes an abandoned target for free.

// Buffered by one: distillation requested while a pass is running coalesces
// into a single follow-up pass, which is sound because every pass re-derives
// the worklist from scratch.
var distillSignal = make(chan struct{}, 1)

var lensWorkerApp core.App

func SetLensWorkerApp(app core.App) {
	lensWorkerApp = app
	go lensWorkerLoop()
	RequestLensDistill()
}

// RequestLensDistill asks for a distillation pass and returns immediately, so
// committing a refinement never waits on an LLM generation. The snapshot is
// already approved and live; the lens is only consumed by future generations.
func RequestLensDistill() {
	select {
	case distillSignal <- struct{}{}:
	default:
	}
}

func lensWorkerLoop() {
	for range distillSignal {
		runDistillPass(lensWorkerApp)
	}
}

func runDistillPass(app core.App) {
	// Not a request context: the request that signalled has already returned.
	// Background priority on every leg so interactive work preempts the loop.
	ctx := llmq.WithPriority(context.Background(), llmq.Background)

	for _, strat := range []Strategy{ProjectionStrategy{}, ReflectionStrategy{}} {
		snaps, err := app.FindRecordsByFilter(strat.SnapshotCollectionName(),
			"lens_distill_requested = true && lens_id = '' && status = 'approved'",
			"-approval_timestamp", 0, 0)
		if err != nil {
			log.Printf("lens distillation: %s worklist: %v", strat.TargetType(), err)
			continue
		}

		// Newest approval first, one target per entity: an older lens-less
		// snapshot has been superseded and never burns a loop.
		seen := make(map[string]bool)
		for _, snap := range snaps {
			parentID := snap.GetString(strat.ForeignKeyCol())
			if seen[parentID] {
				continue
			}
			seen[parentID] = true

			err := DistillAndUpdateLens(ctx, app, strat, snap)
			parentRec, _ := app.FindRecordById(strat.CollectionName(), parentID)
			if err != nil {
				// Targets are independent, so a failing entity doesn't end the
				// pass (unlike the reconcile wave, whose early exit is
				// topological). The next signal retries it.
				log.Printf("lens distillation: %s %s: %v", strat.TargetType(), snap.Id, err)
				if parentRec != nil {
					recordLensProviderErrorKind(app, parentRec, err)
				}
				continue
			}
			if parentRec != nil {
				clearLensProviderErrorKind(app, parentRec)
			}
		}
	}
}

// recordLensProviderErrorKind marks a projection/reflection whose lens
// distillation is failing for a reason the user has to act on. The worker has
// no request to return an error on, so a durable marker on the record is how a
// stuck key becomes visible. Transient failures are left unmarked — the next
// pass retries.
func recordLensProviderErrorKind(app core.App, rec *core.Record, err error) {
	var perr *llm.ProviderError
	if !errors.As(err, &perr) {
		return
	}
	if perr.Kind != llm.ErrKindAuth && perr.Kind != llm.ErrKindQuota {
		return
	}
	if rec.GetString("last_provider_error_kind") == string(perr.Kind) {
		return
	}
	rec.Set("last_provider_error_kind", string(perr.Kind))
	if err := app.Save(rec); err != nil {
		log.Printf("lens distillation: failed to record provider error kind: %v", err)
	}
}

func clearLensProviderErrorKind(app core.App, rec *core.Record) {
	if rec.GetString("last_provider_error_kind") == "" {
		return
	}
	rec.Set("last_provider_error_kind", "")
	if err := app.Save(rec); err != nil {
		log.Printf("lens distillation: failed to clear provider error kind: %v", err)
	}
}
