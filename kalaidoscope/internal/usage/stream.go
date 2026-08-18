package usage

import (
	"context"
	"errors"
	"strings"

	"github.com/pocketbase/pocketbase/core"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/llmq"
	"github.com/north-shore-software/kalaido/kalaidoscope/llm"
)

func Stream(ctx context.Context, app core.App, role llm.Role, msgs []llm.Message, tools []llm.Tool) (*llm.Completion, error) {
	comp, _, err := stream(ctx, app, role, msgs, tools)
	return comp, err
}

// stream is the one path to a provider: quota check, role→model resolution,
// scheduler admission, then the call itself, with token recording and slot
// release once the stream drains. The run context is returned alongside so
// GenerateOnce can tell a preempted call from a completed one.
func stream(ctx context.Context, app core.App, role llm.Role, msgs []llm.Message, tools []llm.Tool) (*llm.Completion, context.Context, error) {
	if err := Authorized(ctx, app); err != nil {
		return nil, nil, err
	}
	model, err := llm.ResolveRole(role)
	if err != nil {
		return nil, nil, err
	}

	prio := llmq.PriorityFromContext(ctx, llmq.DefaultPriorityForRole(role))
	runCtx, release, err := llmq.Acquire(ctx, llmq.Request{Priority: prio, Role: role, Model: model})
	if err != nil {
		return nil, nil, err
	}

	comp, err := llm.SelectedProvider(model).Stream(runCtx, msgs, tools, llm.OptionsForRole(role))
	if err != nil {
		release()
		return nil, nil, err
	}
	wrapped := make(chan llm.StreamEvent)
	go func() {
		// The slot is held until the stream fully drains — that is when the
		// provider is actually free again.
		defer release()
		defer close(wrapped)
		// Live throughput for the queue status line: ~4 chars per token. An
		// estimate on purpose — the exact count only arrives with the final
		// chunk, which is too late to watch.
		chars, reported := 0, 0
		for c := range comp.Events {
			chars += len(c.Text) + len(c.Args)
			if est := chars / 4; est > reported {
				llmq.AddProgress(runCtx, est-reported)
				reported = est
			}
			wrapped <- c
		}
		Record(ctx, app, comp.Wait())
	}()
	return &llm.Completion{Events: wrapped, Wait: comp.Wait}, runCtx, nil
}

func GenerateOnce(ctx context.Context, app core.App, prompt string, role llm.Role, tools []llm.Tool) (string, error) {
	return GenerateOnceMsgs(ctx, app, []llm.Message{{Role: "user", Content: prompt}}, role, tools)
}

// GenerateOnceMsgs is GenerateOnce over a full message transcript, for callers
// holding a multi-turn conversation (the lens distillation loop).
func GenerateOnceMsgs(ctx context.Context, app core.App, msgs []llm.Message, role llm.Role, tools []llm.Tool) (string, error) {
	comp, runCtx, err := stream(ctx, app, role, msgs, tools)
	if err != nil {
		return "", err
	}
	var sb strings.Builder
	for ev := range comp.Events {
		if ev.Kind == llm.EventText {
			sb.WriteString(ev.Text)
		}
	}
	// A preempted call ends as an ordinary early channel close; without this
	// check the partial text would be returned as if it were the whole answer.
	if cause := context.Cause(runCtx); errors.Is(cause, llmq.ErrPreempted) {
		return "", llmq.ErrPreempted
	}
	return sb.String(), nil
}
