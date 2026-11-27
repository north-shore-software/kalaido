package reflections

import (
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/api"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/engine"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/pbutil"
	"github.com/north-shore-software/kalaido/kalaidoscope/schema"
)

// EmptyWindowOutput is the hardcoded snapshot text recorded when a reflection
// window resolves zero matching fragments (skipping the LLM call).
const EmptyWindowOutput = "No fragments in this window."

var (
	ErrNotFound = errors.New("reflection not found")
	// ErrInvalidWindowSpec wraps a schedule the grid could not evaluate.
	ErrInvalidWindowSpec = errors.New("invalid window spec")
	// ErrEmptyOutput rejects saving an empty manual edit on a reflection window.
	ErrEmptyOutput = errors.New("output cannot be empty")
	// ErrNoApprovedSnapshot is returned when attempting to edit a window with no approved snapshot.
	ErrNoApprovedSnapshot = errors.New("window has no approved snapshot")
	// ErrAlreadySaved rejects discarding a reflection that already has a saved lens.
	ErrAlreadySaved = errors.New("reflection already has a saved lens and cannot be discarded as a draft")
)

// Strategy implements engine.Strategy for reflections.
type Strategy struct{}

func (s Strategy) TargetType() string              { return "reflection" }
func (s Strategy) CollectionName() string          { return schema.ColReflection.String() }
func (s Strategy) LensCollectionName() string      { return schema.ColLens.String() }
func (s Strategy) SnapshotCollectionName() string  { return schema.ColReflectionSnapshot.String() }
func (s Strategy) ForeignKeyCol() string           { return "reflection_id" }
func (s Strategy) RefinementForeignKeyCol() string { return "created_from_reflection_refinement_id" }
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
	if params.WindowSpec == nil {
		return nil, fmt.Errorf("%w: windowSpec with a positive period is required", ErrInvalidWindowSpec)
	}
	if err := params.WindowSpec.Validate(); err != nil {
		return nil, fmt.Errorf("%w: %w", ErrInvalidWindowSpec, err)
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
		spec := *params.WindowSpec
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
		if err := spec.Validate(); err != nil {
			return nil, fmt.Errorf("%w: %w", ErrInvalidWindowSpec, err)
		}
		versions = AppendWindowSpecVersion(versions, spec, time.Now())
		rec.Set("window_spec_versions", pbutil.JSONObject(versions))
	}
	if params.Pinned != nil {
		rec.Set("pinned", *params.Pinned)
	}

	if err := app.Save(rec); err != nil {
		return nil, err
	}
	return rec, nil
}

// ReadLens returns a live reflection's current standing lens id and prompt text.
func ReadLens(app core.App, id string) (api.ReflectionLensResponse, error) {
	rec, err := FindLive(app, id)
	if err != nil {
		return api.ReflectionLensResponse{}, fmt.Errorf("%w: %w", ErrNotFound, err)
	}
	lensID, prompt := engine.ReadActiveLens(app, Strategy{}, rec)
	return api.ReflectionLensResponse{
		LensID: lensID,
		Prompt: prompt,
	}, nil
}

// UpdateLens appends a new lens row chained to the reflection's prior
// current_lens_id and updates current_lens_id in one transaction.
func UpdateLens(app core.App, id, prompt string) (api.ReflectionLensResponse, error) {
	if _, err := FindLive(app, id); err != nil {
		return api.ReflectionLensResponse{}, fmt.Errorf("%w: %w", ErrNotFound, err)
	}
	trimmed := strings.TrimSpace(prompt)
	newLensID, err := engine.UpdateActiveLens(app, Strategy{}, id, trimmed)
	if err != nil {
		return api.ReflectionLensResponse{}, err
	}
	return api.ReflectionLensResponse{
		LensID: newLensID,
		Prompt: trimmed,
	}, nil
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

// SaveTuningParams carries the staged edits to persist atomically on Save.
type SaveTuningParams struct {
	RefinementID string
	WindowSpec   *api.WindowSpec
	ContextSpec  *api.ContextSpec
	LensPrompt   string
	Name         *string
}

func windowSpecsEqual(a, b api.WindowSpec) bool {
	return a.Mode == b.Mode &&
		a.StartTime == b.StartTime &&
		a.EndTime == b.EndTime &&
		a.Period == b.Period &&
		a.Duration == b.Duration &&
		a.Paused == b.Paused
}

// SaveTuning atomically persists staged schedule, context sources, standing
// lens, and optional name in a single transaction, setting status = active.
//
// For never-saved reflections (current_lens_id == ""), replacing v1 cleanly
// ensures startTime edits made before first Save govern the initial grid.
// For established reflections, a modified WindowSpec appends a new version
// effective from now (leaving prior windows intact).
func SaveTuning(app core.App, reflectionID string, params SaveTuningParams) (string, error) {
	trimmedPrompt := strings.TrimSpace(params.LensPrompt)
	if trimmedPrompt == "" {
		return "", ErrEmptyLensPrompt
	}

	var lensID string
	err := app.RunInTransaction(func(tx core.App) error {
		rec, err := FindLive(tx, reflectionID)
		if err != nil {
			return fmt.Errorf("%w: %w", ErrNotFound, err)
		}

		now := time.Now()
		isNeverSaved := rec.GetString("current_lens_id") == ""

		if params.WindowSpec != nil {
			spec := *params.WindowSpec
			versions := LoadWindowSpecVersions(rec)
			cur, hasCur := GoverningVersion(versions, now)
			if spec.StartTime == "" && hasCur {
				spec.StartTime = cur.Spec.StartTime
			}
			if err := spec.Validate(); err != nil {
				return fmt.Errorf("%w: %w", ErrInvalidWindowSpec, err)
			}
			if isNeverSaved {
				effective := now
				if st := parseRFC3339(spec.StartTime); !st.IsZero() && st.Before(effective) {
					effective = st
				}
				rec.Set("window_spec_versions", pbutil.JSONObject(AppendWindowSpecVersion(nil, spec, effective)))
			} else if !hasCur || !windowSpecsEqual(cur.Spec, spec) {
				versions = AppendWindowSpecVersion(versions, spec, now)
				rec.Set("window_spec_versions", pbutil.JSONObject(versions))
			}
		}

		if params.ContextSpec != nil {
			clean := StripUpstreamSources(*params.ContextSpec)
			rec.Set("current_context_spec", pbutil.JSONObject(clean))
		}

		existingLensID, existingPrompt := engine.ReadActiveLens(tx, Strategy{}, rec)
		if existingLensID == "" || strings.TrimSpace(existingPrompt) != trimmedPrompt {
			lensCol, err := tx.FindCollectionByNameOrId(schema.ColLens.String())
			if err != nil {
				return err
			}
			lensRec := core.NewRecord(lensCol)
			if existingLensID != "" {
				lensRec.Set("parent_lens_id", existingLensID)
			}
			lensRec.Set("prompt", trimmedPrompt)
			if params.RefinementID != "" {
				lensRec.Set(Strategy{}.RefinementForeignKeyCol(), params.RefinementID)
			}
			if err := tx.Save(lensRec); err != nil {
				return err
			}
			rec.Set("current_lens_id", lensRec.Id)
			lensID = lensRec.Id
		} else {
			lensID = existingLensID
		}

		if params.Name != nil && strings.TrimSpace(*params.Name) != "" {
			rec.Set("name", strings.TrimSpace(*params.Name))
		}

		rec.Set("status", engine.EntityActive)
		return tx.Save(rec)
	})
	if err != nil {
		return "", err
	}
	return lensID, nil
}

// DiscardResult describes the side effect of discarding a never-saved
// reflection draft.
type DiscardResult struct {
	DeletedReflection  bool
	RevertedToProposed bool
}

// DiscardDraft cleans up a never-saved reflection (current_lens_id == "").
// Established reflections (with a saved lens) are refused with ErrAlreadySaved.
// Never-saved Discover proposals revert to status="proposed" (deleting open
// refinements); never-saved user-created reflections are hard-deleted so no
// broken lensless reflection remains.
func DiscardDraft(app core.App, reflectionID string) (DiscardResult, error) {
	var res DiscardResult
	err := app.RunInTransaction(func(tx core.App) error {
		rec, err := FindLive(tx, reflectionID)
		if err != nil {
			return fmt.Errorf("%w: %w", ErrNotFound, err)
		}
		if rec.GetString("current_lens_id") != "" {
			return ErrAlreadySaved
		}
		inFlight, err := engine.HasLiveClaim(tx, Strategy{}, rec.Id)
		if err != nil {
			return err
		}
		if inFlight {
			return engine.ErrGenerationInFlight
		}

		if rec.GetString("created_by_discover_run_id") != "" {
			refs, err := tx.FindRecordsByFilter(
				schema.ColReflectionRefinement.String(),
				"reflection_id = {:rid}",
				"", 0, 0,
				dbx.Params{"rid": rec.Id},
			)
			if err != nil {
				return err
			}
			for _, r := range refs {
				if err := tx.Delete(r); err != nil {
					return err
				}
			}
			rec.Set("status", engine.EntityProposed)
			if err := tx.Save(rec); err != nil {
				return err
			}
			res = DiscardResult{RevertedToProposed: true}
			return nil
		}

		if err := engine.ScrubContextSpecs(tx, rec.Id, Strategy{}.ScrubSpec); err != nil {
			return err
		}
		if err := tx.Delete(rec); err != nil {
			return err
		}
		res = DiscardResult{DeletedReflection: true}
		return nil
	})
	return res, err
}
