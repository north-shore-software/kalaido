package prompts

import (
	"encoding/json"
	"fmt"
	"strings"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/mapdoc"
)

const annotateInlineFloor = 2

const annotateEmptyMap = "The workspace map is empty so far: nothing has been annotated yet, so every thing this fragment mentions is new."

func annotateMapBlock(d *mapdoc.Document) string {
	var active, pending []mapdoc.Thing
	for _, t := range d.Things {
		switch {
		case t.Status == mapdoc.StatusPending:
			pending = append(pending, t)
		case t.Status == mapdoc.StatusActive && t.Fragments >= annotateInlineFloor:
			active = append(active, t)
		}
	}
	if len(active)+len(pending) == 0 && strings.TrimSpace(d.Narrative) == "" {
		return annotateEmptyMap
	}
	shown := make(map[string]string, len(active)+len(pending))
	var sb strings.Builder
	sb.WriteString("Workspace map — known things (id · name · kind · aliases · what it is):\n")
	if len(active) == 0 {
		sb.WriteString("(none confirmed yet)\n")
	}
	for _, t := range active {
		shown[t.ID] = t.Name
		fmt.Fprintf(&sb, "%s · %s · %s · %s · %s\n", t.ID, t.Name, t.Kind, aliasList(t.Aliases), t.Blurb)
	}
	if len(pending) > 0 {
		sb.WriteString("\nProposed recently, not yet confirmed (cite by id if the same thing):\n")
		for _, t := range pending {
			shown[t.ID] = t.Name
			fmt.Fprintf(&sb, "%s · %s · %s · note: %s\n", t.ID, t.Name, t.Kind, t.Note)
		}
	}
	var rels []string
	for _, r := range d.Relationships {
		from, okFrom := shown[r.From]
		to, okTo := shown[r.To]
		if okFrom && okTo {
			rels = append(rels, fmt.Sprintf("%s (%s) %s %s (%s)", from, r.From, r.Kind, to, r.To))
		}
	}
	if len(rels) > 0 {
		sb.WriteString("\nRelationships:\n")
		sb.WriteString(strings.Join(rels, "\n"))
		sb.WriteString("\n")
	}
	if n := strings.TrimSpace(d.Narrative); n != "" {
		sb.WriteString("\nWhat the workspace is about:\n")
		sb.WriteString(n)
		sb.WriteString("\n")
	}
	return sb.String()
}

func aliasList(aliases []string) string {
	if len(aliases) == 0 {
		return "-"
	}
	return "aka " + strings.Join(aliases, ", ")
}

func AnnotatePrompt(d *mapdoc.Document, fragmentBlock string) string {
	return `You are annotating one fragment from a user's personal workspace. The workspace keeps a flat map of "things" — the people, organisations, places, projects and topics that recur across its material — and your annotation is how this fragment gets connected to them. Read the fragment in the light of the map: a one-line message that means nothing alone may mean a lot next to what the workspace already knows.

` + annotateMapBlock(d) + `
Fragment:
` + fragmentBlock + `
Write a JSON object with exactly these keys:
{"title": string, "summary": string, "things": [{"ref": string} | {"name": string, "kind": string, "note": string}], "decisions": [{"text": string, "refs": [string]}], "questions": [{"text": string, "refs": [string]}], "conclusions": [{"text": string, "refs": [string]}]}

- "title": 2-6 words that label what this fragment is, for a list in the app. Specific and plain ("Lift contract renewal quote", "Weekend plans with Barry"), never a subject line copied verbatim and never a generic label like "Email" or "Note".
- "summary": 1-5 sentences saying what the fragment is about and what happens in it, written against the map: whenever you mention a thing that is listed above, write it as a markdown link whose text is the name and whose target is the id, like [Lambert Surveyors](t_ab12cd34). Things not listed above are written as plain text.
- "things": every listed thing this fragment references or discusses, as {"ref": id} using the exact id from the list — never propose a listed thing again under another name. For anything recurring-looking that is not listed (a person, organisation, place, project, product, or topic), propose it as {"name", "kind", "note"}: "kind" is one of person, organisation, place, project, topic, other; "note" is one short phrase saying what it is, written for a reader who will only ever see this note and not the fragment ("a film they are planning to see", "the managing agent for the building"). Do not propose passing mentions that will never recur (a one-off shop, a street on a route).
- "decisions": commitments made in this fragment. "questions": things asked or left open in it. "conclusions": things settled or concluded in it. Each item has a short "text" and "refs": the ids of listed things it concerns, or the exact proposed name for a thing you proposed above. Always include all three keys; an empty array is the right answer when the fragment has none.
- Never assign the fragment a category, folder, or topic tree, and never invent structure beyond the things themselves: you can see one fragment, not the shape of the whole workspace.

Reply with only the JSON object.`
}

type ThingCitation struct {
	Ref  string `json:"ref,omitempty"`
	Name string `json:"name,omitempty"`
	Kind string `json:"kind,omitempty"`
	Note string `json:"note,omitempty"`
}

type Assertion struct {
	Text string   `json:"text"`
	Refs []string `json:"refs"`
}

type Annotation struct {
	Title       string
	Summary     string
	Things      []ThingCitation
	Decisions   []Assertion
	Questions   []Assertion
	Conclusions []Assertion
}

type annotateWire struct {
	Title   string `json:"title"`
	Summary string `json:"summary"`
	Things  []struct {
		Ref  string `json:"ref"`
		Name string `json:"name"`
		Kind string `json:"kind"`
		Note string `json:"note"`
	} `json:"things"`
	Decisions   []assertionWire `json:"decisions"`
	Questions   []assertionWire `json:"questions"`
	Conclusions []assertionWire `json:"conclusions"`
}

type assertionWire struct {
	Text string   `json:"text"`
	Refs []string `json:"refs"`
}

func ParseAnnotateReply(text string) (Annotation, bool) {
	raw, ok := extractJSONObject(text, "summary")
	if !ok {
		return Annotation{}, false
	}
	var w annotateWire
	if err := json.Unmarshal(raw, &w); err != nil {
		return Annotation{}, false
	}
	a := Annotation{
		Title:       strings.TrimSpace(w.Title),
		Summary:     strings.TrimSpace(w.Summary),
		Things:      []ThingCitation{},
		Decisions:   assertions(w.Decisions),
		Questions:   assertions(w.Questions),
		Conclusions: assertions(w.Conclusions),
	}
	if a.Summary == "" {
		return Annotation{}, false
	}
	for _, t := range w.Things {
		ref, name := strings.TrimSpace(t.Ref), strings.TrimSpace(t.Name)
		switch {
		case ref != "":
			a.Things = append(a.Things, ThingCitation{Ref: ref})
		case name != "":
			a.Things = append(a.Things, ThingCitation{Name: name, Kind: mapdoc.NormalizeKind(t.Kind), Note: strings.TrimSpace(t.Note)})
		}
	}
	return a, true
}

func assertions(in []assertionWire) []Assertion {
	out := make([]Assertion, 0, len(in))
	for _, w := range in {
		text := strings.TrimSpace(w.Text)
		if text == "" {
			continue
		}
		refs := make([]string, 0, len(w.Refs))
		for _, r := range w.Refs {
			if r = strings.TrimSpace(r); r != "" {
				refs = append(refs, r)
			}
		}
		out = append(out, Assertion{Text: text, Refs: refs})
	}
	return out
}
