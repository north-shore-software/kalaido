package discover

import (
	"context"
	"encoding/json"
	"strconv"
	"strings"

	"github.com/pocketbase/pocketbase/core"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/api"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/engine"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/llmcontext"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/mapping"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/pbutil"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/prompts"
	"github.com/north-shore-software/kalaido/kalaidoscope/llm"
)

const worklistFloor = 5

type projectionsFlow struct{}

func (projectionsFlow) Kind() string   { return "projections" }
func (projectionsFlow) System() string { return prompts.DiscoverProjectionsSystem }

func (projectionsFlow) Initial(c *Context) string {
	return prompts.DiscoverProjectionsInitial(c.Doc, worklistFloor)
}

func stringArray(description string) string {
	return `{"type":"array","items":{"type":"string"},"description":` + strconv.Quote(description) + `}`
}

var proposeProjectionTool = llm.Tool{
	Name:        prompts.ProposeProjectionToolName,
	Description: prompts.ProposeProjectionToolDescription,
	Parameters: json.RawMessage(`{"type":"object","properties":{` +
		`"name":{"type":"string","description":` + strconv.Quote(prompts.ProposeNameParamDescription) + `},` +
		`"message":{"type":"string","description":` + strconv.Quote(prompts.ProposeMessageParamDescription) + `},` +
		`"thingIds":` + stringArray(prompts.ProposeThingIDsParamDescription) + `,` +
		`"fragmentIds":` + stringArray(prompts.ProposeFragmentIDsParamDescription) + `,` +
		`"colourIds":` + stringArray(prompts.ProposeColourIDsParamDescription) + `,` +
		`"sourceProjectionIds":` + stringArray(prompts.ProposeSourceProjectionIDsParamDescription) +
		`},"required":["name","message"]}`),
}

func (projectionsFlow) Tools(c *Context) []llm.Tool {
	return []llm.Tool{proposeProjectionTool}
}

func (projectionsFlow) Existing(c *Context) ([]Existing, error) {
	var out []Existing
	for _, col := range []string{"projection", "reflection"} {
		recs, err := c.App.FindRecordsByFilter(col, "1=1", "created", 0, 0, nil)
		if err != nil {
			return nil, err
		}
		for _, rec := range recs {
			var spec api.ContextSpec
			_ = rec.UnmarshalJSONField("current_context_spec", &spec)
			pinned, _ := llmcontext.ResolveSpecToIDs(context.Background(), c.App, spec, nil)
			note := ""
			if rec.GetString("status") == engine.EntityProposed {
				if c.Run != nil && rec.GetString("origin_run_id") == c.Run.Id {
					note = prompts.DiscoverNoteProposedThisRun
				} else {
					note = prompts.DiscoverNoteProposedEarlier
				}
			}
			out = append(out, Existing{
				Kind:        col,
				ID:          rec.Id,
				Name:        rec.GetString("name"),
				Description: rec.GetString("brief"),
				Note:        note,
				FragmentIDs: pinned.FragmentIDs,
			})
		}
	}
	return out, nil
}

type proposeProjectionArgs struct {
	Name                string   `json:"name"`
	Message             string   `json:"message"`
	ThingIDs            []string `json:"thingIds"`
	FragmentIDs         []string `json:"fragmentIds"`
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
	for _, id := range args.ThingIDs {
		if mapping.ResolveRef(c.Doc, id) == nil {
			return prompts.DiscoverRejected(prompts.DiscoverNoThing(id)), nil, nil
		}
	}
	for _, id := range args.FragmentIDs {
		if _, err := c.App.FindRecordById("fragment", id); err != nil {
			return prompts.DiscoverRejected(prompts.DiscoverNoFragment(id)), nil, nil
		}
	}
	for _, id := range args.ColourIDs {
		if _, err := c.App.FindRecordById("colour", id); err != nil {
			return prompts.DiscoverRejected(prompts.DiscoverNoRecord("colour", id)), nil, nil
		}
	}
	for _, id := range args.SourceProjectionIDs {
		if _, err := c.App.FindRecordById("projection", id); err != nil {
			return prompts.DiscoverRejected(prompts.DiscoverNoRecord("projection", id)), nil, nil
		}
	}
	fragmentIDs := union(c.fragmentIDsForThings(args.ThingIDs), args.FragmentIDs)
	if len(fragmentIDs)+len(args.ColourIDs)+len(args.SourceProjectionIDs) == 0 {
		return prompts.DiscoverRejected(prompts.DiscoverScopeRequired), nil, nil
	}
	spec := api.ContextSpec{
		FragmentIDs:         fragmentIDs,
		ColourIDs:           args.ColourIDs,
		SourceProjectionIDs: args.SourceProjectionIDs,
	}
	rec, err := insertProposed(c, "projection", args.Name, args.Message, spec)
	if err != nil {
		return "", nil, err
	}
	c.markCovered(fragmentIDs)
	out := &Output{Kind: "projection", ID: rec.Id, Name: args.Name, Status: engine.EntityProposed}
	return prompts.DiscoverProposed("projection", args.Name, rec.Id, len(fragmentIDs)), out, nil
}

func insertProposed(c *Context, col, name, message string, spec api.ContextSpec) (*core.Record, error) {
	collection, err := c.App.FindCollectionByNameOrId(col)
	if err != nil {
		return nil, err
	}
	rec := core.NewRecord(collection)
	rec.Set("name", name)
	rec.Set("status", engine.EntityProposed)
	rec.Set("brief", message)
	rec.Set("current_context_spec", pbutil.JSONObject(spec))
	rec.Set("origin_run_id", c.Run.Id)
	if err := c.App.Save(rec); err != nil {
		return nil, err
	}
	return rec, nil
}

func union(a, b []string) []string {
	seen := map[string]bool{}
	var out []string
	for _, id := range append(append([]string{}, a...), b...) {
		id = strings.TrimSpace(id)
		if id == "" || seen[id] {
			continue
		}
		seen[id] = true
		out = append(out, id)
	}
	return out
}
