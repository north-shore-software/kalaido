package discover

import (
	"github.com/pocketbase/pocketbase/core"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/mapdoc"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/mapping"
)

type Context struct {
	App     core.App
	Run     *core.Record
	Doc     *mapdoc.Document
	Version int
	Rows    []mapping.Row
	ByThing map[string][]int

	reads   int
	rounds  int
	outputs []Output
	covered map[string]bool
}

type Existing struct {
	Kind        string
	ID          string
	Name        string
	Description string
	Note        string
	FragmentIDs []string
}

type Output struct {
	Kind   string `json:"kind"`
	ID     string `json:"id"`
	Name   string `json:"name"`
	Status string `json:"status,omitempty"`
}

func newContext(app core.App, run *core.Record) (*Context, error) {
	doc, version, err := mapping.LoadDocument(app)
	if err != nil {
		return nil, err
	}
	rows, err := mapping.LoadRows(app)
	if err != nil {
		return nil, err
	}
	return &Context{
		App:     app,
		Run:     run,
		Doc:     doc,
		Version: version,
		Rows:    rows,
		ByThing: mapping.IndexRows(doc, rows),
		covered: map[string]bool{},
	}, nil
}

func (c *Context) fragmentIDsForThings(ids []string) []string {
	seen := map[string]bool{}
	var out []string
	for _, id := range ids {
		t := mapping.ResolveRef(c.Doc, id)
		if t == nil {
			continue
		}
		for _, i := range c.ByThing[t.ID] {
			fid := c.Rows[i].FragmentID
			if seen[fid] {
				continue
			}
			seen[fid] = true
			out = append(out, fid)
		}
	}
	return out
}

func (c *Context) markCovered(ids []string) {
	for _, id := range ids {
		c.covered[id] = true
	}
}
