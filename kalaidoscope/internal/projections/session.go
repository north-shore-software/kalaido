package projections

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/pocketbase/pocketbase/core"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/api"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/chat"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/engine"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/llmcontext"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/workerutil"
	"github.com/north-shore-software/kalaido/kalaidoscope/schema"
)

func sessionParentID(app core.App, refRec *core.Record) string {
	if id := refRec.GetString("projection_id"); id != "" {
		return id
	}
	snapID := refRec.GetString("projection_snapshot_id")
	if snapID == "" {
		return ""
	}
	snap, err := app.FindRecordById(schema.ColProjectionSnapshot.String(), snapID)
	if err != nil {
		return ""
	}
	return snap.GetString("projection_id")
}

// SessionParent resolves the live projection a projection_refinement belongs
// to, or nil when missing or soft-deleted.
func SessionParent(app core.App, refRec *core.Record) *core.Record {
	id := sessionParentID(app, refRec)
	if id == "" {
		return nil
	}
	rec, err := app.FindRecordById(schema.ColProjection.String(), id)
	if err != nil || engine.IsDeleted(rec) {
		return nil
	}
	return rec
}

// CreateSession opens a projection refinement session and seeds its initial
// context_spec + pinned_ids system message.
func CreateSession(app core.App, clientID, targetID, snapshotID string, contextSpec *api.ContextSpec) (string, []api.UIMessage, error) {
	var refID string
	var seeded []api.UIMessage

	err := app.RunInTransaction(func(txApp core.App) error {
		col, err := txApp.FindCollectionByNameOrId(schema.ColProjectionRefinement.String())
		if err != nil {
			return err
		}
		rec := core.NewRecord(col)
		rec.Set("external_conversation_id", clientID)

		parent, err := FindLive(txApp, targetID)
		if err != nil {
			return err
		}
		rec.Set("projection_id", targetID)

		var snap *core.Record
		if snapshotID != "" {
			rec.Set("projection_snapshot_id", snapshotID)
			snap, err = txApp.FindRecordById(schema.ColProjectionSnapshot.String(), snapshotID)
			if err != nil {
				return err
			}
		}

		if err := txApp.Save(rec); err != nil {
			return err
		}
		refID = rec.Id

		var ctxSpec *api.ContextSpec
		switch {
		case contextSpec != nil:
			ctxSpec = contextSpec
		case snap != nil:
			var fromSnap api.ContextSpec
			if err := snap.UnmarshalJSONField("context_spec", &fromSnap); err == nil {
				ctxSpec = &fromSnap
			}
		case parent != nil:
			var fromParent api.ContextSpec
			if raw := parent.GetString("current_context_spec"); raw != "" && raw != "null" {
				if err := parent.UnmarshalJSONField("current_context_spec", &fromParent); err == nil {
					ctxSpec = &fromParent
				}
			}
		}

		var parts []api.UIMessagePart
		if ctxSpec != nil {
			data, _ := json.Marshal(*ctxSpec)
			parts = append(parts, api.UIMessagePart{Type: "context_spec", Data: data})
			if pinned, err := llmcontext.ResolveSpecToIDs(context.Background(), txApp, *ctxSpec, nil); err == nil {
				data, _ := json.Marshal(pinned)
				parts = append(parts, api.UIMessagePart{Type: "pinned_ids", Data: data})
			}
		}

		if len(parts) > 0 {
			msg := api.UIMessage{
				ID:    fmt.Sprintf("ctx-%d", time.Now().UnixNano()),
				Role:  "system",
				Parts: parts,
			}
			if _, err := chat.PersistMessage(context.Background(), txApp, rec, msg, ""); err != nil {
				return err
			}
			seeded = append(seeded, msg)
		}

		return nil
	})
	return refID, seeded, err
}

// CommitSession saves the bound pending draft snapshot of a projection
// refinement session and kicks off async living editorial brief distillation.
func CommitSession(ctx context.Context, app core.App, refRec *core.Record, expectedParentID string, runner workerutil.Runner) (string, error) {
	parent := sessionParentID(app, refRec)
	if parent == "" {
		return "", chat.ErrMissingParentID
	}
	if expectedParentID != "" && expectedParentID != parent {
		return "", chat.ErrParentMismatch
	}

	sourceSnapID := refRec.GetString("projection_snapshot_id")
	if sourceSnapID == "" {
		return "", chat.ErrNoPreviewOutput
	}
	snap, err := app.FindRecordById(schema.ColProjectionSnapshot.String(), sourceSnapID)
	if err != nil {
		return "", chat.ErrNoPreviewOutput
	}
	if snap.GetString("status") != engine.StatusPending {
		return "", fmt.Errorf("%w: candidate is not pending review", engine.ErrNotApprovable)
	}

	newSnapID, err := SaveCandidate(ctx, app, runner, parent, sourceSnapID, refRec)
	if err != nil {
		logger().Error("projection save failed", "error", err)
		return "", err
	}
	logger().Info("projection session saved", "id", parent, "refinement_id", refRec.Id, "snapshot_id", newSnapID)
	return newSnapID, nil
}
