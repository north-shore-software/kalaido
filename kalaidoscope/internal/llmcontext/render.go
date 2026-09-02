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

// WindowReapplyPartType marks an assistant turn the server fabricated to
// re-apply the standing lens to a different preview window. It repeats the
// lens part (so the commit-time pairing of lens and output holds) but says
// nothing new to the lens-writer, so Flatten leaves it out.
const WindowReapplyPartType = "data-window_reapply"

func hasPart(m api.UIMessage, partType string) bool {
	for _, p := range m.Parts {
		if p.Type == partType {
			return true
		}
	}
	return false
}

// readToolPart is the persisted shape of a chat read tool call (read_fragment,
// read_thing) with its result; a part without output was an interrupted turn.
type readToolPart struct {
	ToolName string `json:"toolName"`
	Output   string `json:"output"`
}

func isReadToolPart(typ string) bool {
	return typ == "tool-"+prompts.ReadFragmentToolName || typ == "tool-"+prompts.ReadThingToolName
}

func Flatten(uiMsgs []api.UIMessage) []llm.Message {
	msgs := make([]llm.Message, 0, len(uiMsgs))
	for _, m := range uiMsgs {
		if hasPart(m, WindowReapplyPartType) {
			continue
		}
		var sb strings.Builder
		// Chat read tools replay as the exchange the model saw live: its text
		// plus the echo of the calls it made, then a user turn carrying the
		// results, then whatever it said next. Pending reads flush at the next
		// text part or at the end of the message.
		var readNames, readOutputs []string
		flushReads := func() {
			if len(readOutputs) == 0 {
				return
			}
			msgs = append(msgs,
				llm.Message{Role: m.Role, Content: sb.String() + prompts.DiscoverEchoToolCalls(readNames)},
				llm.Message{Role: "user", Content: strings.Join(readOutputs, "\n\n")})
			sb.Reset()
			readNames, readOutputs = nil, nil
		}
		for _, p := range m.Parts {
			switch {
			case p.Type == "text":
				flushReads()
				sb.WriteString(ExpandMentions(p.Text))
			case isReadToolPart(p.Type):
				var data readToolPart
				if err := json.Unmarshal(p.Data, &data); err == nil && data.Output != "" {
					name := data.ToolName
					if name == "" {
						name = strings.TrimPrefix(p.Type, "tool-")
					}
					readNames = append(readNames, name)
					readOutputs = append(readOutputs, data.Output)
				}
			case p.Type == "tool-"+prompts.UpdateLensToolName:
				// The lens is the only tool part echoed back into the
				// transcript. Everything else on an assistant message —
				// tool-apply_result (the lens's executed output),
				// tool-suggest_name, data-* notices — must stay invisible to
				// the model: a lens-writer that sees its own output starts
				// encoding output back into the lens, which is the overfitting
				// this design removes.
				var data struct {
					ToolName string `json:"toolName"`
					Input    struct {
						Lens string `json:"lens"`
					} `json:"input"`
				}
				if err := json.Unmarshal(p.Data, &data); err == nil {
					if data.Input.Lens != "" {
						if sb.Len() > 0 {
							sb.WriteString("\n\n")
						}
						sb.WriteString(prompts.LensEcho(data.ToolName, data.Input.Lens))
					}
				}
			}
		}
		flushReads()
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

// HydrateDeltaToText renders a context change. In summaries mode the added
// fragments are annotation rows rather than full bodies (see hydrateSummaries);
// removals render the same way in both modes.
func HydrateDeltaToText(ctx stdctx.Context, app core.App, added, removed PinnedIDs, summaries bool) (string, error) {
	var sb strings.Builder

	if len(added.FragmentIDs) > 0 || len(added.SnapshotIDs) > 0 {
		var hydrated string
		var err error
		if summaries {
			sb.WriteString(prompts.SummariesAddedNotice)
			hydrated, err = hydrateSummaries(ctx, app, added)
		} else {
			sb.WriteString(prompts.AddedNotice)
			hydrated, err = HydrateIDsToText(ctx, app, added)
		}
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
