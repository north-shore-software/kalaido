package discover

import (
	"context"
	"strings"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/agent"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/prompts"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/usage"
	"github.com/north-shore-software/kalaido/kalaidoscope/llm"
)

const maxRounds = 30

// The tools every discover flow advertises, in the order the model sees them.
var (
	readThingTool    = agent.IDsTool(prompts.ReadThingToolName, prompts.ReadThingToolDescription, prompts.ReadThingParamDescription)
	readFragmentTool = agent.IDTool(prompts.ReadFragmentToolName, prompts.ReadFragmentToolDescription, "id", prompts.ReadFragmentParamDescription)
	listExistingTool = agent.EmptyTool(prompts.ListExistingToolName, prompts.ListExistingToolDescription)
	coverageTool     = agent.EmptyTool(prompts.CoverageToolName, prompts.CoverageToolDescription)
	finishTool       = agent.IDTool(prompts.FinishToolName, prompts.FinishToolDescription, "summary", prompts.FinishSummaryParamDescription)
)

func runLoop(ctx context.Context, c *Context, flow Flow, model string) error {
	existing, err := flow.Existing(c)
	if err != nil {
		return err
	}
	msgs := []llm.Message{
		{Role: "system", Content: flow.System()},
		{Role: "user", Content: flow.Initial(c) + "\n\n" + prompts.DiscoverExistingBlock(c.listExisting(existing)) + "\n\n" + prompts.DiscoverCoverageBlock(flow.Coverage(c, existing))},
	}

	var lastReply string
	// The shared tools are declared to every flow; read_colour is handled
	// here too but declared only by the flows that name it (Flow.Tools).
	shared := agent.Registry{
		{
			Tool: readThingTool,
			Handler: func(ctx context.Context, call llm.ToolCall) (string, bool, error) {
				return c.ReadThings(agent.IDsArg(call)), false, nil
			},
		},
		{
			Tool: readFragmentTool,
			Handler: func(ctx context.Context, call llm.ToolCall) (string, bool, error) {
				return c.ReadFragment(ctx, agent.IDArg(call)), false, nil
			},
		},
		{
			Tool: listExistingTool,
			Handler: func(ctx context.Context, call llm.ToolCall) (string, bool, error) {
				var err error
				existing, err = flow.Existing(c)
				if err != nil {
					return "", false, err
				}
				return c.listExisting(existing), false, nil
			},
		},
		{
			Tool: coverageTool,
			Handler: func(ctx context.Context, call llm.ToolCall) (string, bool, error) {
				return flow.Coverage(c, existing), false, nil
			},
		},
		{
			Tool: finishTool,
			Handler: func(ctx context.Context, call llm.ToolCall) (string, bool, error) {
				// Some models put the closing note in the tool call rather than
				// alongside it; either way it is the run's summary.
				summary := lastReply
				if strings.TrimSpace(summary) == "" {
					summary = agent.StrArg(call, "summary")
				}
				c.Run.Set("summary", summary)
				return "", true, nil
			},
		},
	}
	tools := append(shared.Tools(), flow.Tools(c)...)
	reg := append(shared, agent.BoundTool{
		Tool: readColourTool,
		Handler: func(ctx context.Context, call llm.ToolCall) (string, bool, error) {
			return c.ReadColours(agent.IDsArg(call)), false, nil
		},
	})

	runner := agent.Runner{
		MaxRounds: maxRounds,
		Generate: func(ctx context.Context, curMsgs []llm.Message, round int) (agent.Turn, error) {
			var reply string
			var calls []llm.ToolCall
			err := usage.RetryThrottled(ctx, func() error {
				var genErr error
				reply, calls, genErr = usage.GenerateWithToolCalls(ctx, c.App, curMsgs, llm.RoleMap, model, tools)
				return genErr
			})
			if err != nil {
				return agent.Turn{}, err
			}
			c.rounds++
			lastReply = reply
			return agent.Turn{Text: reply, ToolCalls: calls}, nil
		},
		Dispatch: reg.Dispatcher(func(ctx context.Context, call llm.ToolCall) (string, bool, error) {
			text, out, err := flow.Dispatch(ctx, c, call)
			if err != nil {
				return "", false, err
			}
			if out != nil {
				c.outputs = append(c.outputs, *out)
			}
			return text, false, nil
		}),
		OnRoundEnd: func(ctx context.Context, round int) {
			c.saveProgress()
		},
	}

	return runner.Run(ctx, &msgs)
}
