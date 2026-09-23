package discover

import (
	"context"
	"encoding/json"
	"strconv"
	"strings"

	"github.com/pocketbase/pocketbase/core"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/agent"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/api"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/engine"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/pbutil"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/projections"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/prompts"
	"github.com/north-shore-software/kalaido/kalaidoscope/llm"
)

const worklistFloor = 5

// projectionsFlow proposes projections scoped by colour. It runs after the
// colours flow, so the colours are the worklist: a proposal pins colour ids
// (never fragments), and its scope keeps growing as the colours do.
type projectionsFlow struct{}

func (projectionsFlow) Kind() string   { return "projections" }
func (projectionsFlow) System() string { return prompts.DiscoverProjectionsSystem }

func (projectionsFlow) Initial(c *Context) string {
	return prompts.DiscoverProjectionsInitial(c.Doc, c.coloursBlock())
}

func stringArray(description string) string {
	return agent.StringArraySchema(description)
}

var readColourTool = agent.IDsTool(prompts.ReadColourToolName, prompts.ReadColourToolDescription, prompts.ReadColourParamDescription)

var proposeProjectionTool = llm.Tool{
	Name:        prompts.ProposeProjectionToolName,
	Description: prompts.ProposeProjectionToolDescription,
	Parameters: json.RawMessage(`{"type":"object","properties":{` +
		`"name":{"type":"string","description":` + strconv.Quote(prompts.ProposeNameParamDescription) + `},` +
		`"message":{"type":"string","description":` + strconv.Quote(prompts.ProposeMessageParamDescription) + `},` +
		`"colourIds":` + stringArray(prompts.ProposeColourIDsParamDescription) + `,` +
		`"sourceProjectionIds":` + stringArray(prompts.ProposeSourceProjectionIDsParamDescription) +
		`},"required":["name","message"]}`),
}

func (projectionsFlow) Tools(c *Context) []llm.Tool {
	return []llm.Tool{readColourTool, proposeProjectionTool}
}

func (projectionsFlow) Existing(c *Context) ([]Existing, error) {
	return existingEntities(c)
}

func (projectionsFlow) Coverage(c *Context, existing []Existing) string {
	return c.colourCoverage(existing)
}

type proposeProjectionArgs struct {
	Name                string   `json:"name"`
	Message             string   `json:"message"`
	ColourIDs           []string `json:"colourIds"`
	SourceProjectionIDs []string `json:"sourceProjectionIds"`
}

func (f projectionsFlow) Dispatch(ctx context.Context, c *Context, call llm.ToolCall) (string, *Output, error) {
	if call.Name != prompts.ProposeProjectionToolName {
		return prompts.DiscoverRejected(prompts.DiscoverUnknownTool(call.Name)), nil, nil
	}
	var args proposeProjectionArgs
	if err := json.Unmarshal(call.Args, &args); err != nil {
		return prompts.DiscoverRejected(prompts.DiscoverBadArgs), nil, nil
	}
	args.Name = strings.TrimSpace(args.Name)
	args.Message = strings.TrimSpace(args.Message)
	if args.Name == "" || args.Message == "" {
		return prompts.DiscoverRejected(prompts.DiscoverNameAndMessageRequired), nil, nil
	}
	colourIDs, reject := c.resolveColours(args.ColourIDs)
	if reject != "" {
		return prompts.DiscoverRejected(reject), nil, nil
	}
	for _, id := range colourIDs {
		if c.ubiquitousColour(id) {
			return prompts.DiscoverRejected(prompts.DiscoverUbiquitousColour(c.colourByRef(id).Name, id)), nil, nil
		}
	}
	sourceIDs := pbutil.Union(nil, args.SourceProjectionIDs)
	for _, id := range sourceIDs {
		if _, err := projections.FindLive(c.App, id); err != nil {
			return prompts.DiscoverRejected(prompts.DiscoverNoRecord("projection", id)), nil, nil
		}
	}
	if len(colourIDs)+len(sourceIDs) == 0 {
		return prompts.DiscoverRejected(prompts.DiscoverScopeRequired), nil, nil
	}
	spec := api.ContextSpec{
		ColourIDs:           colourIDs,
		SourceProjectionIDs: sourceIDs,
	}
	rec, err := insertProposed(c, "projection", args.Name, args.Message, spec, nil)
	if err != nil {
		return "", nil, err
	}
	members := c.fragmentIDsForColours(colourIDs)
	c.markCovered(members)
	out := &Output{Kind: "projection", ID: rec.Id, Name: args.Name, Status: engine.EntityProposed}
	return prompts.DiscoverProposed("projection", args.Name, rec.Id, len(members)), out, nil
}

// insertProposed writes a proposed row; `extra` carries any collection-specific
// fields (a reflection's schedule).
func insertProposed(c *Context, col, name, message string, spec api.ContextSpec, extra map[string]any) (*core.Record, error) {
	collection, err := c.App.FindCollectionByNameOrId(col)
	if err != nil {
		return nil, err
	}
	rec := core.NewRecord(collection)
	rec.Set("name", name)
	rec.Set("status", engine.EntityProposed)
	rec.Set("description", message)
	rec.Set("current_context_spec", pbutil.JSONObject(spec))
	rec.Set("created_by_discover_run_id", c.Run.Id)
	for k, v := range extra {
		rec.Set(k, v)
	}
	if err := c.App.Save(rec); err != nil {
		return nil, err
	}
	return rec, nil
}
