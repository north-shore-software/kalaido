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
	ReadThingToolDescription      = "Read one thing from the map in depth: what it is, its relationships, how its fragments spread over time, and a sample of those fragments' titles and summaries with their ids. Call it before proposing anything built on a thing with many fragments or a vague blurb. Takes a thing id, or its exact name."
	ReadThingParamDescription     = "The thing's id from the map, or its exact name."
	ReadFragmentToolDescription   = "Read one fragment's full text, by id, when a summary is not enough to judge it. Budgeted per run."
	ReadFragmentParamDescription  = "The fragment id, exactly as shown."
	ListExistingToolDescription   = "List what already exists, with ids: everything a person has made and everything an earlier or current discover run produced. Free. Call it before proposing so you never propose what is already there."
	CoverageToolDescription       = "How much of the workspace sits inside an existing or proposed scope, and which heavy things are least covered. Free. Use it to decide whether you are done."
	FinishToolDescription         = "End the run. Give the summary: what you proposed, what you judged not worth surfacing, and what remains uncovered on purpose."
	FinishSummaryParamDescription = "The run's closing note, for the person reviewing the proposals: what you proposed, what you judged not worth surfacing, and what remains uncovered on purpose."

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
- read_thing: things in depth — blurb, relationships, a month-by-month count of fragments, and a sample of fragment titles and summaries with ids. Pass every thing you want to see in one call, up to ten. Use it before proposing on any heavy or vague thing: a big thing often hides several distinct projections, or one narrow one.
- read_fragment: one fragment's full text. Budgeted; use it when a summary leaves a real doubt.
- list_existing: what exists already, with ids. Free. Always call it before proposing.
- coverage: what share of the workspace sits inside an existing or proposed scope, and which heavy things are least covered. Free.
- propose_projection: propose one projection.
- finish: end the run and say why.

Work in few turns: read every thing you need to see in one read_thing call, and propose several projections in one turn once you have decided. Every id you pass must be real; a bad id comes back as an error message, and you can try again.`

const discoverProjectionsGuidance = `How to work:
1. Read the narrative and the things list. Sketch three to eight candidate projections. Each is about a thing, not about a timeline: an ongoing relationship with a supplier, a dispute and where it stands, a project and its decisions, the standing arrangements around a place. Time is context, not the spine.
2. Call list_existing. Drop candidates that are already covered. Judge by what the projection is about, not by which things it touches; two projections may legitimately share most of their scope.
3. Before proposing on a heavy or vague thing, call read_thing with every such thing at once. Decide whether it is one projection or several, and whether the scope should be the whole thing or a narrower set of fragments. Use read_fragment only when a summary leaves a doubt that matters.
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

const DiscoverReadThingLimit = 10

func DiscoverTooManyThings(limit int) string {
	return fmt.Sprintf("read_thing takes at most %d ids per call; the first %d were read.", limit, limit)
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

// --- reflections flow ---

const (
	RhythmsToolName           = "rhythms"
	ProposeReflectionToolName = "propose_reflection"
)

const (
	RhythmsToolDescription                   = "Recompute the rhythm cards at a grain: for every heavy thing, and every pair of things cited together, how many week or month buckets are active over the span, the date the steady run began (the onset), and a sample of bucket counts with a title each. Pass thingIds to restrict to those things (and the pairs they take part in). Free."
	RhythmsGrainParamDescription             = "\"week\" or \"month\": the bucket size to measure regularity at."
	RhythmsThingIDsParamDescription          = "Thing ids (or exact names) to restrict the cards to; omit for everything above the floor."
	ProposeReflectionToolDescription         = "Propose one reflection for the user to review. Nothing is generated: the proposal is a name, an opening message, a scope, a cadence and a start date. The user opens it, the message is sent as their first turn in a chat that drafts the reflection's lens, and on finishing the series is generated one window per period from the start date to now. Scope is built from thingIds (every fragment citing those things), fragmentIds (explicit fragments, to narrow) and colourIds; give at least one."
	ProposeReflectionNameParamDescription    = "2-6 words, the reflection's title as the user will see it. Name the recurring activity, plainly: \"Weekly BC Tech newsletter\", \"Monthly Workspace invoice\"."
	ProposeReflectionMessageParamDescription = "The opening message, 1-3 sentences, in the user's own voice as their standing instruction to the assistant that will write each period's summary: what to pull out of that period's material every time, what to emphasise, what to leave out. Say the cadence in it (\"Each week, ...\"). Never describe the proposal; write the instruction."
	ProposeCadenceParamDescription           = "How often a summary is produced and how much material each one covers: daily, weekly, monthly or quarterly. Pick the grain at which the rhythm card's buckets are steadily non-empty."
	ProposeStartTimeParamDescription         = "The date the rhythm began, YYYY-MM-DD: the onset on the rhythm card unless the sampled titles show the steady run started later. Every period from this date to now is summarised, so an earlier stray mention must not pull it back."
)

const DiscoverReflectionsSystem = `You are discovering reflections for a user who has just imported a body of material into their workspace. A reflection is a periodic summary: every week (or day, month, quarter) it summarises that period's material inside its scope, and the series of summaries is kept. It is worth having when something in the workspace recurs at a steady rhythm — a newsletter that arrives every week, invoices every month, a standing check-in with the same people, a report that lands on a schedule — and the user would want each period's account of it.

A projection is about a thing; a reflection is about a rhythm. You are looking for rhythms.

You do not create reflections. You propose them. A proposal is a name, an opening message, a scope, a cadence and a start date. The user sees the proposals, opens one, and the message is sent as their first turn in a chat that drafts the lens; on finishing, the series is generated from the start date to now. Nothing is generated until they open it, so a proposal costs nothing and a good set of proposals is the whole product of this run.

What you can see: the workspace map — a narrative, a flat list of "things" with how many fragments cite each and over what span, and relationships — plus rhythm cards computed from the annotated fragments: for each heavy thing, and each pair of things cited together, how many buckets of a grain are active over the span, when the steady run began, and a sample of bucket counts with a title each. Things cited in a large share of the whole workspace are marked ubiquitous: they are the ever-present cast (the user, their own company), not a rhythm, and cannot be proposed on.

Tools:
- rhythms: the rhythm cards at a grain (week or month), optionally restricted to given things. Free. Use the week grain to check whether something monthly is really weekly, and to confirm an onset.
- read_thing: a thing in depth — blurb, relationships, month-by-month counts, and sampled fragment titles and summaries with ids. Pass every thing you want in one call, up to ten.
- read_fragment: one fragment's full text. Budgeted; use it when a title leaves a real doubt about what recurs.
- list_existing: what exists already, with ids. Free. Always call it before proposing.
- coverage: what share of the workspace sits inside an existing or proposed scope. Free.
- propose_reflection: propose one reflection.
- finish: end the run and say why.

Work in few turns: read what you need in one call, and propose several reflections in one turn once you have decided. Every id you pass must be real; a bad id comes back as an error message, and you can try again.`

const discoverReflectionsGuidance = `How to work:
1. Read the rhythm cards. A candidate is a scope whose buckets are steadily non-empty over a sustained span: active close to span, at least a handful of periods. One burst of activity is not a rhythm; that is a projection's material, and this run leaves it alone.
2. For each candidate, name the activity that recurs. "The weekly BC Tech newsletter", "the monthly Google Workspace invoice", "the standing Legado check-in" are reflections. If all you can name is the cast — the same people keep appearing, but about different things each time — decide whether the user would want a periodic digest of that group; propose it only if so, and say so in the message. Use read_thing or the week-grain rhythms when the sampled titles do not settle it.
3. Call list_existing. Drop candidates already covered by a reflection. A projection on the same thing does not cover it: a projection is the standing account, a reflection is the period-by-period one.
4. Choose the cadence as the grain at which the buckets are steadily non-empty: a weekly newsletter is weekly even though the month grain is also full; monthly invoices are monthly. Choose the start date as the onset on the card unless the titles show the steady run began later.
5. Scope every proposal to the things that carry the rhythm — usually one, sometimes a pair. Never propose on a ubiquitous thing, and never a scope that is most of the workspace.
6. Call coverage when your candidates are done. Proposing nothing is a legitimate outcome: many workspaces have no rhythms worth a series.
7. Call finish, and say what you proposed, what you judged a burst rather than a rhythm, and why.

Writing the message: it is the user's first chat turn, in their voice, addressed to the assistant that will write each period's summary. Say the cadence and what to pull out every time: "Each week, summarise what the BC Tech newsletter covered: events, advocacy, and anything relevant to a small tech company in Vancouver." Not "This reflection tracks the newsletter."

Example:
{"name": "Weekly BC Tech newsletter", "message": "Each week, summarise what the BC Tech newsletter and event mailers covered: upcoming events with dates, advocacy positions, and anything a small Vancouver tech company should act on.", "thingIds": ["t_bctech"], "cadence": "weekly", "startTime": "2025-01-15"}`

func DiscoverReflectionsInitial(d *mapdoc.Document, worklistFloor int, rhythms string) string {
	var sb strings.Builder
	sb.WriteString("What the workspace is about:\n")
	if strings.TrimSpace(d.Narrative) == "" {
		sb.WriteString("(no narrative yet)\n")
	} else {
		sb.WriteString(strings.TrimSpace(d.Narrative) + "\n")
	}
	sb.WriteString("\nThings, heaviest first (id · name · kind · fragments · span · what it is):\n")
	sb.WriteString(discoverThingsBlock(d, worklistFloor))
	sb.WriteString("\n" + rhythms)
	sb.WriteString("\n" + discoverReflectionsGuidance)
	return sb.String()
}

type DiscoverRhythmThing struct {
	ID   string
	Name string
}

type DiscoverBucket struct {
	Start string
	Count int
	Title string
}

type DiscoverRhythm struct {
	Things      []DiscoverRhythmThing
	Grain       string
	Total       int
	Active      int
	Span        int
	First, Last string
	Onset       string
	Ubiquitous  bool
	Buckets     []DiscoverBucket
}

func DiscoverRhythmsBlock(grain string, singles, pairs []DiscoverRhythm) string {
	var b strings.Builder
	fmt.Fprintf(&b, "Rhythms at the %s grain (things, most regular first):\n", grain)
	if len(singles) == 0 {
		b.WriteString("(nothing on the map reaches the floor yet)\n")
	}
	for _, r := range singles {
		b.WriteString(DiscoverRhythmCard(r))
	}
	fmt.Fprintf(&b, "\nRhythms at the %s grain (pairs of things cited together, most regular first):\n", grain)
	if len(pairs) == 0 {
		b.WriteString("(no pair is cited together in three or more buckets)\n")
	}
	for _, r := range pairs {
		b.WriteString(DiscoverRhythmCard(r))
	}
	return b.String()
}

func DiscoverRhythmCard(r DiscoverRhythm) string {
	var b strings.Builder
	names := make([]string, 0, len(r.Things))
	for _, t := range r.Things {
		names = append(names, fmt.Sprintf("%s (%s)", t.Name, t.ID))
	}
	b.WriteString(strings.Join(names, " with "))
	fmt.Fprintf(&b, " · %d fragments", r.Total)
	if r.Active == 0 {
		b.WriteString(" · undated\n")
		return b.String()
	}
	unit := r.Grain + "s"
	fmt.Fprintf(&b, " · %d of %d %s active, %s to %s · onset %s", r.Active, r.Span, unit, r.First, r.Last, r.Onset)
	if r.Ubiquitous {
		b.WriteString(" · ubiquitous: not a rhythm, do not propose on it")
	}
	b.WriteString("\n")
	for _, bk := range r.Buckets {
		fmt.Fprintf(&b, "  %s: %d · %s\n", bk.Start, bk.Count, bk.Title)
	}
	return b.String()
}

func DiscoverProposedReflection(name, id string, fragments int, cadence, start string) string {
	return fmt.Sprintf("Proposed reflection %q (id: %s, %d fragments in scope, %s from %s).", name, id, fragments, cadence, start)
}

const DiscoverReflectionScopeRequired = "give at least one of thingIds, fragmentIds or colourIds"

func DiscoverUnknownCadence(cadence string, allowed []string) string {
	return fmt.Sprintf("cadence %q is not one of %s", cadence, strings.Join(allowed, ", "))
}

func DiscoverBadStartTime(s string) string {
	return fmt.Sprintf("startTime %q is not a date; use YYYY-MM-DD", s)
}

func DiscoverStartInFuture(date string) string {
	return fmt.Sprintf("startTime %s is in the future; the start is when the rhythm began", date)
}

func DiscoverTooManyWindows(windows, limit int) string {
	return fmt.Sprintf("that start and cadence give %d periods, more than the %d a series can hold; choose a coarser cadence or a later start", windows, limit)
}

func DiscoverUbiquitousThing(name, id string) string {
	return fmt.Sprintf("%s (%s) is cited across most of the workspace; it is the cast, not a rhythm, and cannot be a reflection's scope", name, id)
}
