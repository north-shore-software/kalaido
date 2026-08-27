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
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/prompts"
)

func HandleCreateProjectionRefinement(app core.App) func(e *core.RequestEvent) error {
	return handleCreateRefinementGeneric(app, "projection", "projection_snapshot", "refine_proj_snapshot_conversation")
}

func HandleCreateReflectionRefinement(app core.App) func(e *core.RequestEvent) error {
	return handleCreateRefinementGeneric(app, "reflection", "reflection_snapshot", "refine_refl_snapshot_conversation")
}

func handleCreateRefinementGeneric(app core.App, targetCol, snapColName, targetRefinementCol string) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		var req api.CreateRefinementRequest
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
		var seeded []api.UIMessage
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

			var snap *core.Record
			if req.SnapshotID != "" {
				snap, err = txApp.FindRecordById(snapColName, req.SnapshotID)
				if err != nil {
					return err
				}
			}

			// An explicit spec wins: it is how a session starts from a context no
			// snapshot has ever been generated against (a fork's new inputs, a
			// graduated fragment). Otherwise inherit the snapshot's.
			var ctxSpec *api.ContextSpec
			if req.ContextSpec != nil {
				ctxSpec = req.ContextSpec
			} else if snap != nil {
				var fromSnap api.ContextSpec
				if err := snap.UnmarshalJSONField("context_spec", &fromSnap); err == nil {
					ctxSpec = &fromSnap
				}
			}

			var parts []api.UIMessagePart
			if ctxSpec != nil {
				data, _ := json.Marshal(*ctxSpec)
				parts = append(parts, api.UIMessagePart{Type: "context_spec", Data: data})

				// Resolve it now, as a chat turn would (chat.ResolveContextSpecs).
				// A seeded session can be committed without a single message being
				// sent — graduating a fragment, then approving it as-is — and the
				// commit reads its resolved context straight off the transcript. No
				// pinned_ids here would mean a snapshot whose receipt claims nothing
				// went into it, and which is therefore stale the moment it exists.
				if pinned, err := llmcontext.ResolveSpecToIDs(context.Background(), txApp, *ctxSpec); err == nil {
					data, _ := json.Marshal(pinned)
					parts = append(parts, api.UIMessagePart{Type: "pinned_ids", Data: data})
				}
			}

			if targetCol == "reflection" && snap != nil {
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
				seeded = append(seeded, msg)
			}

			if draft := strings.TrimSpace(req.SeedDraft); draft != "" {
				msg := seedDraftMessage(draft)
				if _, err := chat.PersistMessage(context.Background(), txApp, rec, msg, ""); err != nil {
					return err
				}
				seeded = append(seeded, msg)
			}

			return nil
		})

		if err != nil {
			log.Printf("refinement.create: %v", err)
			return e.InternalServerError("failed to create refinement", err)
		}

		return e.JSON(http.StatusCreated, api.CreateRefinementResponse{
			RefinementID: refID,
			Messages:     seeded,
		})
	}
}

// seedDraftMessage records a draft the assistant did not actually produce, in
// exactly the shape a real `update_draft` tool call is persisted in (see
// toolCallPart). Everything downstream — the commit-time extraction below, the
// client's preview pane, resumed-session normalisation — then treats it as an
// ordinary drafted snapshot, because it is indistinguishable from one.
func seedDraftMessage(draft string) api.UIMessage {
	id := fmt.Sprintf("seed-%d", time.Now().UnixNano())
	data, _ := json.Marshal(map[string]any{
		"toolCallId": id,
		"toolName":   prompts.UpdateDraftToolName,
		"input":      map[string]string{"draft": draft},
	})
	return api.UIMessage{
		ID:   id,
		Role: "assistant",
		Parts: []api.UIMessagePart{
			{Type: "tool-" + prompts.UpdateDraftToolName, Data: data},
		},
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
				if p.Type == "tool-"+prompts.UpdateDraftToolName {
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

// refinementParent resolves the projection/reflection a refinement
// conversation refines: the direct relation when set, else via its source
// snapshot. Nil when neither path resolves.
func refinementParent(app core.App, refRec *core.Record) *core.Record {
	targetCol, snapshotField := "projection", "projection_snapshot_id"
	if refRec.Collection().Name == "refine_refl_snapshot_conversation" {
		targetCol, snapshotField = "reflection", "reflection_snapshot_id"
	}
	parentID := refRec.GetString(targetCol + "_id")
	if parentID == "" {
		if snapID := refRec.GetString(snapshotField); snapID != "" {
			if snap, err := app.FindRecordById(targetCol+"_snapshot", snapID); err == nil {
				parentID = snap.GetString(targetCol + "_id")
			}
		}
	}
	if parentID == "" {
		return nil
	}
	rec, err := app.FindRecordById(targetCol, parentID)
	if err != nil {
		return nil
	}
	return rec
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

		// Detached: a commit must run to completion once started — the client
		// giving up mid-request must not leave a half-committed refinement.
		ctx := context.WithoutCancel(e.Request.Context())
		newSnapID, err := engine.CommitRefinement(ctx, app, strat, parentID, sourceSnapID, output, req.UpdateLensAndContext, pinned, spec, winSpec, refRec.Id, targetCol)
		if err != nil {
			log.Printf("refinement.commit: %v", err)
			return e.InternalServerError("failed to commit refinement", err)
		}

		return e.JSON(http.StatusOK, map[string]string{"snapshotId": newSnapID})
	}
}
