package mapping

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/pocketbase/pocketbase/core"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/prompts"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/usage"
	"github.com/north-shore-software/kalaido/kalaidoscope/llm"
)

func annotateOne(ctx context.Context, app core.App, model string, frag *core.Record) error {
	d, err := loadDocument(app)
	if err != nil {
		return err
	}
	block := prompts.FragmentBlock(frag.GetString("type"), frag.GetString("source"), frag.Id, frag.GetString("content"))
	msgs := []llm.Message{{Role: "user", Content: prompts.AnnotatePrompt(d.doc, block)}}
	reply, err := generate(ctx, app, model, msgs)
	if err != nil {
		return err
	}
	ann, ok := prompts.ParseAnnotateReply(reply)
	if !ok {
		msgs = append(msgs,
			llm.Message{Role: "assistant", Content: reply},
			llm.Message{Role: "user", Content: prompts.MapJSONRetryNudge})
		reply, err = generate(ctx, app, model, msgs)
		if err != nil {
			return err
		}
		if ann, ok = prompts.ParseAnnotateReply(reply); !ok {
			return fmt.Errorf("unparseable annotate reply")
		}
	}
	col, err := app.FindCollectionByNameOrId("fragment_annotation")
	if err != nil {
		return err
	}
	rec := core.NewRecord(col)
	rec.Set("fragment_id", frag.Id)
	rec.Set("title", ann.Title)
	rec.Set("summary", ann.Summary)
	for name, v := range map[string]any{
		"things":      ann.Things,
		"decisions":   ann.Decisions,
		"questions":   ann.Questions,
		"conclusions": ann.Conclusions,
	} {
		b, err := json.Marshal(v)
		if err != nil {
			return err
		}
		rec.Set(name, json.RawMessage(b))
	}
	rec.Set("grounded_count", prompts.AnnotateShown(d.doc))
	rec.Set("folded", false)
	rec.Set("model", model)
	if err := app.Save(rec); err != nil {
		return err
	}
	signalAggregate()
	return nil
}

func generate(ctx context.Context, app core.App, model string, msgs []llm.Message) (string, error) {
	var reply string
	err := retryPreempted(func() error {
		var err error
		reply, err = usage.GenerateOnceMsgs(ctx, app, msgs, llm.RoleAnnotate, model, nil)
		return err
	})
	return reply, err
}
