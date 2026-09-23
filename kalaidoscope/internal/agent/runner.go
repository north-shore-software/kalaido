package agent

import (
	"context"
	"errors"

	"github.com/north-shore-software/kalaido/kalaidoscope/llm"
)

// Turn represents the model's output in a single interaction round.
type Turn struct {
	Text      string
	ToolCalls []llm.ToolCall
}

// Runner drives a multi-round tool-calling loop.
type Runner struct {
	// MaxRounds limits the number of model interaction rounds (must be > 0).
	MaxRounds int

	// StopBeforeLastDispatch, when true, ends the loop before executing tool calls
	// if the current round is the final allowed round (round + 1 == MaxRounds).
	// This is typical in interactive chat where dispatching tools in the final round
	// would produce results that will never be answered by the model.
	StopBeforeLastDispatch bool

	// Generate produces the next turn from the model given the current message transcript.
	// round is 0-indexed.
	Generate func(ctx context.Context, msgs []llm.Message, round int) (Turn, error)

	// Dispatch executes a single tool call.
	// Returning done=true signals that the loop should complete after the current round
	// (e.g., when a "finish" tool is invoked).
	Dispatch func(ctx context.Context, call llm.ToolCall) (output string, done bool, err error)

	// OnToolDispatched is called after each tool call is executed, passing the call and its output.
	OnToolDispatched func(call llm.ToolCall, output string)

	// PromptGuard checks whether the updated transcript still fits within model token/char limits.
	// Returning an error aborts the loop.
	PromptGuard func(msgs []llm.Message) error

	// OnRoundEnd is invoked at the end of each round (e.g. for checkpointing state or flushing).
	OnRoundEnd func(ctx context.Context, round int)
}

// Run executes the agent loop on the provided messages slice until:
// 1. A round emits no tool calls.
// 2. A tool call handler returns done=true.
// 3. MaxRounds is reached.
// 4. Generate or Dispatch returns an error, or PromptGuard fails.
func (r *Runner) Run(ctx context.Context, msgs *[]llm.Message) error {
	if r.MaxRounds <= 0 {
		return errors.New("agent: MaxRounds must be greater than 0")
	}
	if r.Generate == nil {
		return errors.New("agent: Generate function is required")
	}

	for round := 0; round < r.MaxRounds; round++ {
		turn, err := r.Generate(ctx, *msgs, round)
		if err != nil {
			return err
		}

		*msgs = append(*msgs, FormatAssistantEcho(turn.Text, turn.ToolCalls))

		if len(turn.ToolCalls) == 0 {
			if r.OnRoundEnd != nil {
				r.OnRoundEnd(ctx, round)
			}
			return nil
		}

		if r.StopBeforeLastDispatch && round+1 >= r.MaxRounds {
			if r.OnRoundEnd != nil {
				r.OnRoundEnd(ctx, round)
			}
			return nil
		}

		results := make([]string, 0, len(turn.ToolCalls))
		finished := false
		for _, call := range turn.ToolCalls {
			var out string
			if r.Dispatch != nil {
				var done bool
				out, done, err = r.Dispatch(ctx, call)
				if err != nil {
					return err
				}
				if done {
					finished = true
				}
			}
			if r.OnToolDispatched != nil {
				r.OnToolDispatched(call, out)
			}
			results = append(results, out)
		}

		if r.OnRoundEnd != nil {
			r.OnRoundEnd(ctx, round)
		}

		if finished || round+1 >= r.MaxRounds {
			return nil
		}

		*msgs = append(*msgs, FormatToolResults(results))

		if r.PromptGuard != nil {
			if err := r.PromptGuard(*msgs); err != nil {
				return err
			}
		}
	}

	return nil
}
