package engine

import (
	"context"
	"errors"
	"fmt"
	"slices"
	"strings"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/types"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/api"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/llmcontext"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/pbutil"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/prompts"
)

var (
	ErrEditNotPending    = errors.New("candidate is not pending review")
	ErrEditTextNotFound  = errors.New("selected text not found in candidate")
	ErrEditTextAmbiguous = errors.New("selected text occurs more than once in candidate")
	ErrEditNoChange      = errors.New("edit changes nothing")
	ErrEditEmptyResult   = errors.New("edit would empty the candidate")
)

// ErrEditRejected wraps every validation failure of ApplyEdit so a handler
// can map them to one client-error status.
var ErrEditRejected = errors.New("edit rejected")

// EditResult names what ApplyEdit wrote.
type EditResult struct {
	SnapshotID string
	FragmentID string
}

// ApplyEdit records a hand edit of a pending candidate: an "edit" fragment
// holding the passage before and after, pinned into the parent's
// current_context_spec, and a new pending snapshot whose output is the
// candidate's with that one passage replaced. Mechanical — no model call.
//
// The source candidate stays pending: the edited row is an additional
// candidate, and approving either later discards the other (ApproveSnapshot).
// The new row inherits the source's lens, model and resolved context (plus
// the new fragment), so staleness reads it as current. Everything runs in one
// transaction; a rejected edit leaves no trace. Projections only.
func ApplyEdit(ctx context.Context, app core.App, strat Strategy, parentID, sourceSnapshotID, oldText, newText string) (EditResult, error) {
	if strat.TargetType() != "projection" {
		return EditResult{}, fmt.Errorf("edit: %s snapshots cannot be edited by hand", strat.TargetType())
	}
	var res EditResult
	err := app.RunInTransaction(func(tx core.App) error {
		parent, err := FindLive(tx, strat, parentID)
		if err != nil {
			return fmt.Errorf("edit: %s %s: %w", strat.TargetType(), parentID, err)
		}
		src, err := tx.FindRecordById(strat.SnapshotCollectionName(), sourceSnapshotID)
		if err != nil {
			return fmt.Errorf("edit: candidate %s: %w", sourceSnapshotID, err)
		}
		if src.GetString(strat.ForeignKeyCol()) != parentID {
			return fmt.Errorf("edit: candidate %s does not belong to %s %s", sourceSnapshotID, strat.TargetType(), parentID)
		}
		if src.GetString("status") != StatusPending {
			return fmt.Errorf("%w: %w", ErrEditRejected, ErrEditNotPending)
		}

		output := src.GetString("output")
		newOutput, err := replacePassage(output, oldText, newText)
		if err != nil {
			return fmt.Errorf("%w: %w", ErrEditRejected, err)
		}

		fragCol, err := tx.FindCollectionByNameOrId("fragment")
		if err != nil {
			return err
		}
		frag := core.NewRecord(fragCol)
		frag.Set("type", prompts.EditFragmentKind)
		frag.Set("ingested_via", "app")
		frag.Set("source", fmt.Sprintf("edit to projection %q (candidate %s)", parent.GetString("name"), src.Id))
		frag.Set("content", prompts.EditFragmentContent(oldText, newText))
		// The fragment create hook (server) defaults occurred_at; set it here
		// too so the row is complete wherever the hook is not installed.
		frag.Set("occurred_at", types.NowDateTime())
		if err := tx.Save(frag); err != nil {
			return fmt.Errorf("edit: save fragment: %w", err)
		}

		var parentSpec api.ContextSpec
		if err := parent.UnmarshalJSONField("current_context_spec", &parentSpec); err != nil {
			return fmt.Errorf("edit: parent context spec: %w", err)
		}
		parentSpec.FragmentIDs = appendUnique(parentSpec.FragmentIDs, frag.Id)

		var snapSpec api.ContextSpec
		if err := src.UnmarshalJSONField("context_spec", &snapSpec); err != nil {
			return fmt.Errorf("edit: candidate context spec: %w", err)
		}
		snapSpec.FragmentIDs = appendUnique(snapSpec.FragmentIDs, frag.Id)

		var pinned llmcontext.PinnedIDs
		if err := src.UnmarshalJSONField("resolved_context", &pinned); err != nil {
			return fmt.Errorf("edit: candidate resolved context: %w", err)
		}
		pinned.FragmentIDs = appendUnique(pinned.FragmentIDs, frag.Id)
		pinned.ExpandedIDs = appendUnique(pinned.ExpandedIDs, frag.Id)

		// GenerationTrigger and CreatedFromRefinementID stay empty: a hand
		// edit belongs to no speculative chain and came from no refinement.
		snapID, err := AppendSnapshot(ctx, tx, strat.SnapshotCollectionName(), strat.ForeignKeyCol(), SnapshotSpec{
			SourceID:        parentID,
			LensID:          src.GetString("lens_id"),
			Output:          newOutput,
			ContextSpec:     snapSpec,
			ResolvedContext: pinned,
			Status:          StatusPending,
			Model:           src.GetString("generated_by_model"),
		})
		if err != nil {
			return fmt.Errorf("edit: append snapshot: %w", err)
		}

		parent.Set("current_context_spec", pbutil.JSONObject(parentSpec))
		if err := tx.Save(parent); err != nil {
			return fmt.Errorf("edit: pin fragment on %s: %w", strat.TargetType(), err)
		}

		res = EditResult{SnapshotID: snapID, FragmentID: frag.Id}
		return nil
	})
	if err != nil {
		return EditResult{}, err
	}
	logger().Info("candidate edited by hand",
		"target_type", strat.TargetType(), "id", parentID, "source_snapshot_id", sourceSnapshotID,
		"snapshot_id", res.SnapshotID, "fragment_id", res.FragmentID)
	return res, nil
}

// replacePassage swaps the single occurrence of oldText in output for newText.
// A passage that appears twice is refused rather than guessed at: "replace
// the selection" has no one answer then, and the user can widen the selection.
// An empty newText deletes the passage, as long as something remains.
func replacePassage(output, oldText, newText string) (string, error) {
	if oldText == "" {
		return "", ErrEditTextNotFound
	}
	if oldText == newText {
		return "", ErrEditNoChange
	}
	switch strings.Count(output, oldText) {
	case 0:
		return "", ErrEditTextNotFound
	case 1:
	default:
		return "", ErrEditTextAmbiguous
	}
	out := strings.Replace(output, oldText, newText, 1)
	if strings.TrimSpace(out) == "" {
		return "", ErrEditEmptyResult
	}
	return out, nil
}

func appendUnique(ids []string, id string) []string {
	if slices.Contains(ids, id) {
		return ids
	}
	return append(ids, id)
}
