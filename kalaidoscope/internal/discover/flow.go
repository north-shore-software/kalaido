package discover

import (
	"context"
	"errors"

	"github.com/pocketbase/pocketbase/core"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/llmq"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/mapping"
	"github.com/north-shore-software/kalaido/kalaidoscope/llm"
)

type Flow interface {
	Kind() string
	System() string
	Initial(c *Context) string
	Tools(c *Context) []llm.Tool
	Existing(c *Context) ([]Existing, error)
	Dispatch(ctx context.Context, c *Context, call llm.ToolCall) (string, *Output, error)
}

var flows = map[string]Flow{
	"projections": projectionsFlow{},
	"reflections": reflectionsFlow{},
}

func Kinds() []string {
	kinds := make([]string, 0, len(flows))
	for k := range flows {
		kinds = append(kinds, k)
	}
	return kinds
}

var errNoMap = errors.New("discover: the map is empty")

func Run(app core.App, flow Flow) error {
	model, err := llm.ResolveRole(llm.RoleMap)
	if err != nil {
		return err
	}
	// A kick that lands while the map is still consolidating must not read the
	// half-integrated version: the things the last batch introduced would be
	// missing and every row citing them would resolve to nothing.
	mapping.WaitSettled()
	c, err := newContext(app, nil)
	if err != nil {
		return err
	}
	if len(c.Doc.Things) == 0 {
		return errNoMap
	}
	run, err := newRun(app, flow.Kind(), c.Version, model)
	if err != nil {
		return err
	}
	c.Run = run
	ctx := llmq.WithPriority(context.Background(), llmq.Background)
	err = runLoop(ctx, c, flow, model)
	finishRun(c, err)
	return err
}
