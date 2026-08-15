package llmcontext

import (
	stdctx "context"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/pocketbase/pocketbase/core"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/api"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/prompts"
	"github.com/north-shore-software/kalaido/kalaidoscope/llm"
)

func Flatten(uiMsgs []api.UIMessage) []llm.Message {
	msgs := make([]llm.Message, 0, len(uiMsgs))
	for _, m := range uiMsgs {
		var sb strings.Builder
		for _, p := range m.Parts {
			if p.Type == "text" {
				sb.WriteString(p.Text)
			} else if strings.HasPrefix(p.Type, "tool-") {
				var data struct {
					ToolName string `json:"toolName"`
					Input    struct {
						Draft string `json:"draft"`
					} `json:"input"`
				}
				if err := json.Unmarshal(p.Data, &data); err == nil {
					if data.Input.Draft != "" {
						if sb.Len() > 0 {
							sb.WriteString("\n\n")
						}
						fmt.Fprintf(&sb, "[You called %s, drafting:]\n%s", data.ToolName, data.Input.Draft)
					}
				}
			}
		}
		if s := sb.String(); s != "" {
			msgs = append(msgs, llm.Message{Role: m.Role, Content: s})
		}
	}
	return msgs
}

func RenderFragmentRecords(recs []*core.Record) string {
	var sb strings.Builder
	for _, rec := range recs {
		fmt.Fprintf(&sb, "--- %s from %s (ID: %s) ---\n%s\n\n",
			rec.GetString("type"),
			rec.GetString("source"),
			rec.Id,
			rec.GetString("content"))
	}
	return sb.String()
}

// HydrateContextChange renders one context change for a running conversation.
//
// The focus is stated in full rather than diffed: it is a claim about what the
// conversation is *now about*, which no add/remove delta can express — refocusing
// typically adds one document and demotes everything already present, and the
// demotion is the part that matters. Focused documents are then left out of the
// delta below so their text isn't repeated.
func HydrateContextChange(ctx stdctx.Context, app core.App, current, added, removed PinnedIDs) (string, error) {
	focus := current.FocusOrEmpty()
	if focus.IsEmpty() {
		return HydrateDeltaToText(ctx, app, added, removed)
	}

	var sb strings.Builder
	focusText, err := HydrateIDsToText(ctx, app, focus)
	if err != nil {
		return "", err
	}
	sb.WriteString(prompts.FocusHeading + "\n\n")
	sb.WriteString(focusText)
	sb.WriteString(prompts.BackgroundNotice + "\n\n")

	deltaText, err := HydrateDeltaToText(ctx, app, added.Without(focus), removed)
	if err != nil {
		return "", err
	}
	sb.WriteString(deltaText)

	return sb.String(), nil
}

func HydrateDeltaToText(ctx stdctx.Context, app core.App, added, removed PinnedIDs) (string, error) {
	var sb strings.Builder

	if len(added.FragmentIDs) > 0 || len(added.SnapshotIDs) > 0 {
		sb.WriteString("The following documents were ADDED to the active context:\n\n")
		hydrated, err := HydrateIDsToText(ctx, app, added)
		if err != nil {
			return "", err
		}
		sb.WriteString(hydrated)
	}

	if len(removed.FragmentIDs) > 0 || len(removed.SnapshotIDs) > 0 {
		sb.WriteString("The following documents were REMOVED from the active context and should no longer be relied upon:\n")
		for _, id := range removed.FragmentIDs {
			sb.WriteString("- Fragment ID: " + id + "\n")
		}
		for _, id := range removed.SnapshotIDs {
			sb.WriteString("- Snapshot ID: " + id + "\n")
		}
		sb.WriteString("\n")
	}

	return sb.String(), nil
}
