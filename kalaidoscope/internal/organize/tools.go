package organize

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"strconv"
	"sync"
	"time"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/api"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/engine"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/llmcontext"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/prompts"
	"github.com/north-shore-software/kalaido/kalaidoscope/llm"
)

var nodeRefSchema = `{
	"type": "object",
	"properties": {
		"dimension": {"type": "string"},
		"name": {"type": "string"}
	},
	"required": ["dimension", "name"]
}`

var expandFragmentTool = llm.Tool{
	// Reuses the map incorporation tool's exact name/description — same
	// concept (budgeted full-text read), same convention (one id per call).
	Name:        prompts.ExpandFragmentToolName,
	Description: prompts.ExpandFragmentToolDescription,
	Parameters: json.RawMessage(`{
		"type": "object",
		"properties": {
			"id": {
				"type": "string",
				"description": ` + strconv.Quote(prompts.ExpandFragmentParamDescription) + `
			}
		},
		"required": ["id"]
	}`),
}

const (
	createProjectionToolName = "create_projection"
	createReflectionToolName = "create_reflection"
	recurseToolName          = "recurse"
	listExistingToolName     = "list_existing"
)

var listExistingTool = llm.Tool{
	Name:        listExistingToolName,
	Description: prompts.OrganizeListExistingToolDescription,
	Parameters:  json.RawMessage(`{"type": "object", "properties": {}}`),
}

var createProjectionTool = llm.Tool{
	Name:        createProjectionToolName,
	Description: prompts.OrganizeCreateProjectionToolDescription,
	Parameters: json.RawMessage(`{
		"type": "object",
		"properties": {
			"name": {"type": "string"},
			"brief": {"type": "string"},
			"wholeScope": {"type": "boolean"},
			"nodes": {"type": "array", "items": ` + nodeRefSchema + `}
		},
		"required": ["name", "brief"]
	}`),
}

var createReflectionTool = llm.Tool{
	Name:        createReflectionToolName,
	Description: prompts.OrganizeCreateReflectionToolDescription,
	Parameters: json.RawMessage(`{
		"type": "object",
		"properties": {
			"name": {"type": "string"},
			"brief": {"type": "string"},
			"wholeScope": {"type": "boolean"},
			"nodes": {"type": "array", "items": ` + nodeRefSchema + `},
			"windowSpec": {
				"type": "object",
				"properties": {
					"mode": {"type": "string"},
					"startTime": {"type": "string"},
					"endTime": {"type": "string"},
					"period": {"type": "string"},
					"duration": {"type": "string"}
				}
			}
		},
		"required": ["name", "brief"]
	}`),
}

var recurseTool = llm.Tool{
	Name:        recurseToolName,
	Description: prompts.OrganizeRecurseToolDescription,
	Parameters: json.RawMessage(`{
		"type": "object",
		"properties": {
			"children": {
				"type": "array",
				"items": {
					"type": "object",
					"properties": {
						"brief": {"type": "string"},
						"contextNodes": {"type": "array", "items": ` + nodeRefSchema + `}
					},
					"required": ["brief", "contextNodes"]
				}
			}
		},
		"required": ["children"]
	}`),
}

func dispatchTool(ctx context.Context, app core.App, run *core.Record, mapBody, model string,
	idx *organizeIndexes, annIdx map[NodeRef][]string, assignment scopeAssignment,
	expansions *int, depth int, budget *sharedBudget, registry *runRegistry,
	wg *sync.WaitGroup, mu *sync.Mutex, c llm.ToolCall) string {
	switch c.Name {
	case prompts.ExpandFragmentToolName:
		return dispatchExpandFragment(ctx, app, idx, expansions, c)
	case listExistingToolName:
		return listExisting(app, run, registry)
	case createProjectionToolName:
		return dispatchCreate(app, run, model, idx, annIdx, false, assignment, registry, mu, wg, c)
	case createReflectionToolName:
		return dispatchCreate(app, run, model, idx, annIdx, true, assignment, registry, mu, wg, c)
	case recurseToolName:
		return dispatchRecurse(ctx, app, run, mapBody, model, idx, annIdx, depth, budget, registry, wg, mu, c)
	default:
		return fmt.Sprintf("Unknown tool %q.", c.Name)
	}
}

func dispatchExpandFragment(ctx context.Context, app core.App, idx *organizeIndexes, expansions *int, c llm.ToolCall) string {
	var args struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(c.Args, &args); err != nil || args.ID == "" {
		return "Invalid expand_fragment call: missing id."
	}
	if !idx.exemplarIDs[args.ID] {
		return fmt.Sprintf("Rejected: %q is not a listed exemplar fragment in the map.", args.ID)
	}
	if *expansions >= maxExpansionsPerLevel {
		return prompts.OrganizeExpandBudgetExhausted
	}
	*expansions++
	recs := llmcontext.LoadFragmentsByIDs(ctx, app, []string{args.ID})
	block := llmcontext.RenderFragmentRecords(recs)
	if block == "" {
		return prompts.MapExpandNotFound
	}
	return "Full text:\n\n" + block
}

type createArgs struct {
	Name       string          `json:"name"`
	Brief      string          `json:"brief"`
	WholeScope bool            `json:"wholeScope"`
	Nodes      []NodeRef       `json:"nodes"`
	WindowSpec *api.WindowSpec `json:"windowSpec"`
}

func dispatchCreate(app core.App, run *core.Record, model string, idx *organizeIndexes, annIdx map[NodeRef][]string,
	isReflection bool, assignment scopeAssignment, registry *runRegistry, mu *sync.Mutex, wg *sync.WaitGroup, c llm.ToolCall) string {
	var args createArgs
	if err := json.Unmarshal(c.Args, &args); err != nil {
		return "Invalid call: could not parse arguments."
	}
	if args.Name == "" || args.Brief == "" {
		return "Rejected: name and brief are required."
	}
	if args.WholeScope && !assignment.unconfined {
		return prompts.OrganizeWholeScopeRejected
	}
	if !args.WholeScope {
		if bad := validateNodes(idx, args.Nodes); len(bad) > 0 {
			return fmt.Sprintf("Rejected: these nodes don't exist in the current map: %s", formatNodeRefs(bad))
		}
		if len(args.Nodes) == 0 {
			return "Rejected: provide at least one node, or set wholeScope (root only)."
		}
	}

	spec, err := materialiseSpec(app, run, idx, annIdx, args.Nodes, args.WholeScope)
	if err != nil {
		log.Printf("organize: materialise: %v", err)
		return fmt.Sprintf("Internal error creating entity: %v", err)
	}

	targetCol := "projection"
	var strat engine.Strategy = engine.ProjectionStrategy{}
	if isReflection {
		targetCol = "reflection"
		strat = engine.ReflectionStrategy{}
	}

	entityCol, err := app.FindCollectionByNameOrId(targetCol)
	if err != nil {
		return fmt.Sprintf("Internal error: %v", err)
	}
	entity := core.NewRecord(entityCol)
	entity.Set("name", args.Name)
	entity.Set("brief", args.Brief)
	setJSON(entity, "current_context_spec", spec)
	entity.Set("origin_run_id", run.Id)

	var winSpec api.WindowSpec
	if isReflection && args.WindowSpec != nil {
		winSpec = *args.WindowSpec
		versions := engine.AppendWindowSpecVersion(nil, winSpec, time.Now())
		setJSON(entity, "window_spec_versions", versions)
	}

	if err := app.Save(entity); err != nil {
		return fmt.Sprintf("Internal error saving entity: %v", err)
	}

	entryType := "projection"
	if isReflection {
		entryType = "reflection"
	}
	entry := entityEntry{
		Type: entryType, ID: entity.Id, Name: args.Name, Brief: args.Brief,
		WholeScope: args.WholeScope, Nodes: args.Nodes, GenerationStatus: "pending",
	}
	if !assignment.unconfined {
		entry.CreatedByAssignment = &struct {
			Brief        string    `json:"brief,omitempty"`
			ContextNodes []NodeRef `json:"contextNodes,omitempty"`
		}{Brief: assignment.brief, ContextNodes: assignment.contextNodes}
	}
	appendEntity(app, run, mu, entry)
	registry.registerCreated(entryType, args.Name, args.Brief, args.Nodes)

	wg.Add(1)
	go generateAndPublish(context.Background(), app, run, mu, wg, entity.Id, args.Brief, spec, winSpec, strat, targetCol)

	return fmt.Sprintf("Created %s %q (id: %s); content generation queued.", entryType, args.Name, entity.Id)
}

// materialiseSpec resolves (or mechanically creates) the colours backing a
// create_projection/create_reflection call and returns the ContextSpec to
// generate its content from. No LLM calls — colours are 1:1 derived from map
// nodes, and their fragment membership comes from the annotation index.
func materialiseSpec(app core.App, run *core.Record, idx *organizeIndexes, annIdx map[NodeRef][]string,
	nodes []NodeRef, wholeScope bool) (api.ContextSpec, error) {
	if wholeScope {
		return api.ContextSpec{WholeScope: true}, nil
	}
	var colourIDs []string
	for _, n := range nodes {
		colID, err := resolveOrCreateColour(app, run, idx, n, annIdx[n])
		if err != nil {
			return api.ContextSpec{}, err
		}
		colourIDs = append(colourIDs, colID)
	}
	return api.ContextSpec{ColourIDs: colourIDs}, nil
}

func resolveOrCreateColour(app core.App, run *core.Record, idx *organizeIndexes, node NodeRef, fragmentIDs []string) (string, error) {
	existing, err := app.FindRecordsByFilter("colour",
		"origin_node_dimension = {:d} && origin_node_name = {:n}", "", 1, 0,
		dbx.Params{"d": node.Dimension, "n": node.Name})
	if err != nil {
		return "", err
	}
	if len(existing) > 0 {
		colourID := existing[0].Id
		if err := linkColourFragments(app, colourID, fragmentIDs); err != nil {
			return "", err
		}
		return colourID, nil
	}

	col, err := app.FindCollectionByNameOrId("colour")
	if err != nil {
		return "", err
	}
	rec := core.NewRecord(col)
	rec.Set("name", node.Name)
	rec.Set("criteria", idx.nodeDescription[node])
	rec.Set("origin_run_id", run.Id)
	rec.Set("origin_node_dimension", node.Dimension)
	rec.Set("origin_node_name", node.Name)
	if err := app.Save(rec); err != nil {
		return "", err
	}
	if err := linkColourFragments(app, rec.Id, fragmentIDs); err != nil {
		return "", err
	}
	return rec.Id, nil
}

// linkColourFragments is additive-only: it inserts colour_fragment rows only
// for fragments not already linked, matching "existing colours: only missing
// links added."
func linkColourFragments(app core.App, colourID string, fragmentIDs []string) error {
	if len(fragmentIDs) == 0 {
		return nil
	}
	cfCol, err := app.FindCollectionByNameOrId("colour_fragment")
	if err != nil {
		return err
	}
	existing, err := app.FindRecordsByFilter("colour_fragment", "colour_id = {:c}", "", 0, 0, dbx.Params{"c": colourID})
	if err != nil {
		return err
	}
	have := make(map[string]bool, len(existing))
	for _, r := range existing {
		have[r.GetString("fragment_id")] = true
	}
	for _, fragID := range fragmentIDs {
		if have[fragID] {
			continue
		}
		cf := core.NewRecord(cfCol)
		cf.Set("colour_id", colourID)
		cf.Set("fragment_id", fragID)
		cf.Set("match_type", "map_derived")
		if err := app.Save(cf); err != nil {
			return err
		}
		have[fragID] = true
	}
	return nil
}

func dispatchRecurse(ctx context.Context, app core.App, run *core.Record, mapBody, model string,
	idx *organizeIndexes, annIdx map[NodeRef][]string, depth int,
	budget *sharedBudget, registry *runRegistry, wg *sync.WaitGroup, mu *sync.Mutex, c llm.ToolCall) string {
	var args struct {
		Children []struct {
			Brief        string    `json:"brief"`
			ContextNodes []NodeRef `json:"contextNodes"`
		} `json:"children"`
	}
	if err := json.Unmarshal(c.Args, &args); err != nil {
		return "Invalid recurse call: could not parse arguments."
	}

	var results []string
	for _, child := range args.Children {
		if child.Brief == "" || len(child.ContextNodes) == 0 {
			results = append(results, "Rejected one fork: brief and contextNodes are both required.")
			continue
		}
		if bad := validateNodes(idx, child.ContextNodes); len(bad) > 0 {
			results = append(results, fmt.Sprintf("Rejected fork %q: these nodes don't exist: %s", child.Brief, formatNodeRefs(bad)))
			continue
		}
		// Reserve budget first, then register the fork; if registration is
		// rejected, give the reserved slot back. This keeps a rejected fork
		// from either wasting budget or leaving a phantom registry entry.
		if !budget.tryReserve() {
			results = append(results, fmt.Sprintf("Rejected fork %q: exploration budget exhausted for this run.", child.Brief))
			continue
		}
		ok, collidesWith := registry.tryRegisterFork(child.Brief, child.ContextNodes)
		if !ok {
			budget.release()
			results = append(results, prompts.OrganizeForkIdenticalSetRejected(child.Brief, collidesWith.brief))
			continue
		}
		incrementExplorations(app, run, mu)
		childAssignment := scopeAssignment{brief: child.Brief, contextNodes: child.ContextNodes}
		wg.Add(1)
		go exploreNode(ctx, app, run, mapBody, model, idx, annIdx, childAssignment, depth+1, budget, registry, wg, mu)
		results = append(results, fmt.Sprintf("Forked: %q over %s", child.Brief, formatNodeRefs(child.ContextNodes)))
	}
	return joinResults(results)
}

func joinResults(results []string) string {
	out := ""
	for i, r := range results {
		if i > 0 {
			out += "\n"
		}
		out += r
	}
	return out
}

// generateAndPublish is dispatched from a create_* tool call and never
// awaited by the exploration loop — this is the actual parallelism: multiple
// entities' content generation overlaps instead of serializing behind
// exploration. It uses the same primitives the refinement-chat flow does
// (GenerateOutput + CommitRefinement), using the entity's own brief as the
// generation instruction in place of a distilled lens (there is none yet for
// a freshly created entity).
func generateAndPublish(ctx context.Context, app core.App, run *core.Record, mu *sync.Mutex, wg *sync.WaitGroup,
	entityID, brief string, spec api.ContextSpec, winSpec api.WindowSpec, strat engine.Strategy, targetCol string) {
	defer wg.Done()

	pinned, err := llmcontext.ResolveSpecToIDs(ctx, app, spec)
	if err != nil {
		updateEntityStatus(app, run, mu, entityID, "error", err.Error())
		return
	}
	sourceBlock, err := llmcontext.HydrateIDsToText(ctx, app, pinned)
	if err != nil {
		updateEntityStatus(app, run, mu, entityID, "error", err.Error())
		return
	}

	model, err := llm.ResolveRole(llm.RoleSnapshot)
	if err != nil {
		updateEntityStatus(app, run, mu, entityID, "error", err.Error())
		return
	}

	var output string
	err = retryPreempted(func() error {
		var genErr error
		output, genErr = engine.GenerateOutput(ctx, app, model, brief, sourceBlock)
		return genErr
	})
	if err != nil {
		updateEntityStatus(app, run, mu, entityID, "error", err.Error())
		return
	}

	if _, err := engine.CommitRefinement(ctx, app, strat, entityID, "", output, true, pinned, spec, winSpec, "", targetCol); err != nil {
		updateEntityStatus(app, run, mu, entityID, "error", err.Error())
		return
	}

	updateEntityStatus(app, run, mu, entityID, "done", "")
}
