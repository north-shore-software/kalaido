package mapping

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"strconv"
	"strings"
	"sync"

	"github.com/pocketbase/pocketbase/core"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/llmcontext"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/prompts"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/usage"
	"github.com/north-shore-software/kalaido/kalaidoscope/llm"
)

var expandFragmentTool = llm.Tool{
	Name:        prompts.ExpandFragmentToolName,
	Description: prompts.ExpandFragmentToolDescription,
	Parameters: json.RawMessage(`{
		"type": "object",
		"properties": {
			"id": {
				"type": "string",
				"description": ` + strconv.Quote(prompts.ExpandFragmentParamDescription) + `
			}
		},
		"required": ["id"]
	}`),
}

func markupAndIncorporate(ctx context.Context, app core.App, m *workspaceMap, runID, model string, chunk []*core.Record) (int, error) {
	anns, err := markupChunk(ctx, app, m.body, m.version, model, chunk)
	if err != nil {
		return 0, err
	}
	var sb strings.Builder
	for i, r := range chunk {
		sb.WriteString(prompts.AnnotationBlock(
			r.GetString("type"),
			r.Id,
			r.GetDateTime("source_time").String(),
			string(anns[i].body)))
	}
	newBody, exp, err := incorporate(ctx, app, m.body, model, sb.String(), true)
	if err != nil {
		return exp, err
	}
	return exp, persistChunk(app, m, runID, model, newBody, anns)
}

func incorporateRawThenAnnotate(ctx context.Context, app core.App, m *workspaceMap, runID, model string, chunk []*core.Record) (int, error) {
	newBody, exp, err := incorporate(ctx, app, m.body, model, llmcontext.RenderFragmentRecords(chunk), false)
	if err != nil {
		return exp, err
	}
	anns, err := markupChunk(ctx, app, newBody, m.version+1, model, chunk)
	if err != nil {
		return exp, err
	}
	return exp, persistChunk(app, m, runID, model, newBody, anns)
}

func markupChunk(ctx context.Context, app core.App, mapBody string, groundedVersion int, model string, chunk []*core.Record) ([]annotation, error) {
	anns := make([]annotation, len(chunk))
	errs := make([]error, len(chunk))
	sem := make(chan struct{}, markupConcurrency)
	var wg sync.WaitGroup
	for i, rec := range chunk {
		wg.Add(1)
		go func(i int, rec *core.Record) {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()
			body, err := markupOne(ctx, app, mapBody, model, rec)
			if err != nil {
				errs[i] = err
				return
			}
			anns[i] = annotation{fragmentID: rec.Id, body: body, groundedVersion: groundedVersion}
		}(i, rec)
	}
	wg.Wait()
	for i, err := range errs {
		if err != nil {
			return nil, fmt.Errorf("markup fragment %s: %w", chunk[i].Id, err)
		}
	}
	return anns, nil
}

func markupOne(ctx context.Context, app core.App, mapBody, model string, rec *core.Record) (json.RawMessage, error) {
	block := prompts.FragmentBlock(rec.GetString("type"), rec.GetString("source"), rec.Id, rec.GetString("content"))
	msgs := []llm.Message{{Role: "user", Content: prompts.MapMarkupPrompt(mapBody, block)}}
	var reply string
	err := retryPreempted(func() error {
		var err error
		reply, err = usage.GenerateOnceMsgs(ctx, app, msgs, llm.RoleMap, model, nil)
		return err
	})
	if err != nil {
		return nil, err
	}
	if body, ok := prompts.ParseMarkupReply(reply); ok {
		return body, nil
	}
	msgs = append(msgs,
		llm.Message{Role: "assistant", Content: reply},
		llm.Message{Role: "user", Content: prompts.MapJSONRetryNudge})
	err = retryPreempted(func() error {
		var err error
		reply, err = usage.GenerateOnceMsgs(ctx, app, msgs, llm.RoleMap, model, nil)
		return err
	})
	if err != nil {
		return nil, err
	}
	if body, ok := prompts.ParseMarkupReply(reply); ok {
		return body, nil
	}
	return nil, fmt.Errorf("unparseable markup reply")
}

func incorporate(ctx context.Context, app core.App, mapBody, model, inputBlock string, allowTools bool) (string, int, error) {
	msgs := []llm.Message{{Role: "user", Content: prompts.MapIncorporatePrompt(mapBody, inputBlock)}}
	tools := []llm.Tool{expandFragmentTool}
	if !allowTools {
		tools = nil
	}
	expansions := 0
	var reply string

	for round := 0; round <= maxToolRounds; round++ {
		var calls []llm.ToolCall
		err := retryPreempted(func() error {
			var err error
			reply, calls, err = usage.GenerateWithToolCalls(ctx, app, msgs, llm.RoleMap, model, tools)
			return err
		})
		if err != nil {
			return "", expansions, err
		}

		ids := expandIDs(calls)
		if len(ids) == 0 || round == maxToolRounds {
			break
		}
		if allowed := maxExpansionsPerChunk - expansions; len(ids) > allowed {
			ids = ids[:allowed]
		}
		if len(ids) == 0 {
			msgs = append(msgs,
				llm.Message{Role: "assistant", Content: reply},
				llm.Message{Role: "user", Content: prompts.MapExpandBudgetExhausted})
			tools = nil
			continue
		}
		expansions += len(ids)
		block := llmcontext.RenderFragmentRecords(llmcontext.LoadFragmentsByIDs(ctx, app, ids))
		if block == "" {
			block = prompts.MapExpandNotFound
		}
		content := reply
		if content != "" {
			content += "\n\n"
		}
		msgs = append(msgs,
			llm.Message{Role: "assistant", Content: content + prompts.MapExpandEcho(ids)},
			llm.Message{Role: "user", Content: prompts.MapExpandResult(block)})
	}

	if body, ok := prompts.ParseMapReply(reply); ok {
		return guardSize(string(body)), expansions, nil
	}
	msgs = append(msgs,
		llm.Message{Role: "assistant", Content: reply},
		llm.Message{Role: "user", Content: prompts.MapJSONRetryNudge})
	err := retryPreempted(func() error {
		var err error
		reply, err = usage.GenerateOnceMsgs(ctx, app, msgs, llm.RoleMap, model, nil)
		return err
	})
	if err != nil {
		return "", expansions, err
	}
	if body, ok := prompts.ParseMapReply(reply); ok {
		return guardSize(string(body)), expansions, nil
	}
	return "", expansions, fmt.Errorf("unparseable map reply")
}

func expandIDs(calls []llm.ToolCall) []string {
	var ids []string
	for _, c := range calls {
		if c.Name != prompts.ExpandFragmentToolName {
			continue
		}
		var args struct {
			ID string `json:"id"`
		}
		if err := json.Unmarshal(c.Args, &args); err != nil || args.ID == "" {
			continue
		}
		ids = append(ids, args.ID)
	}
	return ids
}

func guardSize(body string) string {
	if len(body) > maxMapBytes {
		log.Printf("mapping: map body is %d bytes (guard: %d) — consider edit-op incorporation", len(body), maxMapBytes)
	}
	return body
}
