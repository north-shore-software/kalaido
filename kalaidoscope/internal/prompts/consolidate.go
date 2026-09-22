package prompts

import (
	"encoding/json"
	"fmt"
	"strings"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/mapdoc"
)

type AnnotationRow struct {
	FragmentID string
	Date       string
	Title      string
	Summary    string
	Things     []ThingCitation
}

const consolidateMapSchema = `{"things": [{"id": string, "name": string, "aliases": [string], "kind": string, "blurb": string}], "relationships": [{"from": string, "to": string, "kind": string}], "narrative": string}`

func consolidateMapBlock(d *mapdoc.Document) string {
	if len(d.Things) == 0 && strings.TrimSpace(d.Narrative) == "" {
		return "There is no map yet: this is the first consolidation for this workspace."
	}
	type thing struct {
		ID      string   `json:"id"`
		Name    string   `json:"name"`
		Aliases []string `json:"aliases"`
		Kind    string   `json:"kind"`
		Blurb   string   `json:"blurb"`
	}
	view := struct {
		Things        []thing               `json:"things"`
		Relationships []mapdoc.Relationship `json:"relationships"`
		Narrative     string                `json:"narrative"`
	}{Things: []thing{}, Relationships: d.Relationships, Narrative: d.Narrative}
	for _, t := range d.Things {
		view.Things = append(view.Things, thing{t.ID, t.Name, t.Aliases, t.Kind, t.Blurb})
	}
	b, _ := json.Marshal(view)
	return "Current map:\n" + string(b)
}

func annotationRowsBlock(rows []AnnotationRow) string {
	var sb strings.Builder
	for _, r := range rows {
		fmt.Fprintf(&sb, "--- %s · %s · %s ---\n%s\n", r.FragmentID, r.Date, r.Title, r.Summary)
		var cites []string
		for _, c := range r.Things {
			switch {
			case c.Ref != "":
				cites = append(cites, c.Ref)
			case c.Note != "":
				cites = append(cites, fmt.Sprintf("%s (%s: %s)", c.Name, c.Kind, c.Note))
			default:
				cites = append(cites, fmt.Sprintf("%s (%s)", c.Name, c.Kind))
			}
		}
		if len(cites) > 0 {
			sb.WriteString("things: " + strings.Join(cites, "; ") + "\n")
		}
		sb.WriteString("\n")
	}
	return sb.String()
}

func ConsolidatePrompt(d *mapdoc.Document, rows []AnnotationRow) string {
	return `You maintain the map of a user's personal workspace: a flat list of the "things" that recur across its material — people, organisations, places, projects, topics — with how they relate and a short account of what the workspace is about. Below is the current map, followed by an annotation of every fragment in the workspace: a title, a summary in which things already on the map are written as [Name](id), and the things each fragment cites, either by id or as a proposal with a note saying what it is.

` + consolidateMapBlock(d) + `

Annotations, in event-time order:
` + annotationRowsBlock(rows) + `
Write the complete new map as a JSON object with this exact shape:
` + consolidateMapSchema + `

- Every thing that recurs across the annotations belongs on the map, and one real thing appears exactly once. Where the annotations propose the same thing under different spellings, forms, or partial names, keep one entry and list the other forms in "aliases"; where an existing entry and a proposal are the same thing, keep the existing entry and add the proposed name as an alias. Do not merge things that are merely related — a person and their company, a project and its client — those are separate entries joined by a relationship.
- Keep the "id" of every existing thing you keep, exactly as it is: annotations point at those ids and must keep resolving. Omit "id" entirely for a thing that is new; never invent one. If you fold an existing thing into another, keep the surviving entry's id and put the folded thing's name in its aliases.
- "kind" is one of person, organisation, place, project, topic, other. "blurb" is one line saying what the thing is, for someone who has never seen the workspace; rewrite blurbs that have gone stale.
- "relationships" connect two things by id — or by exact name for a thing that is new in this map — with a short "kind" such as "works at", "manages", "part of", "client of", "related". Include the relationships the annotations support; drop ones nothing supports any more.
- "narrative": what this workspace is about and how it has developed over time, in at most 200 words. Rewrite it freely.
- Do not create categories, folders, dimensions, or a tree: the map is a flat list of things and the relationships between them. Do not include fragment counts or dates; those are computed afterwards.

Reply with only the JSON object.`
}

const ConsolidateJSONRetryNudge = "Your last reply could not be read as a single JSON object with a \"things\" array. Reply again with only the complete map JSON object: no code fences, no commentary."

func ParseConsolidateReply(text string) (*mapdoc.Document, bool) {
	raw, ok := extractJSONObject(text, "things")
	if !ok {
		return nil, false
	}
	var d mapdoc.Document
	if err := json.Unmarshal(raw, &d); err != nil {
		return nil, false
	}
	return &d, true
}
