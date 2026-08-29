package organize

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/api"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/engine"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/llmcontext"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/llmq"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/pbutil"
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
			"brief": {"type": "string", "description": ` + strconv.Quote(prompts.OrganizeBriefParamDescription) + `},
			"wholeScope": {"type": "boolean"},
			"nodes": {"type": "array", "items": ` + nodeRefSchema + `},
			"sourceProjections": {"type": "array", "items": {"type": "string"}, "description": ` + strconv.Quote(prompts.OrganizeSourceProjectionsParamDescription) + `},
			"sourceReflections": {"type": "array", "items": {"type": "string"}, "description": ` + strconv.Quote(prompts.OrganizeSourceReflectionsParamDescription) + `}
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
			"brief": {"type": "string", "description": ` + strconv.Quote(prompts.OrganizeBriefParamDescription) + `},
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
	Name              string          `json:"name"`
	Brief             string          `json:"brief"`
	WholeScope        bool            `json:"wholeScope"`
	Nodes             []NodeRef       `json:"nodes"`
	SourceProjections []string        `json:"sourceProjections"`
	SourceReflections []string        `json:"sourceReflections"`
	WindowSpec        *api.WindowSpec `json:"windowSpec"`
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
	if isReflection {
		// Reflections are fragments-only in the engine (ReflectionStrategy.EnsureFragmentsOnly).
		args.SourceProjections, args.SourceReflections = nil, nil
	}
	if !args.WholeScope {
		if bad := validateNodes(idx, args.Nodes); len(bad) > 0 {
			return fmt.Sprintf("Rejected: these nodes don't exist in the current map: %s", formatNodeRefs(bad))
		}
		if bad := validateSources(app, registry, "projection", args.SourceProjections); len(bad) > 0 {
			return fmt.Sprintf("Rejected: these sourceProjections don't exist: %s", strings.Join(bad, ", "))
		}
		if bad := validateSources(app, registry, "reflection", args.SourceReflections); len(bad) > 0 {
			return fmt.Sprintf("Rejected: these sourceReflections don't exist: %s", strings.Join(bad, ", "))
		}
		if len(args.Nodes)+len(args.SourceProjections)+len(args.SourceReflections) == 0 {
			return "Rejected: provide at least one node or source entity, or set wholeScope (root only)."
		}
	}

	spec, err := materialiseSpec(app, run, idx, annIdx, args.Nodes, args.WholeScope)
	if err != nil {
		log.Printf("organize: materialise: %v", err)
		return fmt.Sprintf("Internal error creating entity: %v", err)
	}
	spec.SourceProjectionIDs = args.SourceProjections
	spec.SourceReflectionIDs = args.SourceReflections

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

	if isReflection && args.WindowSpec != nil {
		versions := engine.AppendWindowSpecVersion(nil, *args.WindowSpec, time.Now())
		setJSON(entity, "window_spec_versions", versions)
	}

	if err := app.Save(entity); err != nil {
		return fmt.Sprintf("Internal error saving entity: %v", err)
	}

	// The brief is the lens: organize knows exactly what instruction produced
	// the entity, so there is nothing for a refinement to draft first.
	lensID, err := installLens(app, strat, entity, args.Brief, spec)
	if err != nil {
		return fmt.Sprintf("Internal error saving lens: %v", err)
	}

	entryType := "projection"
	if isReflection {
		entryType = "reflection"
	}
	entry := entityEntry{
		Type: entryType, ID: entity.Id, Name: args.Name, Brief: args.Brief, LensID: lensID,
		WholeScope: args.WholeScope, Nodes: args.Nodes,
		SourceProjections: args.SourceProjections, SourceReflections: args.SourceReflections,
		GenerationStatus: "pending",
	}
	if !assignment.unconfined {
		entry.CreatedByAssignment = &struct {
			Brief        string    `json:"brief,omitempty"`
			ContextNodes []NodeRef `json:"contextNodes,omitempty"`
		}{Brief: assignment.brief, ContextNodes: assignment.contextNodes}
	}
	appendEntity(app, run, mu, entry)
	done := registry.registerCreated(assignment.forkID, entryType, entity.Id, args.Name, args.Brief, args.Nodes)

	var waitOn []chan struct{}
	for _, id := range append(append([]string{}, args.SourceProjections...), args.SourceReflections...) {
		if ch := registry.createdDone(id); ch != nil {
			waitOn = append(waitOn, ch)
		}
	}

	wg.Add(1)
	go generateAndPublish(context.Background(), app, run, mu, wg, entity.Id, strat, waitOn, done)

	return fmt.Sprintf("Created %s %q (id: %s); content generation queued.", entryType, args.Name, entity.Id)
}

// validateSources checks that every referenced source entity exists, either
// persisted (any run, or human-created) or created earlier in this run.
func validateSources(app core.App, registry *runRegistry, col string, ids []string) (bad []string) {
	for _, id := range ids {
		if registry.createdDone(id) != nil {
			continue
		}
		if _, err := app.FindRecordById(col, id); err != nil {
			bad = append(bad, id)
		}
	}
	return bad
}

// installLens writes the entity's first lens directly from its brief and
// points the entity at it. Zero LLM calls: the brief is, by construction,
// the instruction that will generate the entity's content.
func installLens(app core.App, strat engine.Strategy, entity *core.Record, brief string, spec api.ContextSpec) (string, error) {
	col, err := app.FindCollectionByNameOrId(strat.LensCollectionName())
	if err != nil {
		return "", err
	}
	lens := core.NewRecord(col)
	lens.Set("prompt", pbutil.JSONString(brief))
	lens.Set("context_spec", pbutil.JSONObject(spec))
	if err := app.Save(lens); err != nil {
		return "", err
	}
	entity.Set("current_lens_id", lens.Id)
	if err := app.Save(entity); err != nil {
		return "", err
	}
	return lens.Id, nil
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

// dispatchRecurse forks each accepted child and then BLOCKS until every one
// of them has finished exploring, returning what they created. That is what
// lets the parent compose: it resumes its own conversation holding real
// entity ids it can pass as sourceProjections. Siblings still run in
// parallel with each other; only the parent idles, and an idle parent costs
// nothing (no model call is in flight while it waits).
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
	var children sync.WaitGroup
	var forked []int
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
		forkID, collidesWith := registry.tryRegisterFork(child.Brief, child.ContextNodes)
		if forkID == 0 {
			budget.release()
			results = append(results, prompts.OrganizeForkIdenticalSetRejected(child.Brief, collidesWith.brief))
			continue
		}
		incrementExplorations(app, run, mu)
		childAssignment := scopeAssignment{brief: child.Brief, contextNodes: child.ContextNodes, forkID: forkID}
		forked = append(forked, forkID)
		wg.Add(1)
		children.Add(1)
		go func() {
			defer children.Done()
			defer registry.finishFork(forkID)
			exploreNode(ctx, app, run, mapBody, model, idx, annIdx, childAssignment, depth+1, budget, registry, wg, mu)
		}()
	}
	children.Wait()

	for _, forkID := range forked {
		var lines []string
		for _, cl := range registry.createdBy(forkID) {
			lines = append(lines, prompts.OrganizeForkCreatedLine(cl.kind, cl.id, cl.name, cl.brief))
		}
		results = append(results, prompts.OrganizeForkResult(forkBrief(registry, forkID), lines))
	}
	return joinResults(results)
}

func forkBrief(registry *runRegistry, forkID int) string {
	for _, c := range registry.snapshot() {
		if c.forkID == forkID && c.status != "created" {
			return c.brief
		}
	}
	return ""
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

// generateAndPublish produces the entity's first approved snapshot through
// the ordinary lens path (engine.GenerateSnapshot) — the lens was installed
// at create time. It is never awaited by
// the exploration loop; content generation for many entities overlaps.
// When the entity takes other entities created in this run as sources, it
// first waits for their snapshots: the context resolver only sees approved
// snapshots, so generating earlier would silently drop the source.
func generateAndPublish(ctx context.Context, app core.App, run *core.Record, mu *sync.Mutex, wg *sync.WaitGroup,
	entityID string, strat engine.Strategy, waitOn []chan struct{}, done chan struct{}) {
	defer wg.Done()
	defer close(done)

	for _, ch := range waitOn {
		<-ch
	}

	// Organize is background work: never compete with a user's own
	// interactive generation for a scheduler slot.
	ctx = llmq.WithPriority(ctx, llmq.Background)

	var err error
	err = retryPreempted(func() error {
		_, genErr := engine.GenerateSnapshot(ctx, app, entityID, engine.StatusApproved, strat, nil)
		return genErr
	})
	if err != nil {
		updateEntityStatus(app, run, mu, entityID, "error", err.Error())
		return
	}
	updateEntityStatus(app, run, mu, entityID, "done", "")
}
