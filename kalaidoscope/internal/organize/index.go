package organize

import (
	"encoding/json"
	"errors"

	"github.com/pocketbase/pocketbase/core"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/mapdoc"
)

// NodeRef addresses one map node the way markup already does: by dimension
// name plus the node's own name. The map has no other stable node
// identifier, so this is also exactly what fragment_annotation rows key on.
type NodeRef struct {
	Dimension string `json:"dimension"`
	Name      string `json:"name"`
}

// organizeIndexes is built once per run, before any exploration starts, and
// is read-only afterward — safe to share across every exploreNode goroutine
// without locking.
type organizeIndexes struct {
	nodeExists      map[NodeRef]bool
	nodeDescription map[NodeRef]string
	exemplarIDs     map[string]bool // fragment ID -> is a listed exemplar of some node
	// threadCount is observability only: how many cross-cutting items the
	// map carried when the run started, by list name.
	threadCount map[string]int
}

type mapNodeJSON struct {
	Name        string        `json:"name"`
	Description string        `json:"description"`
	ExemplarIDs []string      `json:"exemplar_ids"`
	Children    []mapNodeJSON `json:"children"`
}

type mapDimensionJSON struct {
	Name  string        `json:"name"`
	Nodes []mapNodeJSON `json:"nodes"`
}

// mapThreadJSON mirrors the map's Thread shape (prompts.MapSchemaDescription):
// one item on a cross-cutting list, grounded in tree nodes.
type mapThreadJSON struct {
	Title   string    `json:"title"`
	Summary string    `json:"summary"`
	From    string    `json:"from"`
	To      string    `json:"to"`
	Status  string    `json:"status"`
	Nodes   []NodeRef `json:"nodes"`
}

type mapBodyJSON struct {
	Dimensions []mapDimensionJSON `json:"dimensions"`
	Questions  []mapThreadJSON    `json:"questions"`
	Decisions  []mapThreadJSON    `json:"decisions"`
	Events     []mapThreadJSON    `json:"events"`
	Projects   []mapThreadJSON    `json:"projects"`
}

func buildMapIndexes(mapBody string) (*organizeIndexes, error) {
	var mb mapBodyJSON
	if err := json.Unmarshal([]byte(mapBody), &mb); err != nil {
		return nil, err
	}
	idx := &organizeIndexes{
		nodeExists:      make(map[NodeRef]bool),
		nodeDescription: make(map[NodeRef]string),
		exemplarIDs:     make(map[string]bool),
	}
	var walk func(dimension string, nodes []mapNodeJSON)
	walk = func(dimension string, nodes []mapNodeJSON) {
		for _, n := range nodes {
			ref := NodeRef{Dimension: dimension, Name: n.Name}
			idx.nodeExists[ref] = true
			idx.nodeDescription[ref] = n.Description
			for _, id := range n.ExemplarIDs {
				idx.exemplarIDs[id] = true
			}
			walk(dimension, n.Children)
		}
	}
	for _, d := range mb.Dimensions {
		walk(d.Name, d.Nodes)
	}
	idx.threadCount = map[string]int{
		"questions": len(mb.Questions), "decisions": len(mb.Decisions),
		"events": len(mb.Events), "projects": len(mb.Projects),
	}
	return idx, nil
}

// markupAnnotationJSON mirrors the markup reply shape
// (prompts.MapMarkupPrompt / prompts.ParseMarkupReply), which is exactly
// what's persisted into fragment_annotation.annotation.
type markupAnnotationJSON struct {
	Nodes []struct {
		Node      string `json:"node"`
		Dimension string `json:"dimension"`
	} `json:"nodes"`
}

// buildAnnotationIndex is the mechanical, no-LLM-calls source of colour
// membership: fragment_annotation already records, per fragment, which map
// nodes it was tagged against during incorporation. A map node's own
// "fragments" field is only a count and "exemplar_ids" is capped at 5 —
// neither can supply full membership.
func buildAnnotationIndex(app core.App) (map[NodeRef][]string, error) {
	recs, err := app.FindRecordsByFilter("fragment_annotation", "1=1", "", 0, 0, nil)
	if err != nil {
		return nil, err
	}
	index := make(map[NodeRef][]string)
	for _, r := range recs {
		var ann markupAnnotationJSON
		if err := r.UnmarshalJSONField("annotation", &ann); err != nil {
			continue
		}
		fragID := r.GetString("fragment_id")
		for _, n := range ann.Nodes {
			ref := NodeRef{Dimension: n.Dimension, Name: n.Node}
			index[ref] = append(index[ref], fragID)
		}
	}
	return index, nil
}

// loadFinishedMap returns the current map body and version. An empty body
// (with err == nil) means no map exists yet, or it's still at version 0
// (nothing incorporated) — organize has nothing to explore in either case.
func loadFinishedMap(app core.App) (body string, version int, err error) {
	recs, err := app.FindRecordsByFilter("kalaidoscope_map", "1=1", "", 1, 0, nil)
	if err != nil || len(recs) == 0 {
		return "", 0, err
	}
	rec := recs[0]
	v := rec.GetInt("version")
	if v == 0 {
		return "", 0, nil
	}
	var raw json.RawMessage
	if err := rec.UnmarshalJSONField("body", &raw); err != nil || len(raw) == 0 {
		return "", 0, nil
	}
	if _, v4 := mapdoc.Parse(string(raw)); v4 {
		return "", 0, errMapV4
	}
	return string(raw), v, nil
}

var errMapV4 = errors.New("map is a v4 things document; organize has not been reworked for it")
