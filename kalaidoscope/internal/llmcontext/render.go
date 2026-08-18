package llmcontext

import (
	stdctx "context"
	"encoding/json"
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
				sb.WriteString(ExpandMentions(p.Text))
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
						sb.WriteString(prompts.DraftEcho(data.ToolName, data.Input.Draft))
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
		sb.WriteString(prompts.FragmentBlock(
			rec.GetString("type"),
			rec.GetString("source"),
			rec.Id,
			rec.GetString("content")))
	}
	return sb.String()
}

func HydrateDeltaToText(ctx stdctx.Context, app core.App, added, removed PinnedIDs) (string, error) {
	var sb strings.Builder

	if len(added.FragmentIDs) > 0 || len(added.SnapshotIDs) > 0 {
		sb.WriteString(prompts.AddedNotice)
		hydrated, err := HydrateIDsToText(ctx, app, added)
		if err != nil {
			return "", err
		}
		sb.WriteString(hydrated)
	}

	if len(removed.FragmentIDs) > 0 || len(removed.SnapshotIDs) > 0 {
		sb.WriteString(prompts.RemovedNotice)
		for _, id := range removed.FragmentIDs {
			sb.WriteString(prompts.RemovedIDLine("Fragment", id))
		}
		for _, id := range removed.SnapshotIDs {
			sb.WriteString(prompts.RemovedIDLine("Snapshot", id))
		}
		sb.WriteString("\n")
	}

	return sb.String(), nil
}
