package reflections

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/pocketbase/pocketbase/core"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/api"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/chat"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/engine"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/llmcontext"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/prompts"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/workerutil"
	"github.com/north-shore-software/kalaido/kalaidoscope/llm"
	"github.com/north-shore-software/kalaido/kalaidoscope/schema"
)

// LensSeedPartType marks the assistant turn a reflection refinement is seeded
// with: the reflection's current lens and, when the window has one, its
// approved output.
const LensSeedPartType = "data-lens_seed"

func mustJSON(v any) json.RawMessage {
	b, _ := json.Marshal(v)
	return b
}

func sessionParentID(app core.App, refRec *core.Record) string {
	if id := refRec.GetString("reflection_id"); id != "" {
		return id
	}
	snapID := refRec.GetString("reflection_snapshot_id")
	if snapID == "" {
		return ""
	}
	snap, err := app.FindRecordById(schema.ColReflectionSnapshot.String(), snapID)
	if err != nil {
		return ""
	}
	return snap.GetString("reflection_id")
}

// SessionParent resolves the live reflection a reflection_refinement belongs
// to, or nil when missing or soft-deleted.
func SessionParent(app core.App, refRec *core.Record) *core.Record {
	id := sessionParentID(app, refRec)
	if id == "" {
		return nil
	}
	rec, err := app.FindRecordById(schema.ColReflection.String(), id)
	if err != nil || engine.IsDeleted(rec) {
		return nil
	}
	return rec
}

// SeedLensTurn builds the initial turn for a reflection refinement: its current
// lens paired with approved output for win.
func SeedLensTurn(app core.App, parent *core.Record, win *api.Window) (api.UIMessage, bool) {
	lensID := parent.GetString("current_lens_id")
	if lensID == "" {
		return api.UIMessage{}, false
	}
	lensRec, err := app.FindRecordById(schema.ColLens.String(), lensID)
	if err != nil {
		return api.UIMessage{}, false
	}
	lens := strings.TrimSpace(lensRec.GetString("prompt"))
	if lens == "" {
		return api.UIMessage{}, false
	}

	now := time.Now().UnixNano()
	parts := []api.UIMessagePart{{Type: LensSeedPartType, Data: json.RawMessage(`{}`)}}
	if p, ok := chat.ToolCallPart(llm.ToolCall{
		ID:   fmt.Sprintf("seed-lens-%d", now),
		Name: prompts.UpdateLensToolName,
		Args: mustJSON(map[string]string{"lens": lens}),
	}); ok {
		parts = append(parts, p)
	}
	if win != nil {
		filter, params := engine.ApprovedSnapshotFilter(Strategy{}, parent.Id, win)
		if snaps, err := app.FindRecordsByFilter(schema.ColReflectionSnapshot.String(), filter, "-approval_sequence_number", 1, 0, params); err == nil && len(snaps) > 0 {
			if output := strings.TrimSpace(snaps[0].GetString("output")); output != "" {
				if p, ok := chat.ToolCallPart(llm.ToolCall{
					ID:   fmt.Sprintf("seed-apply-%d", now),
					Name: prompts.ApplyResultToolName,
					Args: mustJSON(map[string]string{"output": output}),
				}); ok {
					parts = append(parts, p)
				}
			}
		}
	}
	return api.UIMessage{ID: fmt.Sprintf("seed-%d", now), Role: "assistant", Parts: parts}, true
}

// ExtractDraftedLensAndSpec reads a reflection conversation's latest drafted
// standing lens, paired preview output, and context/window.
func ExtractDraftedLensAndSpec(app core.App, refRec *core.Record) (lens, output string, pinned llmcontext.PinnedIDs, spec api.ContextSpec, win *api.Window, err error) {
	msgs, err := chat.LoadMessages(context.Background(), app, refRec)
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
			case prompts.LensPartType:
				var data prompts.LensPartData
				if err := json.Unmarshal(p.Data, &data); err == nil && strings.TrimSpace(data.Lens) != "" {
					lens = strings.TrimSpace(data.Lens)
				}
			case "tool-" + prompts.SetLensToolName:
				var data struct {
					Input struct {
						Prompt string `json:"prompt"`
					} `json:"input"`
				}
				if err := json.Unmarshal(p.Data, &data); err == nil && strings.TrimSpace(data.Input.Prompt) != "" {
					lens = strings.TrimSpace(data.Input.Prompt)
				}
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
		output = ""
	}

	return "", "", pinned, spec, win, nil
}

// CreateSession opens a reflection refinement session and seeds its initial
// context/window and standing lens turn.
func CreateSession(app core.App, clientID, targetID string, reqWindow *api.Window, contextSpec *api.ContextSpec) (string, []api.UIMessage, error) {
	var refID string
	var seeded []api.UIMessage

	err := app.RunInTransaction(func(txApp core.App) error {
		col, err := txApp.FindCollectionByNameOrId(schema.ColReflectionRefinement.String())
		if err != nil {
			return err
		}
		rec := core.NewRecord(col)
		rec.Set("external_conversation_id", clientID)
		rec.Set("reflection_id", targetID)

		parent, err := FindLive(txApp, targetID)
		if err != nil {
			return err
		}

		if err := txApp.Save(rec); err != nil {
			return err
		}
		refID = rec.Id

		var ctxSpec *api.ContextSpec
		switch {
		case contextSpec != nil:
			ctxSpec = contextSpec
		case parent != nil:
			var fromParent api.ContextSpec
			if raw := parent.GetString("current_context_spec"); raw != "" && raw != "null" {
				if err := parent.UnmarshalJSONField("current_context_spec", &fromParent); err == nil {
					ctxSpec = &fromParent
				}
			}
		}

		var win *api.Window
		if reqWindow != nil && reqWindow.Start != "" && reqWindow.End != "" {
			win = &api.Window{Start: reqWindow.Start, End: reqWindow.End}
		} else {
			win = DefaultRefinementWindow(parent, time.Now())
		}
		if win != nil {
			win.ID = WindowID(targetID, *win)
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

		if lensMsg, ok := SeedLensTurn(txApp, parent, win); ok {
			if _, err := chat.PersistMessage(context.Background(), txApp, rec, lensMsg, ""); err != nil {
				return err
			}
			seeded = append(seeded, lensMsg)
		}

		return nil
	})
	return refID, seeded, err
}

// CommitSession atomically installs a reflection refinement session's staged
// schedule, context sources, standing lens, and optional name in one
// transaction, then kicks RunPendingWindows.
func CommitSession(
	ctx context.Context,
	app core.App,
	refRec *core.Record,
	expectedParentID string,
	req api.SaveReflectionRequest,
	runner workerutil.Runner,
) (string, error) {
	parent := sessionParentID(app, refRec)
	if parent == "" {
		return "", chat.ErrMissingParentID
	}
	if expectedParentID != "" && expectedParentID != parent {
		return "", chat.ErrParentMismatch
	}

	msgs, err := chat.LoadMessages(ctx, app, refRec)
	if err != nil {
		return "", err
	}
	txLens, txOutput, _, txSpec, _, err := ExtractDraftedLensAndSpec(app, refRec)
	if err != nil {
		return "", err
	}
	hasTxContextSpec := false
	for _, m := range msgs {
		if m.Role != "system" {
			continue
		}
		for _, p := range m.Parts {
			if p.Type == "context_spec" {
				hasTxContextSpec = true
			}
		}
	}

	hasStagedOverrides := req.WindowSpec != nil || req.ContextSpec != nil || req.LensPrompt != nil || req.Name != nil

	var lensPrompt string
	if req.LensPrompt != nil && strings.TrimSpace(*req.LensPrompt) != "" {
		lensPrompt = strings.TrimSpace(*req.LensPrompt)
	} else if txLens != "" {
		lensPrompt = txLens
	} else if parentRec, perr := FindLive(app, parent); perr == nil {
		_, existingPrompt := engine.ReadActiveLens(app, Strategy{}, parentRec)
		lensPrompt = strings.TrimSpace(existingPrompt)
	}
	if lensPrompt == "" {
		return "", chat.ErrNoDraftedLens
	}

	if !hasStagedOverrides && txOutput == "" {
		return "", chat.ErrNoPreviewOutput
	}

	var ctxSpec *api.ContextSpec
	if req.ContextSpec != nil {
		ctxSpec = req.ContextSpec
	} else if hasTxContextSpec {
		specCopy := txSpec
		ctxSpec = &specCopy
	}

	lensID, err := SaveTuning(app, parent, SaveTuningParams{
		RefinementID: refRec.Id,
		WindowSpec:   req.WindowSpec,
		ContextSpec:  ctxSpec,
		LensPrompt:   lensPrompt,
		Name:         req.Name,
	})
	if err != nil {
		logger().Error("reflection refinement commit failed", "error", err)
		return "", err
	}

	logger().Info("refinement installed a new lens", "target_type", "reflection", "reflection_id", parent, "refinement_id", refRec.Id, "lens_id", lensID)
	if runner != nil {
		RunPendingWindows(runner, app, parent)
	}
	return lensID, nil
}
