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

// Hydrator renders a transcript's context deltas for the model. How a fragment
// renders is decided by the context the conversation has *now* — the final
// resolved set and the final mode — not by the mode in force when it arrived:
//
//   - in the final context and pinned (ExpandedIDs), or the final mode is
//     full: the full body;
//   - in the final context otherwise (summaries mode): its annotation row;
//   - not in the final context: omitted, as a count. Narrowing a whole-scope
//     conversation down to a few pins must not replay the whole scope.
//
// That is what lets a turn refused in full mode recover once the mode is
// summaries: the earlier delta re-renders as rows. Snapshots always render in
// full. The hydrator remembers what it has shown, so a removal lists only
// documents the model actually saw, and a document that left and came back is
// announced as restored rather than rendered a second time — its
// representation cannot have changed, so the earlier copy still stands.
type Hydrator struct {
	app       core.App
	summaries bool
	inFinal   map[string]bool
	expanded  map[string]bool
	// shown is what is in front of the model now; seen is everything ever
	// rendered, including documents since removed.
	shown map[string]bool
	seen  map[string]bool
}

func NewHydrator(app core.App, final PinnedIDs, summaries bool) *Hydrator {
	h := &Hydrator{
		app:       app,
		summaries: summaries,
		inFinal:   make(map[string]bool, len(final.FragmentIDs)),
		expanded:  make(map[string]bool, len(final.ExpandedIDs)),
		shown:     make(map[string]bool),
		seen:      make(map[string]bool),
	}
	for _, id := range final.FragmentIDs {
		h.inFinal[id] = true
	}
	for _, id := range final.ExpandedIDs {
		h.expanded[id] = true
	}
	return h
}

// Delta renders one context change. Fragments are split by their final
// representation; snapshots render in full.
func (h *Hydrator) Delta(ctx stdctx.Context, added, removed PinnedIDs) (string, error) {
	var sb strings.Builder

	var full, rows []string
	omitted, restored := 0, 0
	for _, id := range added.FragmentIDs {
		switch {
		case !h.inFinal[id]:
			omitted++
		case h.seen[id]:
			restored++
			h.shown[id] = true
		case !h.summaries || h.expanded[id]:
			full = append(full, id)
			h.shown[id], h.seen[id] = true, true
		default:
			rows = append(rows, id)
			h.shown[id], h.seen[id] = true, true
		}
	}
	if len(full) > 0 || len(added.SnapshotIDs) > 0 {
		sb.WriteString(prompts.AddedNotice)
		sb.WriteString(hydrateFlat(ctx, h.app, PinnedIDs{FragmentIDs: full, SnapshotIDs: added.SnapshotIDs}))
	}
	if len(rows) > 0 {
		sb.WriteString(prompts.SummariesAddedNotice)
		text, err := hydrateSummaries(ctx, h.app, rows)
		if err != nil {
			return "", err
		}
		sb.WriteString(text)
	}
	if restored > 0 {
		sb.WriteString(prompts.RestoredNotice(restored))
	}
	if omitted > 0 {
		sb.WriteString(prompts.OmittedAddedNotice(omitted))
	}

	var gone []string
	unseen := 0
	for _, id := range removed.FragmentIDs {
		if h.shown[id] {
			gone = append(gone, id)
			delete(h.shown, id)
		} else {
			unseen++
		}
	}
	if len(gone) > 0 || len(removed.SnapshotIDs) > 0 || unseen > 0 {
		sb.WriteString(prompts.RemovedNotice)
		for _, id := range gone {
			sb.WriteString(prompts.RemovedIDLine("Fragment", id))
		}
		for _, id := range removed.SnapshotIDs {
			sb.WriteString(prompts.RemovedIDLine("Snapshot", id))
		}
		if unseen > 0 {
			sb.WriteString(prompts.OmittedRemovedLine(unseen))
		}
		sb.WriteString("\n")
	}

	return sb.String(), nil
}

// HydrateDeltaToText renders one context as a fresh delta — an estimate, or a
// single-turn test — with `added` as the final context.
func HydrateDeltaToText(ctx stdctx.Context, app core.App, added, removed PinnedIDs, summaries bool) (string, error) {
	return NewHydrator(app, added, summaries).Delta(ctx, added, removed)
}
