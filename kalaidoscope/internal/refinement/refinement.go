package refinement

import (
	"errors"
	"log/slog"

	"github.com/pocketbase/pocketbase/core"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/engine"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/projections"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/reflections"
	"github.com/north-shore-software/kalaido/kalaidoscope/schema"
)

// ErrMessagesRequired indicates no messages were provided or generated for the prompt.
var ErrMessagesRequired = errors.New("messages required")

// ErrNoModel indicates no model was configured for refinement.
var ErrNoModel = errors.New("no model configured for refinement")

func logger() *slog.Logger {
	return slog.Default().With("component", "refinement")
}

// strategyFor is the engine strategy of the entity type a refinement refines.
func strategyFor(refRec *core.Record) engine.Strategy {
	if refRec.Collection().Name == schema.ColReflectionRefinement.String() {
		return reflections.Strategy{}
	}
	return projections.Strategy{}
}

// parentID is the id of the entity a refinement refines: its parent column,
// or, for a row that predates that column, the parent of the snapshot it
// was opened on.
func parentID(app core.App, refRec *core.Record, strat engine.Strategy) string {
	if id := refRec.GetString(strat.ForeignKeyCol()); id != "" {
		return id
	}
	snapID := refRec.GetString(strat.TargetType() + "_snapshot_id")
	if snapID == "" {
		return ""
	}
	snap, err := app.FindRecordById(strat.SnapshotCollectionName(), snapID)
	if err != nil {
		return ""
	}
	return snap.GetString(strat.ForeignKeyCol())
}

// Parent resolves the live projection or reflection a refinement refines,
// or nil when it has none (or it has been deleted).
func Parent(app core.App, refRec *core.Record) *core.Record {
	strat := strategyFor(refRec)
	id := parentID(app, refRec, strat)
	if id == "" {
		return nil
	}
	rec, err := app.FindRecordById(strat.CollectionName(), id)
	if err != nil || engine.IsDeleted(rec) {
		return nil
	}
	return rec
}
