package engine

import (
	"context"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/api"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/llmcontext"
	"github.com/north-shore-software/kalaido/kalaidoscope/schema"
)

type ProjectionStrategy struct{}

func (s ProjectionStrategy) TargetType() string         { return "projection" }
func (s ProjectionStrategy) CollectionName() string     { return schema.ColProjection.String() }
func (s ProjectionStrategy) LensCollectionName() string { return schema.ColLens.String() }
func (s ProjectionStrategy) SnapshotCollectionName() string {
	return schema.ColProjectionSnapshot.String()
}
func (s ProjectionStrategy) ForeignKeyCol() string { return "projection_id" }
func (s ProjectionStrategy) RefinementForeignKeyCol() string {
	return "created_from_projection_refinement_id"
}
func (s ProjectionStrategy) EnsureFragmentsOnly() bool                              { return false }
func (s ProjectionStrategy) ApplySnapshotWindow(snap *core.Record, win *api.Window) {}
func (s ProjectionStrategy) SnapshotWindowFilter(win *api.Window) (string, dbx.Params) {
	return "", nil
}
func (s ProjectionStrategy) InheritsCandidateTrigger() bool { return true }
func (s ProjectionStrategy) CommitRefinementSnapshot(ctx context.Context, tx core.App, parentRec *core.Record, lensRec *core.Record, output string, pinned llmcontext.PinnedIDs, spec api.ContextSpec, trigger string, refinementID string) (string, error) {
	snapID, err := AppendSnapshot(ctx, tx, s, SnapshotSpec{
		SourceID:                parentRec.Id,
		LensID:                  lensRec.Id,
		Output:                  output,
		ContextSpec:             spec,
		ResolvedContext:         pinned,
		Status:                  StatusApproved,
		GenerationTrigger:       trigger,
		CreatedFromRefinementID: refinementID,
	})
	if err != nil {
		return "", err
	}
	if err := ApproveSnapshot(ctx, tx, s, snapID); err != nil {
		return "", err
	}
	return snapID, nil
}
func (s ProjectionStrategy) ScrubSpec(spec *api.ContextSpec, id string) {
	kept := spec.SourceProjectionIDs[:0]
	for _, x := range spec.SourceProjectionIDs {
		if x != id {
			kept = append(kept, x)
		}
	}
	spec.SourceProjectionIDs = kept
}

type ReflectionStrategy struct{}

func (s ReflectionStrategy) TargetType() string         { return "reflection" }
func (s ReflectionStrategy) CollectionName() string     { return schema.ColReflection.String() }
func (s ReflectionStrategy) LensCollectionName() string { return schema.ColLens.String() }
func (s ReflectionStrategy) SnapshotCollectionName() string {
	return schema.ColReflectionSnapshot.String()
}
func (s ReflectionStrategy) ForeignKeyCol() string { return "reflection_id" }
func (s ReflectionStrategy) RefinementForeignKeyCol() string {
	return "created_from_reflection_refinement_id"
}
func (s ReflectionStrategy) EnsureFragmentsOnly() bool { return true }
func (s ReflectionStrategy) ApplySnapshotWindow(snap *core.Record, win *api.Window) {
	SetSnapshotWindow(snap, win)
}
func (s ReflectionStrategy) SnapshotWindowFilter(win *api.Window) (string, dbx.Params) {
	if win == nil {
		return " && window_start = ''", nil
	}
	start, end := WindowBounds(win)
	return " && window_start = {:ws} && window_end = {:we}", dbx.Params{
		"ws": start.String(),
		"we": end.String(),
	}
}
func (s ReflectionStrategy) InheritsCandidateTrigger() bool { return false }
func (s ReflectionStrategy) CommitRefinementSnapshot(ctx context.Context, tx core.App, parentRec *core.Record, lensRec *core.Record, output string, pinned llmcontext.PinnedIDs, spec api.ContextSpec, trigger string, refinementID string) (string, error) {
	return "", nil
}
func (s ReflectionStrategy) ScrubSpec(spec *api.ContextSpec, id string) {
	kept := spec.SourceReflectionIDs[:0]
	for _, x := range spec.SourceReflectionIDs {
		if x != id {
			kept = append(kept, x)
		}
	}
	spec.SourceReflectionIDs = kept
}
