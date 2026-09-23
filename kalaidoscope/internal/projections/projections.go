package projections

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/api"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/engine"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/llmcontext"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/pbutil"
	"github.com/north-shore-software/kalaido/kalaidoscope/llm"
	"github.com/north-shore-software/kalaido/kalaidoscope/schema"
)

var ErrNotFound = errors.New("projection not found")

// Strategy implements engine.Strategy for projections.
type Strategy struct{}

func (s Strategy) TargetType() string                                     { return "projection" }
func (s Strategy) CollectionName() string                                 { return schema.ColProjection.String() }
func (s Strategy) LensCollectionName() string                             { return schema.ColLens.String() }
func (s Strategy) SnapshotCollectionName() string                         { return schema.ColProjectionSnapshot.String() }
func (s Strategy) ForeignKeyCol() string                                  { return "projection_id" }
func (s Strategy) RefinementForeignKeyCol() string                        { return "created_from_projection_refinement_id" }
func (s Strategy) EnsureFragmentsOnly() bool                              { return false }
func (s Strategy) ApplySnapshotWindow(snap *core.Record, win *api.Window) {}
func (s Strategy) SnapshotWindowFilter(win *api.Window) (string, dbx.Params) {
	return "", nil
}
func (s Strategy) InheritsCandidateTrigger() bool { return true }
func (s Strategy) CommitRefinementSnapshot(ctx context.Context, tx core.App, parentRec *core.Record, lensRec *core.Record, output string, pinned llmcontext.PinnedIDs, spec api.ContextSpec, trigger string, refinementID string) (string, error) {
	model, _ := llm.ResolveRoleFor(llm.RoleSnapshot, parentRec.GetString("generate_with_model"))
	newSnapID, err := engine.AppendSnapshot(ctx, tx, s, engine.SnapshotSpec{
		SourceID:                parentRec.Id,
		LensID:                  lensRec.Id,
		Output:                  output,
		ContextSpec:             spec,
		ResolvedContext:         pinned,
		Status:                  engine.StatusApproved,
		Model:                   model,
		GenerationTrigger:       trigger,
		CreatedFromRefinementID: refinementID,
	})
	if err != nil {
		return "", err
	}
	if err := engine.ApproveSnapshot(ctx, tx, s, newSnapID); err != nil {
		return "", err
	}
	return newSnapID, nil
}
func (s Strategy) ScrubSpec(spec *api.ContextSpec, id string) {
	spec.SourceProjectionIDs = engine.RemoveID(spec.SourceProjectionIDs, id)
}

// FindLive loads a projection that is not soft-deleted.
func FindLive(app core.App, id string) (*core.Record, error) {
	return engine.FindLive(app, Strategy{}, id)
}

// CreateParams defines input fields for creating a projection.
type CreateParams struct {
	Name        string
	Description string
}

// Create creates a new projection in the active state.
func Create(app core.App, params CreateParams) (*core.Record, error) {
	var target *core.Record
	err := app.RunInTransaction(func(txApp core.App) error {
		col, err := txApp.FindCollectionByNameOrId(schema.ColProjection.String())
		if err != nil {
			return err
		}
		rec := core.NewRecord(col)
		rec.Set("name", params.Name)
		rec.Set("status", engine.EntityActive)
		if d := strings.TrimSpace(params.Description); d != "" {
			rec.Set("description", d)
		}
		if err := txApp.Save(rec); err != nil {
			return err
		}
		target = rec
		return nil
	})
	if err != nil {
		return nil, err
	}
	return target, nil
}

// UpdateParams defines fields that can be updated on a projection.
type UpdateParams struct {
	Name              *string
	GenerateWithModel *string
	Pinned            *bool
	AuthID            string
}

// Update updates an existing live projection.
func Update(app core.App, id string, params UpdateParams) (*core.Record, error) {
	rec, err := FindLive(app, id)
	if err != nil {
		return nil, fmt.Errorf("%w: %w", ErrNotFound, err)
	}
	if params.Name != nil {
		rec.Set("name", *params.Name)
	}
	if params.GenerateWithModel != nil {
		rec.Set("generate_with_model", strings.TrimSpace(*params.GenerateWithModel))
	}
	if params.Pinned != nil && params.AuthID != "" {
		pbutil.TogglePinnedBy(rec, params.AuthID, *params.Pinned)
	}
	if err := app.Save(rec); err != nil {
		return nil, err
	}
	return rec, nil
}

// Delete soft-deletes a projection, refusing if a generation is actively running,
// and scrubs its ID from dependent context specs.
func Delete(app core.App, id string) error {
	rec, err := app.FindRecordById(schema.ColProjection.String(), id)
	if err != nil {
		return ErrNotFound
	}
	if engine.IsDeleted(rec) {
		return nil
	}
	inFlight, err := engine.HasLiveClaim(app, Strategy{}, id)
	if err != nil {
		return err
	}
	if inFlight {
		return engine.ErrGenerationInFlight
	}
	return app.RunInTransaction(func(tx core.App) error {
		if err := engine.ScrubContextSpecs(tx, id, Strategy{}.ScrubSpec); err != nil {
			return err
		}
		return engine.SoftDelete(tx, rec)
	})
}

// Restore restores a soft-deleted projection.
func Restore(app core.App, id string) (*core.Record, error) {
	rec, err := app.FindRecordById(schema.ColProjection.String(), id)
	if err != nil {
		return nil, ErrNotFound
	}
	if err := engine.Restore(app, rec); err != nil {
		return nil, err
	}
	return rec, nil
}

// Approve approves a pending candidate snapshot.
func Approve(ctx context.Context, app core.App, candidateID string) error {
	return engine.ApproveSnapshot(ctx, app, Strategy{}, candidateID)
}
