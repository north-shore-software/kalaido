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
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/pbutil"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/prompts"
	"github.com/north-shore-software/kalaido/kalaidoscope/llm"
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

			// A projection refinement may be scoped to one snapshot (a review
			// candidate). A reflection's is not: its lens is refined
			// independently of any window's snapshot, so snapshotId is ignored.
			var snap *core.Record
			var parent *core.Record
			if targetCol == "projection" {
				rec.Set("projection_id", targetID)
				if req.SnapshotID != "" {
					rec.Set("projection_snapshot_id", req.SnapshotID)
					snap, err = txApp.FindRecordById(snapColName, req.SnapshotID)
					if err != nil {
						return err
					}
				}
			} else {
				rec.Set("reflection_id", targetID)
				parent, err = txApp.FindRecordById(targetCol, targetID)
				if err != nil {
					return err
				}
			}

			if err := txApp.Save(rec); err != nil {
				return err
			}
			refID = rec.Id

			// An explicit spec wins: it is how a session starts from a context no
			// snapshot has ever been generated against (a fork's new inputs, a
			// graduated fragment). Otherwise inherit the snapshot's — or, for a
			// reflection, the reflection's own current context.
			var ctxSpec *api.ContextSpec
			switch {
			case req.ContextSpec != nil:
				ctxSpec = req.ContextSpec
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

			// A reflection refinement always names the window its preview is
			// generated against (spec/model.md §Refinement Approval, "Target
			// Window"): the caller's choice, else the reflection's current
			// window. The client can move it later by sending a new `window`
			// part; this is only the starting point.
			var win *api.Window
			if parent != nil {
				if req.Window != nil && req.Window.Start != "" && req.Window.End != "" {
					win = &api.Window{Start: req.Window.Start, End: req.Window.End}
				} else {
					win = engine.DefaultRefinementWindow(parent, time.Now())
				}
				if win != nil {
					win.ID = engine.WindowID(targetID, *win)
				}
			}

			var parts []api.UIMessagePart
			if ctxSpec != nil {
				data, _ := json.Marshal(*ctxSpec)
				parts = append(parts, api.UIMessagePart{Type: "context_spec", Data: data})
			}
			if win != nil {
				data, _ := json.Marshal(win)
				parts = append(parts, api.UIMessagePart{Type: "window", Data: data})
			}
			if ctxSpec != nil {
				// Resolve it now, as a chat turn would (chat.ResolveContextSpecs).
				// The first turn's apply step and the commit both read the
				// session's resolved context straight off the transcript
				// (LatestPinnedAndSpec); without pinned_ids here the seeded
				// context would be invisible to both.
				if pinned, err := llmcontext.ResolveSpecToIDs(context.Background(), txApp, *ctxSpec, win); err == nil {
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

			// An existing reflection opens with its current lens already
			// drafted, paired with the chosen window's approved output as the
			// starting preview — shaped exactly like a drafting turn, so the
			// lens-writer sees the lens (LensEcho), the preview is never blank,
			// and the commit-time pairing invariant holds from the first turn.
			if parent != nil {
				if lensMsg, ok := seedLensTurn(txApp, parent, win); ok {
					if _, err := chat.PersistMessage(context.Background(), txApp, rec, lensMsg, ""); err != nil {
						return err
					}
					seeded = append(seeded, lensMsg)
				}
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

// LensSeedPartType marks the assistant turn a reflection refinement is seeded
// with: the reflection's current lens and, when the window has one, its
// approved output. The client renders it as "starting from the current lens"
// rather than as a drafted change.
const LensSeedPartType = "data-lens_seed"

// seedLensTurn builds that turn. ok is false when the reflection has no lens
// yet (a brand-new one: the first turn drafts it).
func seedLensTurn(app core.App, parent *core.Record, win *api.Window) (api.UIMessage, bool) {
	lensID := parent.GetString("current_lens_id")
	if lensID == "" {
		return api.UIMessage{}, false
	}
	lensRec, err := app.FindRecordById("lens", lensID)
	if err != nil {
		return api.UIMessage{}, false
	}
	lens := strings.TrimSpace(pbutil.DecodeJSONString(lensRec.GetString("prompt")))
	if lens == "" {
		return api.UIMessage{}, false
	}

	now := time.Now().UnixNano()
	parts := []api.UIMessagePart{{Type: LensSeedPartType, Data: json.RawMessage(`{}`)}}
	if p, ok := toolCallPart(llm.ToolCall{ID: fmt.Sprintf("seed-lens-%d", now), Name: prompts.UpdateLensToolName,
		Args: mustJSON(map[string]string{"lens": lens})}); ok {
		parts = append(parts, p)
	}
	if win != nil {
		filter, params := engine.ApprovedSnapshotFilter(engine.ReflectionStrategy{}, parent.Id, engine.WindowKey(*win))
		if snaps, err := app.FindRecordsByFilter("reflection_snapshot", filter, "-approval_sequence_number", 1, 0, params); err == nil && len(snaps) > 0 {
			if output := strings.TrimSpace(pbutil.DecodeJSONString(snaps[0].GetString("output"))); output != "" {
				if p, ok := toolCallPart(llm.ToolCall{ID: fmt.Sprintf("seed-apply-%d", now), Name: prompts.ApplyResultToolName,
					Args: mustJSON(map[string]string{"output": output})}); ok {
					parts = append(parts, p)
				}
			}
		}
	}
	return api.UIMessage{ID: fmt.Sprintf("seed-%d", now), Role: "assistant", Parts: parts}, true
}

func mustJSON(v any) json.RawMessage {
	b, _ := json.Marshal(v)
	return b
}

// ExtractDraftedLensAndSpec reads a refinement conversation's commit payload:
// the newest drafted lens, the applied output produced for that same lens, and
// the latest context. Lens and output are paired on one assistant message —
// the handler persists each turn's apply_result beside the update_lens that
// produced it — so a commit can never install lens N with output N-1, which
// would break "what the user approved is what the lens reproduces". An empty
// output with a non-empty lens means that turn's apply failed (or is still
// running); the commit handler refuses it.
func ExtractDraftedLensAndSpec(app core.App, refRec *core.Record) (lens, output string, pinned llmcontext.PinnedIDs, spec api.ContextSpec, win *api.Window, err error) {
	msgs, err := chat.LoadMessages(nil, app, refRec)
	if err != nil {
		return "", "", llmcontext.PinnedIDs{}, api.ContextSpec{}, nil, err
	}

	pinned, spec, win = llmcontext.LatestPinnedAndSpec(msgs)

	for i := len(msgs) - 1; i >= 0; i-- {
		m := msgs[i]
		if m.Role != "assistant" {
			continue
		}
		for _, p := range m.Parts {
			switch p.Type {
			case "tool-" + prompts.UpdateLensToolName:
				var data struct {
					Input struct {
						Lens string `json:"lens"`
					} `json:"input"`
				}
				if err := json.Unmarshal(p.Data, &data); err == nil {
					lens = strings.TrimSpace(data.Input.Lens)
				}
			case "tool-" + prompts.ApplyResultToolName:
				var data struct {
					Input struct {
						Output string `json:"output"`
					} `json:"input"`
				}
				if err := json.Unmarshal(p.Data, &data); err == nil {
					output = strings.TrimSpace(data.Input.Output)
				}
			}
		}
		if lens != "" {
			return lens, output, pinned, spec, win, nil
		}
		// A clarify-only turn has neither part; keep scanning. An apply part
		// never exists without its lens on the same message.
		output = ""
	}

	scanned := make([]string, 0, len(msgs))
	for _, m := range msgs {
		for _, p := range m.Parts {
			scanned = append(scanned, m.Role+"/"+p.Type)
		}
	}
	log.Printf("refinement.extract: no drafted lens in %s (%d messages: %s)",
		refRec.Id, len(msgs), strings.Join(scanned, ", "))

	return "", "", pinned, spec, win, nil
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
		rid := e.Request.PathValue("rid")
		if rid == "" {
			return e.BadRequestError("refinement id required", nil)
		}

		refRec, err := app.FindRecordById(refinementColName, rid)
		if err != nil {
			return e.NotFoundError("refinement not found", err)
		}

		lens, output, pinned, spec, win, err := ExtractDraftedLensAndSpec(app, refRec)
		if err != nil {
			return e.InternalServerError("failed to extract drafted lens", err)
		}
		if lens == "" {
			// Also the seeded-session zero-turn case: graduate/fork sessions
			// start with context only, and committing requires at least one
			// turn in which the model drafts a lens.
			return e.BadRequestError("no drafted lens found in chat", nil)
		}
		if output == "" {
			return e.Error(http.StatusConflict, "the latest lens has no generated preview — send another message to regenerate", nil)
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
		newSnapID, err := engine.CommitRefinement(ctx, app, strat, parentID, sourceSnapID, lens, output, pinned, spec, win, refRec.Id, targetCol)
		if err != nil {
			log.Printf("refinement.commit: %v", err)
			return e.InternalServerError("failed to commit refinement", err)
		}
		if targetCol == "reflection" {
			log.Printf("refinement.commit: reflection %s: refinement %s installed a new lens", parentID, refRec.Id)
			// The lens exists (or changed), so the windows the series owes
			// can be generated: for a brand-new reflection that is the whole
			// grid. Windows that already have a snapshot keep it, marked as
			// produced by an older lens, until Refresh or a per-window
			// regenerate brings them forward.
			engine.RunPendingWindows(app, parentID)
		} else {
			log.Printf("refinement.commit: %s %s: refinement %s committed as snapshot %s", targetCol, parentID, refRec.Id, newSnapID)
		}

		return e.JSON(http.StatusOK, map[string]string{"snapshotId": newSnapID})
	}
}
