package reflections

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/types"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/api"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/engine"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/llmcontext"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/pbutil"
	"github.com/north-shore-software/kalaido/kalaidoscope/schema"
)

// EditWindowSnapshot appends a new approved reflection_snapshot revision for a
// specific window with the user's edited markdown/text output. It copies
// lens_id, context_spec, and resolved_context from the prior approved snapshot
// so manual text edits do not falsely flag lensOutdated or staleWindows, and
// tags generated_by_model = "manual".
func EditWindowSnapshot(ctx context.Context, app core.App, reflectionID, windowID, output string) (string, error) {
	trimmed := strings.TrimSpace(output)
	if trimmed == "" {
		return "", ErrEmptyOutput
	}

	rec, err := FindLive(app, reflectionID)
	if err != nil {
		return "", fmt.Errorf("%w: %w", ErrNotFound, err)
	}

	series := SeriesWindows(app, rec, time.Now())
	var target *api.Window
	for i := range series {
		if series[i].ID == windowID {
			w := series[i].Window
			target = &w
			break
		}
	}
	if target == nil {
		return "", ErrWindowNotFound
	}

	var newSnapID string
	err = app.RunInTransaction(func(tx core.App) error {
		strat := Strategy{}
		filter, params := engine.ApprovedSnapshotFilter(strat, rec.Id, target)
		recs, err := tx.FindRecordsByFilter(
			schema.ColReflectionSnapshot.String(), filter, "-approval_sequence_number", 1, 0, params)
		if err != nil {
			return err
		}
		if len(recs) == 0 {
			return ErrNoApprovedSnapshot
		}
		prior := recs[0]

		var priorSpec api.ContextSpec
		_ = prior.UnmarshalJSONField("context_spec", &priorSpec)
		var priorResolved llmcontext.PinnedIDs
		_ = prior.UnmarshalJSONField("resolved_context", &priorResolved)

		col, err := tx.FindCollectionByNameOrId(schema.ColReflectionSnapshot.String())
		if err != nil {
			return err
		}
		now := types.NowDateTime()
		snap := core.NewRecord(col)
		snap.Set("reflection_id", rec.Id)
		snap.Set("lens_id", prior.GetString("lens_id"))
		snap.Set("output", trimmed)
		snap.Set("output_raw", trimmed)
		snap.Set("output_draft", trimmed)
		snap.Set("edits", pbutil.JSONObject([]api.SnapshotEdit{}))
		snap.Set("context_spec", pbutil.JSONObject(priorSpec))
		snap.Set("resolved_context", pbutil.JSONObject(priorResolved))
		engine.SetSnapshotWindow(snap, target)
		snap.Set("status", engine.StatusApproved)
		snap.Set("generated_by_model", engine.SnapshotModelManual)
		snap.Set("approval_sequence_number", prior.GetInt("approval_sequence_number")+1)
		snap.Set("generated_at", now)
		snap.Set("approved_at", now)

		if err := tx.Save(snap); err != nil {
			return err
		}
		newSnapID = snap.Id
		return nil
	})
	if err != nil {
		return "", err
	}
	return newSnapID, nil
}
