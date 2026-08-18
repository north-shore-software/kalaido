package engine

import (
	"context"
	"errors"
	"log"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/llmq"
	"github.com/north-shore-software/kalaido/kalaidoscope/llm"
)

// The distillation worker follows the reconcile wave's shape: a coalescing
// signal, and each pass re-deriving its worklist from DB state instead of a
// payload queue. A refinement commit marks its snapshot (lens_distill_requested,
// with lens_id left empty until a lens lands), so a newer commit supersedes an
// abandoned target for free, and work interrupted by a shutdown is picked up
// by whichever future pass runs next — nothing resumes it at startup.

// Buffered by one: distillation requested while a pass is running coalesces
// into a single follow-up pass, which is sound because every pass re-derives
// the worklist from scratch.
var distillSignal = make(chan struct{}, 1)

var lensWorkerApp core.App

func SetLensWorkerApp(app core.App) {
	lensWorkerApp = app
	go lensWorkerLoop()
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

		// Model drift: an entity whose approved lens was distilled by a
		// different model than the one its generations now resolve to.
		// current_lens_id stays set the whole time — the old lens and its
		// snapshots keep serving until a replacement lands — so drift cannot
		// be expressed in the worklist query above (which requires
		// lens_id = ''); it is derived here by comparison, which makes it
		// self-healing: there is no stale marker to set, and none to miss.
		entities, err := app.FindRecordsByFilter(strat.CollectionName(),
			"current_lens_id != ''", "", 0, 0)
		if err != nil {
			log.Printf("lens distillation: %s drift scan: %v", strat.TargetType(), err)
			continue
		}
		for _, rec := range entities {
			if seen[rec.Id] {
				continue
			}
			lensRec, err := app.FindRecordById(strat.LensCollectionName(), rec.GetString("current_lens_id"))
			if err != nil {
				continue
			}
			lensModel := lensRec.GetString("model")
			if lensModel == "" {
				// Pre-provenance lens: the model that made it is unknown, so
				// it can never be judged drifted.
				continue
			}
			effective, err := llm.ResolveRoleFor(llm.RoleDistill, rec.GetString("model"))
			if err != nil || effective == lensModel {
				continue
			}
			seen[rec.Id] = true
			// Re-distill against the snapshot the current lens came from: the
			// newest approved distill-origin snapshot still pointing at it.
			// (DistillAndUpdateLens re-points that snapshot's lens_id at the
			// replacement, so the association survives successive drifts.)
			snaps, err := app.FindRecordsByFilter(strat.SnapshotCollectionName(),
				strat.ForeignKeyCol()+" = {:id} && lens_id = {:lens} && lens_distill_requested = true && status = 'approved'",
				"-approval_timestamp", 1, 0,
				dbx.Params{"id": rec.Id, "lens": lensRec.Id})
			if err != nil || len(snaps) == 0 {
				// No recoverable distillation target; the old lens keeps
				// serving under the new model until the next refinement.
				continue
			}
			if err := DistillAndUpdateLens(ctx, app, strat, snaps[0]); err != nil {
				log.Printf("lens distillation (model drift): %s %s: %v", strat.TargetType(), rec.Id, err)
				recordLensProviderErrorKind(app, rec, err)
				continue
			}
			clearLensProviderErrorKind(app, rec)
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
