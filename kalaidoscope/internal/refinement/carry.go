package refinement

import (
	"context"
	"fmt"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/chat"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/engine"
	"github.com/north-shore-software/kalaido/kalaidoscope/schema"
)

// CarryOpenRefinementToCandidate moves the conversation that was open on a
// projection's newest approved snapshot onto a fresh pending candidate, so a
// fold-in (approve, then regenerate against the approved output) keeps the
// reader's chat instead of starting a blank one. A refinement is bound to one
// snapshot; every proposal the chat makes lands on whichever snapshot it is
// bound to, so re-pointing it is all the carry-over takes.
//
// Only a conversation that has not drafted a lens is carried. One that has
// owns a whole-document preview and commits through the refinement rather than
// the candidate, and that path would fight the folded-in candidate.
//
// Returns the carried refinement's id, or "" when there was nothing to carry:
// no approved snapshot, no conversation on it, a lens-drafting conversation,
// or a candidate that is not pending (a fold-in that settled in place).
func CarryOpenRefinementToCandidate(ctx context.Context, app core.App, projectionID, candidateID string) (string, error) {
	cand, err := app.FindRecordById(schema.ColProjectionSnapshot.String(), candidateID)
	if err != nil {
		return "", fmt.Errorf("find candidate: %w", err)
	}
	if cand.GetString("status") != engine.StatusPending || cand.GetString("projection_id") != projectionID {
		return "", nil
	}

	approved, err := app.FindRecordsByFilter(schema.ColProjectionSnapshot.String(),
		"projection_id = {:pid} && status = {:status} && id != {:cand}",
		"-approval_sequence_number", 1, 0,
		dbx.Params{"pid": projectionID, "status": engine.StatusApproved, "cand": candidateID})
	if err != nil {
		return "", fmt.Errorf("find approved snapshot: %w", err)
	}
	if len(approved) == 0 {
		return "", nil
	}

	refs, err := app.FindRecordsByFilter(schema.ColProjectionRefinement.String(),
		"projection_snapshot_id = {:sid}", "-created", 1, 0,
		dbx.Params{"sid": approved[0].Id})
	if err != nil {
		return "", fmt.Errorf("find refinement: %w", err)
	}
	if len(refs) == 0 {
		return "", nil
	}
	refRec := refs[0]

	msgs, err := chat.LoadMessages(ctx, app, refRec)
	if err != nil {
		return "", fmt.Errorf("load refinement messages: %w", err)
	}
	if _, lens := LatestLensPart(msgs); lens != "" {
		logger().Info("fold-in: refinement drafted a lens; leaving it on the approved snapshot",
			"projection_id", projectionID, "refinement_id", refRec.Id, "from_snapshot_id", approved[0].Id, "candidate_id", candidateID)
		return "", nil
	}

	refRec.Set("projection_snapshot_id", candidateID)
	if err := app.Save(refRec); err != nil {
		return "", fmt.Errorf("save refinement: %w", err)
	}
	logger().Info("fold-in: refinement carried to the new candidate",
		"projection_id", projectionID, "refinement_id", refRec.Id, "from_snapshot_id", approved[0].Id, "candidate_id", candidateID)
	return refRec.Id, nil
}
