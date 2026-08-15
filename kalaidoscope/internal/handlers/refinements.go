package handlers

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/pocketbase/pocketbase/core"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/api"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/chat"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/engine"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/llmcontext"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/usage"
)

func HandleCreateProjectionRefinement(app core.App) func(e *core.RequestEvent) error {
	return handleCreateRefinementGeneric(app, "projection", "projection_snapshot", "refine_proj_snapshot_conversation")
}

func HandleCreateReflectionRefinement(app core.App) func(e *core.RequestEvent) error {
	return handleCreateRefinementGeneric(app, "reflection", "reflection_snapshot", "refine_refl_snapshot_conversation")
}

func handleCreateRefinementGeneric(app core.App, targetCol, snapColName, targetRefinementCol string) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		type reqBody struct {
			ClientID   string `json:"clientId"`
			SnapshotID string `json:"snapshotId"`
		}
		var req reqBody
		if err := e.BindBody(&req); err != nil {
			return e.BadRequestError("invalid request body", err)
		}
		if req.ClientID == "" {
			return e.BadRequestError("missing clientId", nil)
		}
		targetID := e.Request.PathValue("id")
		if targetID == "" {
			return e.BadRequestError("missing target id", nil)
		}

		var refID string
		err := app.RunInTransaction(func(txApp core.App) error {
			col, err := txApp.FindCollectionByNameOrId(targetRefinementCol)
			if err != nil {
				return err
			}
			rec := core.NewRecord(col)
			rec.Set("external_conversation_id", req.ClientID)

			if targetCol == "projection" {
				rec.Set("projection_id", targetID)
				if req.SnapshotID != "" {
					rec.Set("projection_snapshot_id", req.SnapshotID)
				}
			} else {
				rec.Set("reflection_id", targetID)
				if req.SnapshotID != "" {
					rec.Set("reflection_snapshot_id", req.SnapshotID)
				}
			}

			if err := txApp.Save(rec); err != nil {
				return err
			}
			refID = rec.Id

			if req.SnapshotID != "" {
				snap, err := txApp.FindRecordById(snapColName, req.SnapshotID)
				if err != nil {
					return err
				}

				var parts []api.UIMessagePart
				var ctxSpec api.ContextSpec
				if err := snap.UnmarshalJSONField("context_spec", &ctxSpec); err == nil {
					data, _ := json.Marshal(ctxSpec)
					parts = append(parts, api.UIMessagePart{
						Type: "context_spec",
						Data: data,
					})
				}

				if targetCol == "reflection" {
					var winSpec api.WindowSpec
					if err := snap.UnmarshalJSONField("window_spec", &winSpec); err == nil && winSpec.Period != "" {
						data, _ := json.Marshal(winSpec)
						parts = append(parts, api.UIMessagePart{
							Type: "window_spec",
							Data: data,
						})
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
				}
			}

			return nil
		})

		if err != nil {
			log.Printf("refinement.create: %v", err)
			return e.InternalServerError("failed to create refinement", err)
		}

		return e.JSON(http.StatusCreated, map[string]string{"refinementId": refID})
	}
}

func ExtractDraftedSnapshotAndSpec(app core.App, refRec *core.Record) (string, llmcontext.PinnedIDs, api.ContextSpec, api.WindowSpec, error) {
	msgs, err := chat.LoadMessages(nil, app, refRec)
	if err != nil {
		return "", llmcontext.PinnedIDs{}, api.ContextSpec{}, api.WindowSpec{}, err
	}

	pinned, spec, winSpec := llmcontext.LatestPinnedAndSpec(msgs)

	for i := len(msgs) - 1; i >= 0; i-- {
		m := msgs[i]
		if m.Role == "assistant" {
			for _, p := range m.Parts {
				if p.Type == "tool-update_draft" {
					var data struct {
						Input struct {
							Draft string `json:"draft"`
						} `json:"input"`
					}
					if err := json.Unmarshal(p.Data, &data); err == nil && data.Input.Draft != "" {
						return strings.TrimSpace(data.Input.Draft), pinned, spec, winSpec, nil
					}
				}
			}
		}
	}

	scanned := make([]string, 0, len(msgs))
	for _, m := range msgs {
		for _, p := range m.Parts {
			scanned = append(scanned, m.Role+"/"+p.Type)
		}
	}
	log.Printf("refinement.extract: no draft in %s (%d messages: %s)",
		refRec.Id, len(msgs), strings.Join(scanned, ", "))

	return "", pinned, spec, winSpec, nil
}

func HandleCommitProjectionRefinement(app core.App) func(e *core.RequestEvent) error {
	return handleCommitRefinementGeneric(app, "projection", "refine_proj_snapshot_conversation", "projection_snapshot_id")
}

func HandleCommitReflectionRefinement(app core.App) func(e *core.RequestEvent) error {
	return handleCommitRefinementGeneric(app, "reflection", "refine_refl_snapshot_conversation", "reflection_snapshot_id")
}

func handleCommitRefinementGeneric(app core.App, targetCol, refinementColName, snapshotField string) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		type reqBody struct {
			UpdateLensAndContext bool `json:"updateLensAndContext"`
		}
		var req reqBody
		_ = e.BindBody(&req)

		rid := e.Request.PathValue("rid")
		if rid == "" {
			return e.BadRequestError("refinement id required", nil)
		}

		refRec, err := app.FindRecordById(refinementColName, rid)
		if err != nil {
			return e.NotFoundError("refinement not found", err)
		}

		output, pinned, spec, winSpec, err := ExtractDraftedSnapshotAndSpec(app, refRec)
		if err != nil {
			return e.InternalServerError("failed to extract draft", err)
		}
		if output == "" {
			return e.BadRequestError("no drafted snapshot found in chat", nil)
		}

		var parentID string
		if targetCol == "projection" {
			parentID = refRec.GetString("projection_id")
		} else {
			parentID = refRec.GetString("reflection_id")
		}

		if parentID == "" {
			sourceSnapID := refRec.GetString(snapshotField)
			if sourceSnapID != "" {
				if sourceSnap, err := app.FindRecordById(targetCol+"_snapshot", sourceSnapID); err == nil {
					parentID = sourceSnap.GetString(targetCol + "_id")
				}
			}
		}
		if parentID == "" {
			return e.BadRequestError("refinement missing parent target id", nil)
		}

		if urlID := e.Request.PathValue("id"); urlID != "" && urlID != parentID {
			return e.BadRequestError("refinement parent target id mismatch", nil)
		}

		var strat engine.Strategy
		if targetCol == "projection" {
			strat = engine.ProjectionStrategy{}
		} else {
			strat = engine.ReflectionStrategy{}
		}

		sourceSnapID := refRec.GetString(snapshotField)

		ctx := e.Request.Context()
		newSnapID, err := engine.CommitRefinement(ctx, app, strat, parentID, sourceSnapID, output, req.UpdateLensAndContext, pinned, spec, winSpec, refRec.Id, targetCol)
		if err != nil {
			log.Printf("refinement.commit: %v", err)
			// Lens distillation runs inside the commit, so a provider failure
			// can surface here rather than as a generic commit error.
			if usage.WriteProviderError(e, err) {
				return nil
			}
			return e.InternalServerError("failed to commit refinement", err)
		}

		return e.JSON(http.StatusOK, map[string]string{"snapshotId": newSnapID})
	}
}
