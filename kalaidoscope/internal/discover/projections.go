package discover

import (
	"context"
	"encoding/json"
	"strconv"
	"strings"

	"github.com/pocketbase/pocketbase/core"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/api"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/colour"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/engine"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/llmcontext"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/mapping"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/pbutil"
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
	return `{"type":"array","items":{"type":"string"},"description":` + strconv.Quote(description) + `}`
}

var readColourTool = idsTool(prompts.ReadColourToolName, prompts.ReadColourToolDescription, prompts.ReadColourParamDescription)

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

// existingEntities lists every colour, projection and reflection, made by a
// person or by a run, with the fragments each holds. Every flow uses it: a
// proposal must not restate what is there, and projections scope by colour id.
func existingEntities(c *Context) ([]Existing, error) {
	var out []Existing
	colours, err := c.App.FindRecordsByFilter("colour", "1=1", "created", 0, 0, nil)
	if err != nil {
		return nil, err
	}
	for _, rec := range colours {
		members, err := colour.MemberIDs(c.App, rec.Id)
		if err != nil {
			return nil, err
		}
		var names []string
		for _, id := range colour.ThingIDs(rec) {
			if t := mapping.ResolveRef(c.Doc, id); t != nil {
				names = append(names, t.Name)
			}
		}
		out = append(out, Existing{
			Kind:        "colour",
			ID:          rec.Id,
			Name:        rec.GetString("name"),
			Description: prompts.DiscoverColourDescription(rec.GetString("prompt"), names),
			FragmentIDs: members,
		})
	}
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
	sourceIDs := union(nil, args.SourceProjectionIDs)
	for _, id := range sourceIDs {
		if _, err := c.App.FindRecordById("projection", id); err != nil {
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
	rec.Set("brief", message)
	rec.Set("current_context_spec", pbutil.JSONObject(spec))
	rec.Set("origin_run_id", c.Run.Id)
	for k, v := range extra {
		rec.Set(k, v)
	}
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
