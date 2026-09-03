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
	// Coverage answers the coverage tool: the colours flow measures what the
	// colours leave uncovered by thing; projections and reflections measure
	// what their scopes leave uncovered by colour.
	Coverage(c *Context, existing []Existing) string
	Dispatch(ctx context.Context, c *Context, call llm.ToolCall) (string, *Output, error)
}

var flows = map[string]Flow{
	"colours":     coloursFlow{},
	"projections": projectionsFlow{},
	"reflections": reflectionsFlow{},
}

// scopesByColour is the flows whose proposals pin colours: they cannot run
// until some exist, which the pipeline order (colours first) guarantees.
var scopesByColour = map[string]bool{"projections": true, "reflections": true}

func Kinds() []string {
	kinds := make([]string, 0, len(flows))
	for k := range flows {
		kinds = append(kinds, k)
	}
	return kinds
}

var (
	errNoMap     = errors.New("discover: the map is empty")
	errNoColours = errors.New("discover: no colours exist yet")
)

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
	if scopesByColour[flow.Kind()] && len(c.Colours) == 0 {
		return errNoColours
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
