package prompts

import (
	"fmt"
	"sort"
	"strings"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/mapdoc"
)

const (
	ReadThingToolName         = "read_thing"
	ReadFragmentToolName      = "read_fragment"
	ListExistingToolName      = "list_existing"
	CoverageToolName          = "coverage"
	FinishToolName            = "finish"
	ProposeProjectionToolName = "propose_projection"
)

const (
	ReadThingToolDescription     = "Read one thing from the map in depth: what it is, its relationships, how its fragments spread over time, and a sample of those fragments' titles and summaries with their ids. Call it before proposing anything built on a thing with many fragments or a vague blurb. Takes a thing id, or its exact name."
	ReadThingParamDescription    = "The thing's id from the map, or its exact name."
	ReadFragmentToolDescription  = "Read one fragment's full text, by id, when a summary is not enough to judge it. Budgeted per run."
	ReadFragmentParamDescription = "The fragment id, exactly as shown."
	ListExistingToolDescription  = "List what already exists, with ids: everything a person has made and everything an earlier or current discover run produced. Free. Call it before proposing so you never propose what is already there."
	CoverageToolDescription      = "How much of the workspace sits inside an existing or proposed scope, and which heavy things are least covered. Free. Use it to decide whether you are done."
	FinishToolDescription        = "End the run. Say in your reply why: what you proposed, what you judged not worth surfacing, and what remains uncovered on purpose."

	ProposeProjectionToolDescription           = "Propose one projection for the user to review. Nothing is generated: the proposal is a name, an opening message and a scope. The user opens it, the message is sent as their first turn in a chat that drafts the projection, and they keep or discard it from there. Scope is built from thingIds (every fragment citing those things), fragmentIds (explicit fragments, to narrow), colourIds (existing colours), and sourceProjectionIds (existing or proposed projections whose content this one builds on); give at least one."
	ProposeNameParamDescription                = "2-6 words, the projection's title as the user will see it. Name the thing it is about, plainly."
	ProposeMessageParamDescription             = "The opening message, 1-3 sentences, written in the user's own voice as their instruction to the assistant that will draft the projection: what to keep producing from the scope, what to emphasise, what to leave out. Name any source projections by their exact names. Never describe the proposal; write the instruction."
	ProposeThingIDsParamDescription            = "Thing ids from the map. Every fragment citing any of them joins the scope."
	ProposeFragmentIDsParamDescription         = "Fragment ids from read_thing or read_fragment, when the scope should be narrower than whole things."
	ProposeColourIDsParamDescription           = "Ids of existing colours, from list_existing, whose members join the scope."
	ProposeSourceProjectionIDsParamDescription = "Ids of projections, existing or proposed in this run, whose content this projection builds on rather than restates."
)

const DiscoverProjectionsSystem = `You are discovering projections for a user who has just imported a body of material into their workspace. A projection is a living document about one thing the user cares about: a person, an organisation, a project, a dispute, a decision and its rationale, a piece of thinking. It is regenerated from its scope as new material arrives, so it is worth having when the user would come back to it.

You do not create projections. You propose them. A proposal is a name, an opening message and a scope. The user sees the proposals, opens one, and the message is sent as their first turn in a chat that drafts the projection from the scope; they refine it there and keep or discard it. Nothing is generated until they open it, so a proposal costs nothing and a good set of proposals is the whole product of this run.

What you can see: the workspace map — a narrative saying what the workspace is about, a flat list of "things" (people, organisations, places, projects, topics) with how many fragments cite each and over what span, and relationships between them — and, through the tools, the annotated fragments behind any thing.

Tools:
- read_thing: a thing in depth — blurb, relationships, a month-by-month count of its fragments, and a sample of fragment titles and summaries with ids. Use it before proposing on any heavy or vague thing: a big thing often hides several distinct projections, or one narrow one.
- read_fragment: one fragment's full text. Budgeted; use it when a summary leaves a real doubt.
- list_existing: what exists already, with ids. Free. Always call it before proposing.
- coverage: what share of the workspace sits inside an existing or proposed scope, and which heavy things are least covered. Free.
- propose_projection: propose one projection.
- finish: end the run and say why.

Every id you pass must be real; a bad id comes back as an error message, and you can try again.`

const discoverProjectionsGuidance = `How to work:
1. Read the narrative and the things list. Sketch three to eight candidate projections. Each is about a thing, not about a timeline: an ongoing relationship with a supplier, a dispute and where it stands, a project and its decisions, the standing arrangements around a place. Time is context, not the spine.
2. Call list_existing. Drop candidates that are already covered. Judge by what the projection is about, not by which things it touches; two projections may legitimately share most of their scope.
3. Before proposing on a heavy or vague thing, call read_thing. Decide whether it is one projection or several, and whether the scope should be the whole thing or a narrower set of fragments. Use read_fragment only when a summary leaves a doubt that matters.
4. Narrow first. A single decision, one dispute, one supplier relationship is a projection on its own. When one candidate would contain another, propose the narrower first, then propose the broader one with the narrower as a source projection, and name it in the message. A broader projection builds on its sources; it does not restate them.
5. Give every proposal the minimum scope its message needs. Prefer a few things to many; prefer explicit fragments to a whole thing when only part of it matters. Never propose a scope that is most of the workspace: that is not a projection, it is the workspace.
6. Call coverage when your candidates are done. Propose more only if a heavy thing is uncovered and genuinely worth a projection. Proposing nothing for a thing is a legitimate outcome: not every recurring name is something the user wants a document about.
7. Call finish, and say what you proposed, what you left out, and why.

Writing the message: it is the user's first chat turn, in their voice, addressed to the assistant that will draft the projection. Say what to keep producing and what matters: "Keep a running account of the lift contract: who the contractor is, what was quoted and agreed, what is outstanding, and the dates that matter." Not "This projection covers the lift contract." Name source projections by their exact names, because the drafter sees each one as a block headed by its name.

Example of a narrow proposal:
{"name": "Lift maintenance contract", "message": "Keep a current account of the lift maintenance arrangement: who holds the contract, what was quoted and agreed, open faults and what is outstanding, with the dates that matter.", "thingIds": ["t_lifts", "t_liftco"]}

Example of a broader proposal built on it:
{"name": "Building operations", "message": "Give me a standing overview of how the building is run: the managing agent, the recurring contracts and who holds them, and what is currently unresolved. Draw on the projection 'Lift maintenance contract' for the lifts rather than restating it.", "thingIds": ["t_agent", "t_building"], "sourceProjectionIds": ["<id returned for Lift maintenance contract>"]}`

func DiscoverProjectionsInitial(d *mapdoc.Document, worklistFloor int) string {
	var sb strings.Builder
	sb.WriteString("What the workspace is about:\n")
	if strings.TrimSpace(d.Narrative) == "" {
		sb.WriteString("(no narrative yet)\n")
	} else {
		sb.WriteString(strings.TrimSpace(d.Narrative) + "\n")
	}
	sb.WriteString("\nThings, heaviest first (id · name · kind · fragments · span · what it is):\n")
	sb.WriteString(discoverThingsBlock(d, worklistFloor))
	if len(d.Relationships) > 0 {
		sb.WriteString("\nRelationships:\n")
		for _, r := range d.Relationships {
			from, to := d.Find(r.From), d.Find(r.To)
			if from == nil || to == nil {
				continue
			}
			sb.WriteString(DiscoverRelationshipLine(from.Name, from.ID, r.Kind, to.Name, to.ID) + "\n")
		}
	}
	sb.WriteString("\n" + discoverProjectionsGuidance)
	return sb.String()
}

func DiscoverExistingBlock(existing string) string {
	return "What already exists:\n" + existing
}

func DiscoverCoverageBlock(coverage string) string {
	return "Coverage now:\n" + coverage
}

func DiscoverEchoToolCalls(names []string) string {
	if len(names) == 0 {
		return ""
	}
	return "\n\n[You called: " + strings.Join(names, ", ") + "]"
}

func DiscoverUnknownTool(name string) string {
	return fmt.Sprintf("no tool named %q", name)
}

func DiscoverNoRecord(kind, id string) string {
	return fmt.Sprintf("no %s with id %q", kind, id)
}

func discoverThingsBlock(d *mapdoc.Document, floor int) string {
	things := make([]mapdoc.Thing, 0, len(d.Things))
	for _, t := range d.Things {
		if t.Fragments >= floor {
			things = append(things, t)
		}
	}
	sort.SliceStable(things, func(i, j int) bool { return things[i].Fragments > things[j].Fragments })
	if len(things) == 0 {
		return "(nothing on the map reaches the floor yet)\n"
	}
	var sb strings.Builder
	for _, t := range things {
		span := "-"
		if t.FirstSeen != "" {
			span = t.FirstSeen + " to " + t.LastSeen
		}
		fmt.Fprintf(&sb, "%s · %s · %s · %d · %s · %s\n", t.ID, t.Name, t.Kind, t.Fragments, span, t.Blurb)
	}
	return sb.String()
}

func DiscoverProposed(kind, name, id string, fragments int) string {
	return fmt.Sprintf("Proposed %s %q (id: %s, %d fragments in scope).", kind, name, id, fragments)
}

func DiscoverRejected(reason string) string {
	return "Rejected: " + reason
}

func DiscoverExistingLine(kind, id, name, description, note string, fragments int) string {
	var sb strings.Builder
	fmt.Fprintf(&sb, "- %s %q (%s)", kind, name, id)
	if note != "" {
		fmt.Fprintf(&sb, " [%s]", note)
	}
	if description != "" {
		sb.WriteString(": " + description)
	}
	fmt.Fprintf(&sb, " — %d fragments", fragments)
	return sb.String()
}

const (
	DiscoverExistingNone           = "Nothing exists yet."
	DiscoverUndated                = "undated"
	DiscoverNoteProposedThisRun    = "proposed by this run"
	DiscoverNoteProposedEarlier    = "proposed by an earlier run, not yet opened"
	DiscoverBadArgs                = "the arguments could not be read"
	DiscoverNameAndMessageRequired = "name and message are both required"
	DiscoverScopeRequired          = "give at least one of thingIds, fragmentIds, colourIds or sourceProjectionIds"
)

type DiscoverRow struct {
	FragmentID string
	Date       string
	Title      string
	Summary    string
}

type DiscoverGap struct {
	ID        string
	Name      string
	Uncovered int
	Total     int
}

func DiscoverNoThing(ref string) string {
	return fmt.Sprintf("No thing matches %q.", ref)
}

func DiscoverNoFragment(id string) string {
	return fmt.Sprintf("No fragment with id %q.", id)
}

func DiscoverReadBudgetExhausted(limit int) string {
	return fmt.Sprintf("Fragment read budget exhausted (%d per run). Work from the summaries you already have.", limit)
}

func DiscoverThingCard(t *mapdoc.Thing, relationships []string, cited int, timeline map[string]int, sample []DiscoverRow) string {
	var b strings.Builder
	fmt.Fprintf(&b, "%s · %s · %s", t.ID, t.Name, t.Kind)
	if len(t.Aliases) > 0 {
		fmt.Fprintf(&b, " · aka %s", strings.Join(t.Aliases, ", "))
	}
	b.WriteString("\n")
	if t.Blurb != "" {
		b.WriteString(t.Blurb + "\n")
	}
	fmt.Fprintf(&b, "%d fragments", cited)
	if t.FirstSeen != "" {
		fmt.Fprintf(&b, ", %s to %s", t.FirstSeen, t.LastSeen)
	}
	b.WriteString("\n")
	if len(relationships) > 0 {
		b.WriteString("Relationships:\n  " + strings.Join(relationships, "\n  ") + "\n")
	}
	if cited == 0 {
		b.WriteString("No annotated fragments cite it.\n")
		return b.String()
	}
	months := make([]string, 0, len(timeline))
	for m := range timeline {
		months = append(months, m)
	}
	sort.Strings(months)
	b.WriteString("Timeline:\n")
	for _, m := range months {
		fmt.Fprintf(&b, "  %s: %d\n", m, timeline[m])
	}
	fmt.Fprintf(&b, "Fragments (%d of %d, spread over time):\n", len(sample), cited)
	for _, row := range sample {
		fmt.Fprintf(&b, "  %s · %s · %s (%s)\n", row.Date, row.Title, row.Summary, row.FragmentID)
	}
	return b.String()
}

func DiscoverRelationshipLine(fromName, fromID, kind, toName, toID string) string {
	return fmt.Sprintf("%s (%s) %s %s (%s)", fromName, fromID, kind, toName, toID)
}

func DiscoverCoverage(hit, total int, gaps []DiscoverGap) string {
	pct := 0
	if total > 0 {
		pct = hit * 100 / total
	}
	var b strings.Builder
	fmt.Fprintf(&b, "%d of %d annotated fragments (%d%%) sit inside an existing or proposed scope.\n", hit, total, pct)
	if len(gaps) == 0 {
		return b.String()
	}
	b.WriteString("Least covered things:\n")
	for _, g := range gaps {
		fmt.Fprintf(&b, "  %s · %s · %d of %d fragments uncovered\n", g.ID, g.Name, g.Uncovered, g.Total)
	}
	return b.String()
}
