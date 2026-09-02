package discover

import (
	"context"
	"encoding/json"
	"strconv"
	"strings"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/prompts"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/usage"
	"github.com/north-shore-software/kalaido/kalaidoscope/llm"
)

const maxRounds = 30

func idTool(name, description, param, paramDescription string) llm.Tool {
	return llm.Tool{
		Name:        name,
		Description: description,
		Parameters: json.RawMessage(`{"type":"object","properties":{"` + param + `":{"type":"string","description":` +
			strconv.Quote(paramDescription) + `}},"required":["` + param + `"]}`),
	}
}

func idsTool(name, description, paramDescription string) llm.Tool {
	return llm.Tool{
		Name:        name,
		Description: description,
		Parameters: json.RawMessage(`{"type":"object","properties":{"ids":{"type":"array","items":{"type":"string"},"description":` +
			strconv.Quote(paramDescription) + `}},"required":["ids"]}`),
	}
}

func emptyTool(name, description string) llm.Tool {
	return llm.Tool{Name: name, Description: description, Parameters: json.RawMessage(`{"type":"object","properties":{}}`)}
}

func sharedTools() []llm.Tool {
	return []llm.Tool{
		idsTool(prompts.ReadThingToolName, prompts.ReadThingToolDescription, prompts.ReadThingParamDescription),
		idTool(prompts.ReadFragmentToolName, prompts.ReadFragmentToolDescription, "id", prompts.ReadFragmentParamDescription),
		emptyTool(prompts.ListExistingToolName, prompts.ListExistingToolDescription),
		emptyTool(prompts.CoverageToolName, prompts.CoverageToolDescription),
		idTool(prompts.FinishToolName, prompts.FinishToolDescription, "summary", prompts.FinishSummaryParamDescription),
	}
}

func idsArg(call llm.ToolCall) []string {
	var args struct {
		IDs []string `json:"ids"`
		ID  string   `json:"id"`
	}
	_ = json.Unmarshal(call.Args, &args)
	ids := args.IDs
	if len(ids) == 0 && strings.TrimSpace(args.ID) != "" {
		ids = []string{args.ID}
	}
	return ids
}

func strArg(call llm.ToolCall, key string) string {
	var args map[string]any
	_ = json.Unmarshal(call.Args, &args)
	v, _ := args[key].(string)
	return strings.TrimSpace(v)
}

func idArg(call llm.ToolCall) string {
	var args struct {
		ID string `json:"id"`
	}
	_ = json.Unmarshal(call.Args, &args)
	return strings.TrimSpace(args.ID)
}

func runLoop(ctx context.Context, c *Context, flow Flow, model string) error {
	existing, err := flow.Existing(c)
	if err != nil {
		return err
	}
	tools := append(sharedTools(), flow.Tools(c)...)
	msgs := []llm.Message{
		{Role: "system", Content: flow.System()},
		{Role: "user", Content: flow.Initial(c) + "\n\n" + prompts.DiscoverExistingBlock(c.listExisting(existing)) + "\n\n" + prompts.DiscoverCoverageBlock(c.coverage(existing))},
	}
	for c.rounds < maxRounds {
		var reply string
		var calls []llm.ToolCall
		err := retryPreempted(func() error {
			var genErr error
			reply, calls, genErr = usage.GenerateWithToolCalls(ctx, c.App, msgs, llm.RoleMap, model, tools)
			return genErr
		})
		if err != nil {
			return err
		}
		c.rounds++
		msgs = append(msgs, llm.Message{Role: "assistant", Content: reply + prompts.DiscoverEchoToolCalls(toolNames(calls))})
		if len(calls) == 0 {
			c.saveProgress()
			return nil
		}
		finished := false
		var results []string
		for _, call := range calls {
			switch call.Name {
			case prompts.ReadThingToolName:
				results = append(results, c.ReadThings(idsArg(call)))
			case prompts.ReadFragmentToolName:
				results = append(results, c.ReadFragment(ctx, idArg(call)))
			case prompts.ListExistingToolName:
				existing, err = flow.Existing(c)
				if err != nil {
					return err
				}
				results = append(results, c.listExisting(existing))
			case prompts.CoverageToolName:
				results = append(results, c.coverage(existing))
			case prompts.FinishToolName:
				finished = true
				// Some models put the closing note in the tool call rather than
				// alongside it; either way it is the run's summary.
				if strings.TrimSpace(reply) == "" {
					reply = strArg(call, "summary")
				}
			default:
				text, out, err := flow.Dispatch(ctx, c, call)
				if err != nil {
					return err
				}
				if out != nil {
					c.outputs = append(c.outputs, *out)
				}
				results = append(results, text)
			}
		}
		c.saveProgress()
		if finished {
			c.Run.Set("summary", reply)
			return nil
		}
		msgs = append(msgs, llm.Message{Role: "user", Content: strings.Join(results, "\n\n")})
	}
	return nil
}

func toolNames(calls []llm.ToolCall) []string {
	names := make([]string, 0, len(calls))
	for _, call := range calls {
		names = append(names, call.Name)
	}
	return names
}
