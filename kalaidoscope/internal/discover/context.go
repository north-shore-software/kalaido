package discover

import (
	"slices"
	"sort"
	"strings"

	"github.com/pocketbase/pocketbase/core"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/colour"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/mapping"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/prompts"
)

type Context struct {
	*Reader
	Run *core.Record

	// Colours is the workspace as colours, in created order, read from the
	// same snapshot as Rows; ByColour maps a colour id to the row indexes of
	// its members. Projections and reflections scope by colour, so this is
	// their worklist; the colours flow ignores it.
	Colours  []colourInfo
	ByColour map[string][]int

	rounds  int
	outputs []Output
	covered map[string]bool
}

// colourInfo is one colour as the run sees it: the things it is built on, its
// members (every fragment it holds, whatever matched it) and, for the ones
// with an annotation row, where they sit in Rows and the span they cover.
type colourInfo struct {
	ID, Name    string
	ThingIDs    []string
	ThingNames  []string
	Members     []string
	RowIdx      []int
	rowSet      map[int]bool
	First, Last string
}

// holds says whether the row is one of the colour's members.
func (info *colourInfo) holds(rowIdx int) bool { return info.rowSet[rowIdx] }

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
	r, err := NewReader(app, maxFragmentReads)
	if err != nil {
		return nil, err
	}
	c := &Context{Reader: r, Run: run, covered: map[string]bool{}}
	if err := c.loadColours(); err != nil {
		return nil, err
	}
	return c, nil
}

// loadColours indexes every colour's membership against the annotation rows.
func (c *Context) loadColours() error {
	recs, err := c.App.FindRecordsByFilter("colour", "1=1", "created", 0, 0, nil)
	if err != nil {
		return err
	}
	rowOf := make(map[string]int, len(c.Rows))
	for i, r := range c.Rows {
		rowOf[r.FragmentID] = i
	}
	c.Colours = nil
	c.ByColour = map[string][]int{}
	for _, rec := range recs {
		members, err := colour.MemberIDs(c.App, rec.Id)
		if err != nil {
			return err
		}
		info := colourInfo{ID: rec.Id, Name: rec.GetString("name"), Members: members, rowSet: map[int]bool{}}
		for _, id := range colour.ThingIDs(rec) {
			if t := mapping.ResolveRef(c.Doc, id); t != nil {
				info.ThingIDs = append(info.ThingIDs, t.ID)
				info.ThingNames = append(info.ThingNames, t.Name)
			}
		}
		for _, fid := range members {
			i, ok := rowOf[fid]
			if !ok {
				continue
			}
			info.RowIdx = append(info.RowIdx, i)
			info.rowSet[i] = true
		}
		sort.Ints(info.RowIdx)
		info.First, info.Last = c.span(info.RowIdx)
		c.Colours = append(c.Colours, info)
		c.ByColour[rec.Id] = info.RowIdx
	}
	return nil
}

// span is the earliest and latest dated row among the given indexes.
func (c *Context) span(idxs []int) (first, last string) {
	for _, i := range idxs {
		d := c.Rows[i].Date
		if len(d) < 10 {
			continue
		}
		d = d[:10]
		if first == "" || d < first {
			first = d
		}
		if d > last {
			last = d
		}
	}
	return first, last
}

// colourByRef resolves a colour by id or exact name (case-insensitive), the
// way mapping.ResolveRef does for things: the model may pass either.
func (c *Context) colourByRef(ref string) *colourInfo {
	ref = strings.TrimSpace(ref)
	if ref == "" {
		return nil
	}
	for i := range c.Colours {
		if c.Colours[i].ID == ref {
			return &c.Colours[i]
		}
	}
	for i := range c.Colours {
		if strings.EqualFold(c.Colours[i].Name, ref) {
			return &c.Colours[i]
		}
	}
	return nil
}

// resolveColours turns the model's colour refs into canonical ids, deduped,
// or the rejection text for the first one that is not a colour.
func (c *Context) resolveColours(refs []string) ([]string, string) {
	seen := map[string]bool{}
	var ids []string
	for _, ref := range refs {
		if strings.TrimSpace(ref) == "" {
			continue
		}
		info := c.colourByRef(ref)
		if info == nil {
			return nil, prompts.DiscoverNoRecord("colour", ref)
		}
		if !seen[info.ID] {
			seen[info.ID] = true
			ids = append(ids, info.ID)
		}
	}
	return ids, ""
}

// resolveThings turns the model's thing refs into canonical ids, deduped, or
// the rejection text for the first one that is not a thing.
func (c *Context) resolveThings(refs []string) ([]string, string) {
	seen := map[string]bool{}
	var ids []string
	for _, ref := range refs {
		if strings.TrimSpace(ref) == "" {
			continue
		}
		t := mapping.ResolveRef(c.Doc, ref)
		if t == nil {
			return nil, prompts.DiscoverNoThing(ref)
		}
		if !seen[t.ID] {
			seen[t.ID] = true
			ids = append(ids, t.ID)
		}
	}
	return ids, ""
}

// fragmentIDsForColours is the union of the colours' members: what a scope
// pinned to them resolves to today.
func (c *Context) fragmentIDsForColours(ids []string) []string {
	seen := map[string]bool{}
	var out []string
	for _, id := range ids {
		info := c.colourByRef(id)
		if info == nil {
			continue
		}
		for _, fid := range info.Members {
			if seen[fid] {
				continue
			}
			seen[fid] = true
			out = append(out, fid)
		}
	}
	return out
}

func (c *Context) coloursBlock() string {
	lines := make([]prompts.DiscoverColourLine, 0, len(c.Colours))
	for _, info := range c.Colours {
		lines = append(lines, prompts.DiscoverColourLine{
			ID: info.ID, Name: info.Name, ThingNames: info.ThingNames,
			Members: len(info.Members), First: info.First, Last: info.Last,
		})
	}
	return prompts.DiscoverColoursBlock(lines)
}

func (c *Context) markCovered(ids []string) {
	for _, id := range ids {
		c.covered[id] = true
	}
}

// cover is one colour's hold on a rhythm's rows: how many it has, and whether
// it is built on every thing the rhythm is about.
type cover struct {
	Colour  *colourInfo
	Covered int
	Exact   bool
}

// coversFor ranks the non-ubiquitous colours holding any of the given rows —
// exact carriers first, then by rows held — and counts the rows no colour
// holds at all. The rhythm cards show it; the model picks a scope from it.
func (c *Context) coversFor(rowIdxs []int, thingIDs []string) (covers []cover, uncovered int) {
	held := make([]bool, len(rowIdxs))
	for k := range c.Colours {
		info := &c.Colours[k]
		if c.ubiquitousColour(info.ID) {
			continue
		}
		cv := cover{Colour: info, Exact: len(thingIDs) > 0}
		for i, idx := range rowIdxs {
			if info.holds(idx) {
				cv.Covered++
				held[i] = true
			}
		}
		for _, id := range thingIDs {
			if !slices.Contains(info.ThingIDs, id) {
				cv.Exact = false
			}
		}
		if cv.Covered > 0 {
			covers = append(covers, cv)
		}
	}
	sort.SliceStable(covers, func(i, j int) bool {
		if covers[i].Exact != covers[j].Exact {
			return covers[i].Exact
		}
		if covers[i].Covered != covers[j].Covered {
			return covers[i].Covered > covers[j].Covered
		}
		return covers[i].Colour.ID < covers[j].Colour.ID
	})
	for _, h := range held {
		if !h {
			uncovered++
		}
	}
	return covers, uncovered
}

// coverLine is a rhythm card's cover note over its rows.
func (c *Context) coverLine(rowIdxs []int, thingIDs []string) string {
	covers, uncovered := c.coversFor(rowIdxs, thingIDs)
	if len(covers) > rhythmCoverList {
		covers = covers[:rhythmCoverList]
	}
	return prompts.DiscoverRhythmCover(coverLines(covers), len(rowIdxs), uncovered)
}

func coverLines(covers []cover) []prompts.DiscoverCover {
	out := make([]prompts.DiscoverCover, 0, len(covers))
	for _, cv := range covers {
		out = append(out, prompts.DiscoverCover{ID: cv.Colour.ID, Name: cv.Colour.Name, Covered: cv.Covered, Exact: cv.Exact})
	}
	return out
}

// heldBy counts the rows any of the given colours holds.
func (c *Context) heldBy(colourIDs []string, rowIdxs []int) int {
	n := 0
	for _, idx := range rowIdxs {
		for _, id := range colourIDs {
			if info := c.colourByRef(id); info != nil && info.holds(idx) {
				n++
				break
			}
		}
	}
	return n
}
