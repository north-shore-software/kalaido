package reflections

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/api"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/engine"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/llmcontext"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/pbutil"
	"github.com/north-shore-software/kalaido/kalaidoscope/schema"
)

var (
	ErrNotFound = errors.New("reflection not found")
	// ErrInvalidWindowSpec wraps a schedule the grid could not evaluate.
	ErrInvalidWindowSpec = errors.New("invalid window spec")
)

// Strategy implements engine.Strategy for reflections.
type Strategy struct{}

func (s Strategy) TargetType() string              { return "reflection" }
func (s Strategy) CollectionName() string          { return schema.ColReflection.String() }
func (s Strategy) LensCollectionName() string      { return schema.ColLens.String() }
func (s Strategy) SnapshotCollectionName() string  { return schema.ColReflectionSnapshot.String() }
func (s Strategy) ForeignKeyCol() string           { return "reflection_id" }
func (s Strategy) RefinementForeignKeyCol() string { return "created_from_reflection_refinement_id" }
func (s Strategy) EnsureFragmentsOnly() bool       { return true }
func (s Strategy) ApplySnapshotWindow(snap *core.Record, win *api.Window) {
	engine.SetSnapshotWindow(snap, win)
}
func (s Strategy) SnapshotWindowFilter(win *api.Window) (string, dbx.Params) {
	if win == nil {
		return " && window_start = ''", nil
	}
	start, end := engine.WindowBounds(win)
	return " && window_start = {:ws} && window_end = {:we}", dbx.Params{
		"ws": start.String(),
		"we": end.String(),
	}
}
func (s Strategy) InheritsCandidateTrigger() bool { return false }
func (s Strategy) CommitRefinementSnapshot(ctx context.Context, tx core.App, parentRec *core.Record, lensRec *core.Record, output string, pinned llmcontext.PinnedIDs, spec api.ContextSpec, trigger string, refinementID string) (string, error) {
	return "", nil
}
func (s Strategy) ScrubSpec(spec *api.ContextSpec, id string) {
	spec.SourceReflectionIDs = engine.RemoveID(spec.SourceReflectionIDs, id)
}

// FindLive loads a reflection that is not soft-deleted.
func FindLive(app core.App, id string) (*core.Record, error) {
	return engine.FindLive(app, Strategy{}, id)
}

// CreateParams defines input fields for creating a reflection.
type CreateParams struct {
	Name        string
	Description string
	WindowSpec  *api.WindowSpec
}

// Create creates a new reflection in an active state and initializes its window spec versions.
func Create(app core.App, params CreateParams) (*core.Record, error) {
	if params.WindowSpec != nil {
		if err := params.WindowSpec.Validate(); err != nil {
			return nil, fmt.Errorf("%w: %w", ErrInvalidWindowSpec, err)
		}
	}

	var target *core.Record
	err := app.RunInTransaction(func(txApp core.App) error {
		col, err := txApp.FindCollectionByNameOrId(schema.ColReflection.String())
		if err != nil {
			return err
		}
		rec := core.NewRecord(col)
		rec.Set("name", params.Name)
		rec.Set("status", engine.EntityActive)
		if d := strings.TrimSpace(params.Description); d != "" {
			rec.Set("description", d)
		}
		spec := api.WindowSpec{}
		if params.WindowSpec != nil {
			spec = *params.WindowSpec
		}
		effective := time.Now()
		if st, err := time.Parse(time.RFC3339, spec.StartTime); err == nil && st.Before(effective) {
			effective = st
		}
		versions := AppendWindowSpecVersion(nil, spec, effective)
		rec.Set("window_spec_versions", pbutil.JSONObject(versions))

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

// UpdateParams defines fields that can be updated on a reflection.
type UpdateParams struct {
	Name              *string
	GenerateWithModel *string
	WindowSpec        *api.WindowSpec
	Pinned            *bool
	AuthID            string
}

// Update updates an existing live reflection.
func Update(app core.App, id string, params UpdateParams) (*core.Record, error) {
	rec, err := FindLive(app, id)
	if err != nil {
		return nil, fmt.Errorf("%w: %w", ErrNotFound, err)
	}

	if params.WindowSpec != nil {
		if err := params.WindowSpec.Validate(); err != nil {
			return nil, fmt.Errorf("%w: %w", ErrInvalidWindowSpec, err)
		}
	}

	if params.Name != nil {
		rec.Set("name", *params.Name)
	}
	if params.GenerateWithModel != nil {
		rec.Set("generate_with_model", strings.TrimSpace(*params.GenerateWithModel))
	}
	if params.WindowSpec != nil {
		spec := *params.WindowSpec
		versions := LoadWindowSpecVersions(rec)
		if spec.StartTime == "" {
			if cur, ok := GoverningVersion(versions, time.Now()); ok {
				spec.StartTime = cur.Spec.StartTime
			}
		}
		versions = AppendWindowSpecVersion(versions, spec, time.Now())
		rec.Set("window_spec_versions", pbutil.JSONObject(versions))
	}
	if params.Pinned != nil && params.AuthID != "" {
		pbutil.TogglePinnedBy(rec, params.AuthID, *params.Pinned)
	}

	if err := app.Save(rec); err != nil {
		return nil, err
	}
	return rec, nil
}

// Delete soft-deletes a reflection, refusing if a generation is actively running,
// and scrubs its ID from dependent context specs.
func Delete(app core.App, id string) error {
	rec, err := app.FindRecordById(schema.ColReflection.String(), id)
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

// Restore restores a soft-deleted reflection.
func Restore(app core.App, id string) (*core.Record, error) {
	rec, err := app.FindRecordById(schema.ColReflection.String(), id)
	if err != nil {
		return nil, ErrNotFound
	}
	if err := engine.Restore(app, rec); err != nil {
		return nil, err
	}
	return rec, nil
}
