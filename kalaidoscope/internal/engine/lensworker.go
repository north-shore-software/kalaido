package engine

import (
	"context"
	"errors"
	"log"
	"time"

	"github.com/pocketbase/pocketbase/core"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/api"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/llmq"
	"github.com/north-shore-software/kalaido/kalaidoscope/llm"
)

type distillTask struct {
	strat        Strategy
	snapshotID   string
	oldLensID    string
	spec         api.ContextSpec
	refinementID string
	targetCol    string
}

var lensQueue = make(chan distillTask, 100)

func init() {
	go lensWorkerLoop()
}

var lensWorkerApp core.App

func SetLensWorkerApp(app core.App) {
	lensWorkerApp = app
}

// EnqueueLensDistillation defers lens distillation to the background worker so
// that committing a refinement returns without waiting on an LLM generation.
// The snapshot is already approved and live; the lens is only consumed by
// future snapshot generations.
func EnqueueLensDistillation(strat Strategy, snapshotID, oldLensID string, spec api.ContextSpec, refinementID, targetCol string) {
	lensQueue <- distillTask{
		strat:        strat,
		snapshotID:   snapshotID,
		oldLensID:    oldLensID,
		spec:         spec,
		refinementID: refinementID,
		targetCol:    targetCol,
	}
}

func lensWorkerLoop() {
	for task := range lensQueue {
		if lensWorkerApp == nil {
			time.Sleep(1 * time.Second)
			// Put it back
			lensQueue <- task
			continue
		}

		runDistillTask(task)
	}
}

func runDistillTask(task distillTask) {
	// Deliberately not a request context: the request that enqueued this task
	// has already returned.
	var err error
	for {
		err = DistillAndUpdateLens(context.Background(), lensWorkerApp, task.strat, task.snapshotID, task.oldLensID, task.spec, task.refinementID, task.targetCol)
		if errors.Is(err, llmq.ErrPreempted) {
			// Higher-priority work took the slot mid-generation. The task is
			// still in hand — go around again; the retry blocks in the
			// scheduler until a slot is free.
			continue
		}
		break
	}

	parentRec := findDistillParent(task)
	if err != nil {
		log.Printf("lens distillation worker: %v", err)
		if parentRec != nil {
			recordLensProviderErrorKind(parentRec, err)
		}
		return
	}
	if parentRec != nil {
		clearLensProviderErrorKind(parentRec)
	}
}

func findDistillParent(task distillTask) *core.Record {
	snap, err := lensWorkerApp.FindRecordById(task.strat.SnapshotCollectionName(), task.snapshotID)
	if err != nil {
		return nil
	}
	rec, err := lensWorkerApp.FindRecordById(task.strat.CollectionName(), snap.GetString(task.strat.ForeignKeyCol()))
	if err != nil {
		return nil
	}
	return rec
}

// recordLensProviderErrorKind marks a projection/reflection whose lens
// distillation is failing for a reason the user has to act on. The worker has
// no request to return an error on, so a durable marker on the record is how a
// stuck key becomes visible. Transient failures are left unmarked — the next
// committed refinement retries.
func recordLensProviderErrorKind(rec *core.Record, err error) {
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
	if err := lensWorkerApp.Save(rec); err != nil {
		log.Printf("lens distillation worker: failed to record provider error kind: %v", err)
	}
}

func clearLensProviderErrorKind(rec *core.Record) {
	if rec.GetString("last_provider_error_kind") == "" {
		return
	}
	rec.Set("last_provider_error_kind", "")
	if err := lensWorkerApp.Save(rec); err != nil {
		log.Printf("lens distillation worker: failed to clear provider error kind: %v", err)
	}
}
