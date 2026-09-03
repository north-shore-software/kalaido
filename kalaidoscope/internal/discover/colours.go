package discover

import (
	"context"
	"encoding/json"
	"strconv"
	"strings"

	"github.com/pocketbase/pocketbase/core"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/colour"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/mapping"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/prompts"
	"github.com/north-shore-software/kalaido/kalaidoscope/llm"
)

// coloursFlow creates colours for real, each built on map things; membership
// is the mechanical citation set, kept current by the colour package every
// time the map settles. It runs before projections so their scopes can name
// colours.
type coloursFlow struct{}

func (coloursFlow) Kind() string   { return "colours" }
func (coloursFlow) System() string { return prompts.DiscoverColoursSystem }

func (coloursFlow) Initial(c *Context) string {
	return prompts.DiscoverColoursInitial(c.Doc, worklistFloor)
}

var createColourTool = llm.Tool{
	Name:        prompts.CreateColourToolName,
	Description: prompts.CreateColourToolDescription,
	Parameters: json.RawMessage(`{"type":"object","properties":{` +
		`"name":{"type":"string","description":` + strconv.Quote(prompts.CreateColourNameParamDescription) + `},` +
		`"thingIds":` + stringArray(prompts.CreateColourThingIDsParamDescription) +
		`},"required":["name","thingIds"]}`),
}

func (coloursFlow) Tools(c *Context) []llm.Tool {
	return []llm.Tool{createColourTool}
}

func (coloursFlow) Existing(c *Context) ([]Existing, error) {
	return existingEntities(c)
}

func (coloursFlow) Coverage(c *Context, existing []Existing) string {
	return c.coverage(existing)
}

type createColourArgs struct {
	Name     string   `json:"name"`
	ThingIDs []string `json:"thingIds"`
}

func (f coloursFlow) Dispatch(ctx context.Context, c *Context, call llm.ToolCall) (string, *Output, error) {
	if call.Name != prompts.CreateColourToolName {
		return prompts.DiscoverRejected(prompts.DiscoverUnknownTool(call.Name)), nil, nil
	}
	var args createColourArgs
	if err := json.Unmarshal(call.Args, &args); err != nil {
		return prompts.DiscoverRejected(prompts.DiscoverBadArgs), nil, nil
	}
	args.Name = strings.TrimSpace(args.Name)
	if args.Name == "" {
		return prompts.DiscoverRejected(prompts.DiscoverColourNameRequired), nil, nil
	}
	if len(args.ThingIDs) == 0 {
		return prompts.DiscoverRejected(prompts.DiscoverColourThingsRequired), nil, nil
	}
	// Resolve to canonical ids: the model may pass a name, and the stored
	// list must survive the map renaming things.
	ids := make([]string, 0, len(args.ThingIDs))
	seen := map[string]bool{}
	for _, ref := range args.ThingIDs {
		t := mapping.ResolveRef(c.Doc, ref)
		if t == nil {
			return prompts.DiscoverRejected(prompts.DiscoverNoThing(ref)), nil, nil
		}
		if c.ubiquitous(t.ID) {
			return prompts.DiscoverRejected(prompts.DiscoverUbiquitousThing(t.Name, t.ID)), nil, nil
		}
		if !seen[t.ID] {
			seen[t.ID] = true
			ids = append(ids, t.ID)
		}
	}

	col, err := c.App.FindCollectionByNameOrId("colour")
	if err != nil {
		return "", nil, err
	}
	rec := core.NewRecord(col)
	rec.Set("name", args.Name)
	raw, _ := json.Marshal(ids)
	rec.Set("thing_ids", json.RawMessage(raw))
	if c.Run != nil {
		rec.Set("origin_run_id", c.Run.Id)
	}
	if err := c.App.Save(rec); err != nil {
		return "", nil, err
	}
	if err := colour.RematchThingsFor(c.App, rec.Id); err != nil {
		return "", nil, err
	}
	members, err := colour.MemberIDs(c.App, rec.Id)
	if err != nil {
		return "", nil, err
	}
	c.markCovered(members)
	out := &Output{Kind: "colour", ID: rec.Id, Name: args.Name}
	return prompts.DiscoverCreatedColour(args.Name, rec.Id, len(members)), out, nil
}
