// UNREVIEWED
package explore

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"strings"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/chat"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/engine"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/prompts"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/usage"
	"github.com/north-shore-software/kalaido/kalaidoscope/llm"
	"github.com/north-shore-software/kalaido/kalaidoscope/llm/queue"
)

// ErrNoBrief is returned when the model produced neither a tool call nor
// any text to fall back on.
var ErrNoBrief = errors.New("the model returned no brief")

// Brief is what an explore session was working towards, as the opening of a
// projection: a name and the user's first message to its drafter.
type Brief struct {
	Name    string `json:"name"`
	Message string `json:"message"`
}

func proposeBriefTool() llm.Tool {
	return llm.Tool{
		Name:        prompts.ProposeBriefToolName,
		Description: prompts.ProposeBriefToolDescription,
		Parameters: json.RawMessage(`{"type":"object","properties":{` +
			`"name":{"type":"string","description":` + strconv.Quote(prompts.BriefNameParamDescription) + `},` +
			`"message":{"type":"string","description":` + strconv.Quote(prompts.BriefMessageParamDescription) + `}` +
			`},"required":["name","message"]}`),
	}
}

// BriefLines is the conversation as the brief call reads it: every explore
// turn with text, in order, with the bookmarked ones marked.
func BriefLines(app core.App, conv *core.Record) ([]prompts.ChatBriefLine, error) {
	rows, err := app.FindRecordsByFilter(
		"chat_message",
		"chat_conversation_id = {:cid}",
		"created", 0, 0,
		dbx.Params{"cid": conv.Id},
	)
	if err != nil {
		return nil, err
	}
	var lines []prompts.ChatBriefLine
	for _, row := range rows {
		msg, err := chat.MessageFromRecord(row)
		if err != nil || msg.Role == "system" {
			continue
		}
		text := MessageText(msg)
		if text == "" {
			continue
		}
		lines = append(lines, prompts.ChatBriefLine{
			Role:       msg.Role,
			Text:       text,
			Bookmarked: row.GetBool("bookmarked"),
		})
	}
	return lines, nil
}

// GenerateBrief asks the conversation's model what projection the session
// was working towards. Interactive priority: the user is waiting on it. The
// prompt is checked against the model's budget first, like an explore turn.
func GenerateBrief(ctx context.Context, app core.App, conv *core.Record) (Brief, error) {
	lines, err := BriefLines(app, conv)
	if err != nil {
		return Brief{}, err
	}
	if len(lines) == 0 {
		return Brief{}, fmt.Errorf("%w: the conversation has no turns", ErrNoBrief)
	}
	model, err := llm.ResolveRoleFor(llm.RoleChat, conv.GetString("generate_with_model"))
	if err != nil {
		return Brief{}, err
	}
	msgs := []llm.Message{
		{Role: "system", Content: prompts.ChatBriefSystem},
		{Role: "user", Content: prompts.ChatBriefTranscript(lines)},
	}
	if err := engine.CheckPromptFits(model, engine.MessagesChars(msgs)); err != nil {
		return Brief{}, err
	}

	ctx = queue.WithPriority(ctx, queue.Interactive)
	text, calls, err := usage.GenerateWithToolCalls(ctx, app, msgs, llm.RoleChat, model, []llm.Tool{proposeBriefTool()})
	if err != nil {
		return Brief{}, err
	}
	var brief Brief
	for _, c := range calls {
		if c.Name != prompts.ProposeBriefToolName {
			continue
		}
		var args Brief
		if json.Unmarshal(c.Args, &args) == nil {
			brief = args // the last call wins, as with discover's proposals
		}
	}
	brief.Name = strings.TrimSpace(brief.Name)
	brief.Message = strings.TrimSpace(brief.Message)
	if brief.Message == "" {
		// No tool call: the answer text is the message, unnamed.
		brief.Message = strings.TrimSpace(text)
	}
	if brief.Message == "" {
		return Brief{}, ErrNoBrief
	}
	return brief, nil
}
