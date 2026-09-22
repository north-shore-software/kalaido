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

func idTool(name, description, param, paramDescription string) llm.Tool {
	return agent.IDTool(name, description, param, paramDescription)
}

func idsTool(name, description, paramDescription string) llm.Tool {
	return agent.IDsTool(name, description, paramDescription)
}

func emptyTool(name, description string) llm.Tool {
	return agent.EmptyTool(name, description)
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
		Dispatch: func(ctx context.Context, call llm.ToolCall) (string, bool, error) {
			switch call.Name {
			case prompts.ReadThingToolName:
				return c.ReadThings(agent.IDsArg(call)), false, nil
			case prompts.ReadFragmentToolName:
				return c.ReadFragment(ctx, agent.IDArg(call)), false, nil
			case prompts.ListExistingToolName:
				var err error
				existing, err = flow.Existing(c)
				if err != nil {
					return "", false, err
				}
				return c.listExisting(existing), false, nil
			case prompts.ReadColourToolName:
				return c.ReadColours(agent.IDsArg(call)), false, nil
			case prompts.CoverageToolName:
				return flow.Coverage(c, existing), false, nil
			case prompts.FinishToolName:
				// Some models put the closing note in the tool call rather than
				// alongside it; either way it is the run's summary.
				summary := lastReply
				if strings.TrimSpace(summary) == "" {
					summary = agent.StrArg(call, "summary")
				}
				c.Run.Set("summary", summary)
				return "", true, nil
			default:
				text, out, err := flow.Dispatch(ctx, c, call)
				if err != nil {
					return "", false, err
				}
				if out != nil {
					c.outputs = append(c.outputs, *out)
				}
				return text, false, nil
			}
		},
		OnRoundEnd: func(ctx context.Context, round int) {
			c.saveProgress()
		},
	}

	return runner.Run(ctx, &msgs)
}
