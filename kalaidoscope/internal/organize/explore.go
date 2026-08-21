package organize

import (
	"context"
	"log"
	"strings"
	"sync"

	"github.com/pocketbase/pocketbase/core"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/pbutil"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/prompts"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/usage"
	"github.com/north-shore-software/kalaido/kalaidoscope/llm"
)

func setJSON(rec *core.Record, field string, v any) {
	rec.Set(field, pbutil.JSONObject(v))
}

// scopeAssignment is either unconfined (root only) or a fork's brief +
// context-node set. There is no tree anchor: a fork isn't "this node and its
// descendants," it's whatever set of nodes the parent decided belong
// together under a given framing, which may span unrelated branches of the
// map — the cross-cutting narratives worth surfacing often aren't subtrees.
type scopeAssignment struct {
	unconfined   bool
	brief        string
	contextNodes []NodeRef
	forkID       int // registry id of this fork; 0 for root
}

// exploreNode is called once at root (unconfined, depth 0, directly from
// drain) and recursively for every fork the recurse tool accepts. Every call
// — root or forked — gets the whole map body. The search is narrative-driven:
// the model reads the map's journal, sketches candidate stories, checks them
// against list_existing (persisted entities + this run's claims), and only
// recurses on stories nobody has taken. Node existence checks and the
// identical-set guard in runRegistry are the only mechanical nets; sharing
// map ground between forks is expected.
func exploreNode(ctx context.Context, app core.App, run *core.Record, mapBody, model string,
	idx *organizeIndexes, annIdx map[NodeRef][]string, assignment scopeAssignment, depth int,
	budget *sharedBudget, registry *runRegistry, wg *sync.WaitGroup, mu *sync.Mutex) {
	defer wg.Done()

	tools := []llm.Tool{listExistingTool, expandFragmentTool, createProjectionTool, createReflectionTool}
	if depth < maxOrganizeDepth && budget.remaining() {
		tools = append(tools, recurseTool)
	}

	msgs := []llm.Message{
		{Role: "system", Content: prompts.OrganizeSystem},
		{Role: "user", Content: organizeInitialPrompt(mapBody, assignment, existingColoursSummary(app))},
	}

	expansions := 0
	for round := 0; round < maxRoundsPerLevel; round++ {
		var reply string
		var calls []llm.ToolCall
		err := retryPreempted(func() error {
			var genErr error
			reply, calls, genErr = usage.GenerateWithToolCalls(ctx, app, msgs, llm.RoleMap, model, tools)
			return genErr
		})
		if err != nil {
			recordRunError(app, run, mu, err)
			return
		}
		msgs = append(msgs, llm.Message{Role: "assistant", Content: reply + echoToolCalls(calls)})
		if len(calls) == 0 {
			break
		}

		var results []string
		for _, c := range calls {
			results = append(results, dispatchTool(ctx, app, run, mapBody, model, idx, annIdx,
				assignment, &expansions, depth, budget, registry, wg, mu, c))
		}
		msgs = append(msgs, llm.Message{Role: "user", Content: strings.Join(results, "\n\n")})
	}
}

func echoToolCalls(calls []llm.ToolCall) string {
	if len(calls) == 0 {
		return ""
	}
	var names []string
	for _, c := range calls {
		names = append(names, c.Name)
	}
	return "\n\n[You called: " + strings.Join(names, ", ") + "]"
}

func organizeInitialPrompt(mapBody string, assignment scopeAssignment, existingColours string) string {
	if assignment.unconfined {
		return prompts.OrganizeInitial(mapBody, true, "", "", existingColours)
	}
	var parts []string
	for _, n := range assignment.contextNodes {
		parts = append(parts, n.Dimension+": "+n.Name)
	}
	return prompts.OrganizeInitial(mapBody, false, assignment.brief, strings.Join(parts, "; "), existingColours)
}

func formatNodeRefs(nodes []NodeRef) string {
	var parts []string
	for _, n := range nodes {
		parts = append(parts, n.Dimension+": "+n.Name)
	}
	return strings.Join(parts, "; ")
}

func validateNodes(idx *organizeIndexes, nodes []NodeRef) (bad []NodeRef) {
	for _, n := range nodes {
		if !idx.nodeExists[n] {
			bad = append(bad, n)
		}
	}
	return bad
}

// existingColoursSummary lists nodes that already have a colour from a prior
// organize run, so a fresh run can hint the model away from redundant
// re-proposals. Soft/efficiency-only — the real dedup safety net is
// resolveOrCreateColour's origin_node lookup.
func existingColoursSummary(app core.App) string {
	recs, err := app.FindRecordsByFilter("colour", "origin_node_name != ''", "", 0, 0, nil)
	if err != nil || len(recs) == 0 {
		return ""
	}
	var parts []string
	for _, r := range recs {
		if name := r.GetString("origin_node_name"); name != "" {
			parts = append(parts, r.GetString("origin_node_dimension")+": "+name)
		}
	}
	return strings.Join(parts, "; ")
}

// --- organize_run mutation helpers, all mutex-guarded: every goroutine
// touching the shared *core.Record serializes through the same lock so
// concurrent Set+Save calls can't lose each other's updates. ---

type entityEntry struct {
	Type                string    `json:"type"`
	ID                  string    `json:"id"`
	Name                string    `json:"name"`
	Brief               string    `json:"brief"`
	LensID              string    `json:"lensId,omitempty"`
	WholeScope          bool      `json:"wholeScope"`
	Nodes               []NodeRef `json:"nodes,omitempty"`
	SourceProjections   []string  `json:"sourceProjections,omitempty"`
	SourceReflections   []string  `json:"sourceReflections,omitempty"`
	CreatedByAssignment *struct {
		Brief        string    `json:"brief,omitempty"`
		ContextNodes []NodeRef `json:"contextNodes,omitempty"`
	} `json:"createdByAssignment,omitempty"`
	GenerationStatus string `json:"generationStatus"`
	GenerationError  string `json:"generationError,omitempty"`
}

func appendEntity(app core.App, run *core.Record, mu *sync.Mutex, e entityEntry) {
	mu.Lock()
	defer mu.Unlock()
	var entities []entityEntry
	_ = run.UnmarshalJSONField("entities", &entities)
	entities = append(entities, e)
	setJSON(run, "entities", entities)
	if err := app.Save(run); err != nil {
		log.Printf("organize: save run: %v", err)
	}
}

func updateEntityStatus(app core.App, run *core.Record, mu *sync.Mutex, entityID, status, genErr string) {
	mu.Lock()
	defer mu.Unlock()
	var entities []entityEntry
	_ = run.UnmarshalJSONField("entities", &entities)
	for i := range entities {
		if entities[i].ID == entityID {
			entities[i].GenerationStatus = status
			entities[i].GenerationError = genErr
		}
	}
	setJSON(run, "entities", entities)
	if err := app.Save(run); err != nil {
		log.Printf("organize: save run: %v", err)
	}
}

func appendWarning(app core.App, run *core.Record, mu *sync.Mutex, warning string) {
	mu.Lock()
	defer mu.Unlock()
	var warnings []string
	_ = run.UnmarshalJSONField("warnings", &warnings)
	warnings = append(warnings, warning)
	setJSON(run, "warnings", warnings)
	if err := app.Save(run); err != nil {
		log.Printf("organize: save run: %v", err)
	}
}

func incrementExplorations(app core.App, run *core.Record, mu *sync.Mutex) {
	mu.Lock()
	defer mu.Unlock()
	run.Set("explorations", run.GetInt("explorations")+1)
	if err := app.Save(run); err != nil {
		log.Printf("organize: save run: %v", err)
	}
}

func recordRunError(app core.App, run *core.Record, mu *sync.Mutex, err error) {
	mu.Lock()
	defer mu.Unlock()
	run.Set("status", "error")
	run.Set("error", err.Error())
	if serr := app.Save(run); serr != nil {
		log.Printf("organize: save run: %v", serr)
	}
}
