// UNREVIEWED
package chat

import (
	"context"
	"encoding/json"

	"github.com/pocketbase/pocketbase/core"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/api"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/llmcontext"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/prompts"
	"github.com/north-shore-software/kalaido/kalaidoscope/llm"
)

func ExtractNewMessages(dbMsgs []api.UIMessage, incoming []api.UIMessage) []api.UIMessage {
	existingIDs := make(map[string]bool)
	for _, m := range dbMsgs {
		existingIDs[m.ID] = true
	}

	var newMsgs []api.UIMessage
	for _, m := range incoming {
		if !existingIDs[m.ID] {
			newMsgs = append(newMsgs, m)
		}
	}
	return newMsgs
}

// ResolveContextSpecs stamps each incoming system message that changes the
// context — a `context_spec` part, a `window` part, or both — with the
// `pinned_ids` that (spec, window) pair resolves to right now. The pair is
// cumulative across the transcript: a window change alone re-resolves the
// spec already in effect (read from history), and vice versa, so pinned_ids
// always reflect both.
func ResolveContextSpecs(ctx context.Context, app core.App, history, newMsgs []api.UIMessage) {
	_, spec, win := llmcontext.LatestPinnedAndSpec(history)
	for i, m := range newMsgs {
		if m.Role != "system" {
			continue
		}
		changed := false
		for _, p := range m.Parts {
			switch p.Type {
			case "context_spec":
				var s api.ContextSpec
				if err := json.Unmarshal(p.Data, &s); err == nil {
					spec = s
					changed = true
				}
			case "window":
				var w api.Window
				if err := json.Unmarshal(p.Data, &w); err == nil {
					if w.Start != "" && w.End != "" {
						win = &w
					} else {
						win = nil
					}
					changed = true
				}
			}
		}
		if !changed {
			continue
		}
		if pinned, err := llmcontext.ResolveSpecToIDs(ctx, app, spec, win); err == nil {
			b, _ := json.Marshal(pinned)
			newMsgs[i].Parts = append(newMsgs[i].Parts, api.UIMessagePart{
				Type: "pinned_ids",
				Data: b,
			})
		}
	}
}

// messageWindow is the `window` part a system message carries, if any.
func messageWindow(m api.UIMessage) *api.Window {
	for _, p := range m.Parts {
		if p.Type == "window" && len(p.Data) > 0 {
			var w api.Window
			if json.Unmarshal(p.Data, &w) == nil && w.Start != "" && w.End != "" {
				return &w
			}
		}
	}
	return nil
}

// HydrateDeltaHistory renders the transcript for the model. Every delta is
// rendered against the conversation's *final* context and mode (see
// llmcontext.Hydrator): a transcript that turned summaries on after a failed
// full-mode turn re-renders its whole context as rows, which is what lets that
// turn recover, and one narrowed from whole scope to a few pins carries only
// those pins' bodies.
func HydrateDeltaHistory(ctx context.Context, app core.App, allMsgs []api.UIMessage) []llm.Message {
	var activeIDs llmcontext.PinnedIDs
	var hydratedMsgs []llm.Message
	final, spec, _ := llmcontext.LatestPinnedAndSpec(allMsgs)
	hydrator := llmcontext.NewHydrator(app, final, spec.WholeScope == api.WholeScopeSummaries)

	for _, m := range allMsgs {
		if m.Role == "system" {
			var foundPinned bool
			var pinned llmcontext.PinnedIDs
			for _, p := range m.Parts {
				if p.Type == "pinned_ids" && len(p.Data) > 0 {
					if err := json.Unmarshal(p.Data, &pinned); err == nil {
						foundPinned = true
					}
				}
			}
			var text string
			if w := messageWindow(m); w != nil {
				text = prompts.WindowNotice(w.Start, w.End)
			}
			if foundPinned {
				added, removed := llmcontext.DiffPinnedIDs(activeIDs, pinned)
				deltaText, _ := hydrator.Delta(ctx, added, removed)
				text += deltaText
				activeIDs = pinned
			}
			if text != "" {
				hydratedMsgs = append(hydratedMsgs, llm.Message{Role: "system", Content: text})
			}
		} else {
			if flat := llmcontext.Flatten([]api.UIMessage{m}); len(flat) > 0 {
				hydratedMsgs = append(hydratedMsgs, flat...)
			}
		}
	}
	return hydratedMsgs
}
