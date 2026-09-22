// UNREVIEWED
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

func sharedTools() []llm.Tool {
	return []llm.Tool{
		agent.IDsTool(prompts.ReadThingToolName, prompts.ReadThingToolDescription, prompts.ReadThingParamDescription),
		agent.IDTool(prompts.ReadFragmentToolName, prompts.ReadFragmentToolDescription, "id", prompts.ReadFragmentParamDescription),
		agent.EmptyTool(prompts.ListExistingToolName, prompts.ListExistingToolDescription),
		agent.EmptyTool(prompts.CoverageToolName, prompts.CoverageToolDescription),
		agent.IDTool(prompts.FinishToolName, prompts.FinishToolDescription, "summary", prompts.FinishSummaryParamDescription),
	}
}

func runLoop(ctx context.Context, c *Context, flow Flow, model string) error {
	existing, err := flow.Existing(c)
	if err != nil {
		return err
	}
	tools := append(sharedTools(), flow.Tools(c)...)
	msgs := []llm.Message{
		{Role: "system", Content: flow.System()},
		{Role: "user", Content: flow.Initial(c) + "\n\n" + prompts.DiscoverExistingBlock(c.listExisting(existing)) + "\n\n" + prompts.DiscoverCoverageBlock(flow.Coverage(c, existing))},
	}

	var lastReply string
	reg := agent.Registry{
		{
			Tool: agent.IDsTool(prompts.ReadThingToolName, prompts.ReadThingToolDescription, prompts.ReadThingParamDescription),
			Handler: func(ctx context.Context, call llm.ToolCall) (string, bool, error) {
				return c.ReadThings(agent.IDsArg(call)), false, nil
			},
		},
		{
			Tool: agent.IDTool(prompts.ReadFragmentToolName, prompts.ReadFragmentToolDescription, "id", prompts.ReadFragmentParamDescription),
			Handler: func(ctx context.Context, call llm.ToolCall) (string, bool, error) {
				return c.ReadFragment(ctx, agent.IDArg(call)), false, nil
			},
		},
		{
			Tool: agent.EmptyTool(prompts.ListExistingToolName, prompts.ListExistingToolDescription),
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
			Tool: agent.IDsTool(prompts.ReadColourToolName, prompts.ReadColourToolDescription, prompts.ReadColourParamDescription),
			Handler: func(ctx context.Context, call llm.ToolCall) (string, bool, error) {
				return c.ReadColours(agent.IDsArg(call)), false, nil
			},
		},
		{
			Tool: agent.EmptyTool(prompts.CoverageToolName, prompts.CoverageToolDescription),
			Handler: func(ctx context.Context, call llm.ToolCall) (string, bool, error) {
				return flow.Coverage(c, existing), false, nil
			},
		},
		{
			Tool: agent.IDTool(prompts.FinishToolName, prompts.FinishToolDescription, "summary", prompts.FinishSummaryParamDescription),
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
