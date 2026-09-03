package prompts

import (
	"fmt"
	"sort"
	"strings"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/mapdoc"
)

const (
	ReadThingToolName         = "read_thing"
	ReadColourToolName        = "read_colour"
	ReadFragmentToolName      = "read_fragment"
	ListExistingToolName      = "list_existing"
	CoverageToolName          = "coverage"
	FinishToolName            = "finish"
	ProposeProjectionToolName = "propose_projection"
)

const (
	ReadThingToolDescription      = "Read one thing from the map in depth: what it is, its relationships, how its fragments spread over time, and a sample of those fragments' titles and summaries with their ids. Call it before proposing anything built on a thing with many fragments or a vague blurb. Takes a thing id, or its exact name."
	ReadThingParamDescription     = "The thing's id from the map, or its exact name."
	ReadColourToolDescription     = "Read colours in depth: the things each is built on, how many fragments it holds, a month-by-month count of them, and a sample of their titles and summaries with ids. Pass every colour you want to see in one call, up to ten. Takes colour ids, or exact names."
	ReadColourParamDescription    = "Colour ids from the colours list or list_existing, or their exact names."
	ReadFragmentToolDescription   = "Read one fragment's full text, by id, when a summary is not enough to judge it. Budgeted per run."
	ReadFragmentParamDescription  = "The fragment id, exactly as shown."
	ListExistingToolDescription   = "List what already exists, with ids: everything a person has made and everything an earlier or current discover run produced. Free. Call it before proposing so you never propose what is already there."
	CoverageToolDescription       = "How much of the workspace sits inside an existing or proposed scope, and what is least covered: the heaviest uncoloured things in the colours run, the colours no projection or reflection scopes in the others. Free. Use it to decide whether you are done."
	FinishToolDescription         = "End the run. Give the summary: what you proposed, what you judged not worth surfacing, and what remains uncovered on purpose."
	FinishSummaryParamDescription = "The run's closing note, for the person reviewing the proposals: what you proposed, what you judged not worth surfacing, and what remains uncovered on purpose."

	ProposeProjectionToolDescription           = "Propose one projection for the user to review. Nothing is generated: the proposal is a name, an opening message and a scope. The user opens it, the message is sent as their first turn in a chat that drafts the projection, and they keep or discard it from there. Scope is built from colourIds (existing colours, whose members are the material and keep growing as it arrives) and sourceProjectionIds (existing or proposed projections whose content this one builds on); give at least one."
	ProposeNameParamDescription                = "2-6 words, the projection's title as the user will see it. Name the thing it is about, plainly."
	ProposeMessageParamDescription             = "The opening message, 1-3 sentences, written in the user's own voice as their instruction to the assistant that will draft the projection: what to keep producing from the scope, what to emphasise, what to leave out. Name any source projections by their exact names. Never describe the proposal; write the instruction."
	ProposeColourIDsParamDescription           = "Colour ids (or exact names) from the colours list or list_existing. Every fragment those colours hold is the scope, now and as new material arrives. Usually one colour."
	ProposeSourceProjectionIDsParamDescription = "Ids of projections, existing or proposed in this run, whose content this projection builds on rather than restates."
)

const DiscoverProjectionsSystem = `You are discovering projections for a user who has just imported a body of material into their workspace. A projection is a living document about one thing the user cares about: a person, an organisation, a project, a dispute, a decision and its rationale, a piece of thinking. It is regenerated from its scope as new material arrives, so it is worth having when the user would come back to it.

You do not create projections. You propose them. A proposal is a name, an opening message and a scope. The user sees the proposals, opens one, and the message is sent as their first turn in a chat that drafts the projection from the scope; they refine it there and keep or discard it. Nothing is generated until they open it, so a proposal costs nothing and a good set of proposals is the whole product of this run.

A scope is made of colours. A colour is a named slice of the workspace, built on one or more map things; it holds every fragment about that slice and keeps growing as new material arrives, so a projection scoped by colours stays current. You can only scope by colours that exist: they were made before this run, by the user or by the colours run, and this run makes no more. If no colour carries a thing worth a projection, propose nothing for it.

What you can see: the workspace map — a narrative saying what the workspace is about, and the relationships between its "things" (people, organisations, places, projects, topics) — and the workspace as colours: each colour's id, name, the things it is built on, how many fragments it holds and over what span. Through the tools, the fragments behind any colour or thing.

Tools:
- read_colour: colours in depth — the things each is built on, a month-by-month count of its fragments, and a sample of their titles and summaries with ids. Pass every colour you want to see in one call, up to ten. Use it before proposing on any large or vague colour: a big colour often holds several distinct projections, or one narrow one.
- read_thing: a map thing in depth, by id or exact name — blurb, relationships, timeline and sampled fragments. For the things a colour is built on, when the colour card leaves a doubt.
- read_fragment: one fragment's full text. Budgeted; use it when a summary leaves a real doubt.
- list_existing: what exists already, with ids: colours, projections and reflections. Free. Always call it before proposing.
- coverage: what share of the workspace sits inside an existing or proposed projection or reflection, and which colours are least covered. Free.
- propose_projection: propose one projection.
- finish: end the run and say why.

Work in few turns: read every colour you need to see in one read_colour call, and propose several projections in one turn once you have decided. Every id you pass must be real; a bad id comes back as an error message, and you can try again.`

const discoverProjectionsGuidance = `How to work:
1. Read the narrative and the colours. Sketch three to eight candidate projections. Each is about a thing, not about a timeline: an ongoing relationship with a supplier, a dispute and where it stands, a project and its decisions, the standing arrangements around a place. Time is context, not the spine. Each candidate lives in one colour, sometimes two.
2. Call list_existing. Drop candidates already covered by a projection. Judge by what the projection is about, not by which colours it touches; two projections may legitimately share a colour.
3. Before proposing on a large or vague colour, call read_colour with every such colour at once. Decide whether it holds one projection or several: several projections on one colour are fine when they are about different things, and the message tells the drafter which. Use read_fragment only when a summary leaves a doubt that matters.
4. Narrow first. A single decision, one dispute, one supplier relationship is a projection on its own. When one candidate would contain another, propose the narrower first, then propose the broader one with the narrower as a source projection, and name it in the message. A broader projection builds on its sources; it does not restate them.
5. Give every proposal the minimum scope its message needs: one colour rather than several. You cannot narrow below a colour; when only part of one matters, say what matters in the message and the drafter selects. Never propose a scope that is most of the workspace: that is not a projection, it is the workspace.
6. Call coverage when your candidates are done. Propose more only if a colour is uncovered and genuinely worth a projection. Proposing nothing for a colour is a legitimate outcome: not every slice is something the user wants a document about.
7. Call finish, and say what you proposed, what you left out, and why.

Writing the message: it is the user's first chat turn, in their voice, addressed to the assistant that will draft the projection. Say what to keep producing and what matters: "Keep a running account of the lift contract: who the contractor is, what was quoted and agreed, what is outstanding, and the dates that matter." Not "This projection covers the lift contract." Name source projections by their exact names, because the drafter sees each one as a block headed by its name.

Example of a narrow proposal:
{"name": "Lift maintenance contract", "message": "Keep a current account of the lift maintenance arrangement: who holds the contract, what was quoted and agreed, open faults and what is outstanding, with the dates that matter.", "colourIds": ["<id of the Lifts colour>"]}

Example of a broader proposal built on it:
{"name": "Building operations", "message": "Give me a standing overview of how the building is run: the managing agent, the recurring contracts and who holds them, and what is currently unresolved. Draw on the projection 'Lift maintenance contract' for the lifts rather than restating it.", "colourIds": ["<id of the Building colour>"], "sourceProjectionIds": ["<id returned for Lift maintenance contract>"]}`

func DiscoverProjectionsInitial(d *mapdoc.Document, colours string) string {
	var sb strings.Builder
	sb.WriteString("What the workspace is about:\n")
	if strings.TrimSpace(d.Narrative) == "" {
		sb.WriteString("(no narrative yet)\n")
	} else {
		sb.WriteString(strings.TrimSpace(d.Narrative) + "\n")
	}
	sb.WriteString("\n" + colours)
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
	DiscoverScopeRequired          = "give at least one of colourIds or sourceProjectionIds"
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

func DiscoverTooManyColours(limit int) string {
	return fmt.Sprintf("read_colour takes at most %d ids per call; the first %d were read.", limit, limit)
}

// DiscoverColourLine is one colour as the projections and reflections flows
// see it: the slice, what it is built on, and how much it holds.
type DiscoverColourLine struct {
	ID, Name    string
	ThingNames  []string
	Members     int
	First, Last string
}

func discoverColourHead(c DiscoverColourLine) string {
	var sb strings.Builder
	fmt.Fprintf(&sb, "%s · %s", c.ID, c.Name)
	if len(c.ThingNames) > 0 {
		fmt.Fprintf(&sb, " · built on %s", strings.Join(c.ThingNames, ", "))
	}
	fmt.Fprintf(&sb, " · %d fragments", c.Members)
	if c.First != "" {
		fmt.Fprintf(&sb, " · %s to %s", c.First, c.Last)
	}
	return sb.String()
}

func DiscoverColoursBlock(colours []DiscoverColourLine) string {
	var sb strings.Builder
	sb.WriteString("Colours (id · name · built on · fragments · span):\n")
	if len(colours) == 0 {
		sb.WriteString("(no colours yet)\n")
	}
	for _, c := range colours {
		sb.WriteString(discoverColourHead(c) + "\n")
	}
	return sb.String()
}

func DiscoverColourCard(c DiscoverColourLine, annotated int, timeline map[string]int, sample []DiscoverRow) string {
	var b strings.Builder
	b.WriteString(discoverColourHead(c) + "\n")
	if annotated == 0 {
		b.WriteString("None of its fragments is annotated yet.\n")
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
	fmt.Fprintf(&b, "Fragments (%d of %d, spread over time):\n", len(sample), annotated)
	for _, row := range sample {
		fmt.Fprintf(&b, "  %s · %s · %s (%s)\n", row.Date, row.Title, row.Summary, row.FragmentID)
	}
	return b.String()
}

func DiscoverColourCoverage(hit, total int, gaps []DiscoverGap) string {
	pct := 0
	if total > 0 {
		pct = hit * 100 / total
	}
	var b strings.Builder
	fmt.Fprintf(&b, "%d of %d annotated fragments (%d%%) sit inside an existing or proposed projection or reflection.\n", hit, total, pct)
	if len(gaps) == 0 {
		return b.String()
	}
	b.WriteString("Colours least covered:\n")
	for _, g := range gaps {
		fmt.Fprintf(&b, "  %s · %s · %d of %d fragments uncovered\n", g.ID, g.Name, g.Uncovered, g.Total)
	}
	return b.String()
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
	RhythmsToolDescription                     = "Recompute the rhythm cards at a grain: for every map thing, and every pair of things cited together, how many week or month buckets are active over the span, the date the steady run began (the onset), which existing colours cover its fragments, and a sample of bucket counts with a title each. Pass thingIds to restrict to those things (and the pairs they take part in). Free."
	RhythmsGrainParamDescription               = "\"week\" or \"month\": the bucket size to measure regularity at."
	RhythmsThingIDsParamDescription            = "Thing ids (or exact names) to restrict the cards to; omit for every thing above the floor."
	ProposeReflectionToolDescription           = "Propose one reflection for the user to review. Nothing is generated: the proposal is a name, an opening message, a scope, a cadence and a start date. The user opens it, the message is sent as their first turn in a chat that drafts the reflection's lens, and on finishing the series is generated one window per period from the start date to now. thingIds are the rhythm: the things on the card you are proposing from. colourIds are the scope: existing colours that cover that rhythm's fragments, growing as new material arrives. The colours must hold most of the rhythm's fragments, or the proposal is refused with the colours that would."
	ProposeReflectionThingIDsParamDescription  = "Thing ids (or exact names) the rhythm card is about: one thing, or the pair. Evidence only; the stored scope is the colours."
	ProposeReflectionColourIDsParamDescription = "Colour ids (or exact names) that scope the series: the colours on the card's cover line, usually the one built on the thing. Broader than the rhythm is fine; the cadence and your message narrow each period to the recurring activity. Give at least one."
	ProposeReflectionNameParamDescription      = "2-6 words, the reflection's title as the user will see it. Name the recurring activity, plainly: \"Weekly BC Tech newsletter\", \"Monthly Workspace invoice\"."
	ProposeReflectionMessageParamDescription   = "The opening message, 1-3 sentences, in the user's own voice as their standing instruction to the assistant that will write each period's summary: what to pull out of that period's material every time, what to emphasise, what to leave out. Say the cadence in it (\"Each week, ...\"). Never describe the proposal; write the instruction."
	ProposeCadenceParamDescription             = "How often a summary is produced and how much material each one covers: daily, weekly, monthly or quarterly. Pick the grain at which the rhythm card's buckets are steadily non-empty."
	ProposeStartTimeParamDescription           = "The date the rhythm began, YYYY-MM-DD: the onset on the rhythm card unless the sampled titles show the steady run started later. Every period from this date to now is summarised, so an earlier stray mention must not pull it back."
)

const DiscoverReflectionsSystem = `You are discovering reflections for a user who has just imported a body of material into their workspace. A reflection is a periodic summary: every week (or day, month, quarter) it summarises that period's material inside its scope, and the series of summaries is kept. It is worth having when something in the workspace recurs at a steady rhythm — a newsletter that arrives every week, invoices every month, a standing check-in with the same people, a report that lands on a schedule — and the user would want each period's account of it.

A projection is about a thing; a reflection is about a rhythm. You are looking for rhythms.

You do not create reflections. You propose them. A proposal is a name, an opening message, a scope, a cadence and a start date. The user sees the proposals, opens one, and the message is sent as their first turn in a chat that drafts the lens; on finishing, the series is generated from the start date to now. Nothing is generated until they open it, so a proposal costs nothing and a good set of proposals is the whole product of this run.

Rhythms are measured over map things, because that is where periodicity shows: for each thing, and each pair of things cited together, how many buckets of a grain are active over the span, when the steady run began, and a sample of bucket counts with a title each. A thing cited across most of the workspace is marked ubiquitous: it is the ever-present cast (the user, their own company), not a rhythm, and cannot be proposed on.

A scope is made of colours. A colour is a named slice of the workspace about a topic — a person, a company, a project — built on one or more map things; it holds every fragment about that topic and keeps growing as new material arrives, so a reflection scoped by colours keeps summarising each new period. Colours are topics, never rhythms: none stands for "the newsletter" or "the weekly sync", and this run makes no colours. Each rhythm card says which existing colours cover its fragments. You scope a proposal to those colours; the colour is broader than the rhythm on purpose, and the cadence and your message are what narrow each period's summary to the recurring activity. A rhythm no colour covers cannot be proposed in this run: say so at the end, so the user can make the colour and run again.

What you can see: the workspace map's narrative; the workspace as colours — each colour's id, name, the things it is built on, how many fragments it holds and over what span; and the rhythm cards.

Tools:
- rhythms: the rhythm cards at a grain (week or month), optionally restricted to given things. Free. Use the week grain to check whether something monthly is really weekly, and to confirm an onset.
- read_thing: a map thing in depth, by id or exact name — month-by-month counts, relationships, and sampled fragment titles and summaries with ids. Pass every thing you want in one call, up to ten.
- read_colour: a colour in depth — the things it is built on, month-by-month counts, and sampled fragment titles and summaries with ids.
- read_fragment: one fragment's full text. Budgeted; use it when a title leaves a real doubt about what recurs.
- list_existing: what exists already, with ids: colours, projections and reflections. Free. Always call it before proposing.
- coverage: what share of the workspace sits inside an existing or proposed projection or reflection, and which colours are least covered. Free.
- propose_reflection: propose one reflection.
- finish: end the run and say why.

Work in few turns: read what you need in one call, and propose several reflections in one turn once you have decided. Every id you pass must be real; a bad id comes back as an error message, and you can try again.`

const discoverReflectionsGuidance = `How to work:
1. Read the rhythm cards. A candidate is a thing (or pair) whose buckets are steadily non-empty over a sustained span: active close to span, at least a handful of periods. One burst of activity is not a rhythm; that is a projection's material, and this run leaves it alone.
2. For each candidate, name the activity that recurs. "The weekly BC Tech newsletter", "the monthly Google Workspace invoice", "the standing Legado check-in" are reflections. If all you can name is the cast — the same people keep appearing, but about different things each time — decide whether the user would want a periodic digest of that group; propose it only if so, and say so in the message. Use read_thing or the week-grain rhythms when the sampled titles do not settle it.
3. Call list_existing. Drop candidates already covered by a reflection. A projection on the same colour does not cover it: a projection is the standing account, a reflection is the period-by-period one.
4. Choose the cadence as the grain at which the buckets are steadily non-empty: a weekly newsletter is weekly even though the month grain is also full; monthly invoices are monthly. Choose the start date as the onset on the card unless the titles show the steady run began later.
5. Scope every proposal to the colours on the card's cover line — usually the one built on the thing, sometimes two together. Pass the card's things as thingIds. If the cover line says no colour covers it, do not propose it; name it at finish instead. Never propose on a ubiquitous thing or colour, and never a scope that is most of the workspace.
6. Call coverage when your candidates are done. Proposing nothing is a legitimate outcome: many workspaces have no rhythms worth a series.
7. Call finish, and say what you proposed, what you judged a burst rather than a rhythm, and which rhythms you left unproposed because no colour covers them.

Writing the message: it is the user's first chat turn, in their voice, addressed to the assistant that will write each period's summary. Say the cadence and what to pull out every time, and name the recurring activity so the summary stays on it even though the colour holds more: "Each week, summarise what the BC Tech newsletter covered: events, advocacy, and anything relevant to a small tech company in Vancouver." Not "This reflection tracks the newsletter."

Example:
{"name": "Weekly BC Tech newsletter", "message": "Each week, summarise what the BC Tech newsletter and event mailers covered: upcoming events with dates, advocacy positions, and anything a small Vancouver tech company should act on.", "thingIds": ["<id of the BC Tech thing>"], "colourIds": ["<id of the BC Tech colour>"], "cadence": "weekly", "startTime": "2025-01-15"}`

func DiscoverReflectionsInitial(d *mapdoc.Document, colours, rhythms string) string {
	var sb strings.Builder
	sb.WriteString("What the workspace is about:\n")
	if strings.TrimSpace(d.Narrative) == "" {
		sb.WriteString("(no narrative yet)\n")
	} else {
		sb.WriteString(strings.TrimSpace(d.Narrative) + "\n")
	}
	sb.WriteString("\n" + colours)
	sb.WriteString("\n" + rhythms)
	sb.WriteString("\n" + discoverReflectionsGuidance)
	return sb.String()
}

// DiscoverRhythmScope is one thing a rhythm card is about.
type DiscoverRhythmScope struct {
	ID   string
	Name string
}

type DiscoverBucket struct {
	Start string
	Count int
	Title string
}

// DiscoverCover is one colour's hold on a rhythm's fragments; Exact when the
// colour is built on the rhythm's things.
type DiscoverCover struct {
	ID      string
	Name    string
	Covered int
	Exact   bool
}

type DiscoverRhythm struct {
	Scopes      []DiscoverRhythmScope
	Grain       string
	Total       int
	Active      int
	Span        int
	First, Last string
	Onset       string
	Ubiquitous  bool
	Cover       string
	Buckets     []DiscoverBucket
}

func DiscoverRhythmsBlock(grain string, singles, pairs []DiscoverRhythm) string {
	var b strings.Builder
	fmt.Fprintf(&b, "Rhythms at the %s grain (things, most regular first):\n", grain)
	if len(singles) == 0 {
		b.WriteString("(no thing reaches the floor yet)\n")
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
	names := make([]string, 0, len(r.Scopes))
	for _, t := range r.Scopes {
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
	if r.Cover != "" {
		b.WriteString("  " + r.Cover + "\n")
	}
	for _, bk := range r.Buckets {
		fmt.Fprintf(&b, "  %s: %d · %s\n", bk.Start, bk.Count, bk.Title)
	}
	return b.String()
}

// DiscoverRhythmCover is a card's cover line: the colours holding the
// rhythm's fragments, or the fact that none does.
func DiscoverRhythmCover(covers []DiscoverCover, total, uncovered int) string {
	if len(covers) == 0 {
		return "no colour covers it: not proposable in this run"
	}
	parts := make([]string, 0, len(covers)+1)
	for _, cv := range covers {
		parts = append(parts, discoverCoverPart(cv, total))
	}
	if uncovered > 0 {
		parts = append(parts, fmt.Sprintf("%d in no colour", uncovered))
	}
	return "covered by: " + strings.Join(parts, " · ")
}

func discoverCoverPart(cv DiscoverCover, total int) string {
	if cv.Exact {
		return fmt.Sprintf("%s (%s, built on it) %d of %d", cv.Name, cv.ID, cv.Covered, total)
	}
	return fmt.Sprintf("%s (%s) %d of %d", cv.Name, cv.ID, cv.Covered, total)
}

func DiscoverProposedReflection(name, id string, fragments, held, total int, things []string, cadence, start string) string {
	return fmt.Sprintf("Proposed reflection %q (id: %s, %d fragments in scope, holding %d of %d about %s, %s from %s).",
		name, id, fragments, held, total, strings.Join(things, " with "), cadence, start)
}

// DiscoverScopeMissesRhythm refuses a scope that does not hold the rhythm it
// claims to be about, naming the colours that would.
func DiscoverScopeMissesRhythm(held, total int, things []string, covers []DiscoverCover) string {
	var b strings.Builder
	fmt.Fprintf(&b, "those colours hold %d of the %d fragments about %s; a scope must hold most of the rhythm", held, total, strings.Join(things, " with "))
	if len(covers) == 0 {
		b.WriteString(". No colour covers it, so it cannot be proposed in this run; name it at finish")
		return b.String()
	}
	parts := make([]string, 0, len(covers))
	for _, cv := range covers {
		parts = append(parts, discoverCoverPart(cv, total))
	}
	b.WriteString(". Colours that do: " + strings.Join(parts, " · "))
	return b.String()
}

const (
	DiscoverReflectionScopeRequired  = "give at least one colourId"
	DiscoverReflectionThingsRequired = "give the rhythm's things as thingIds"
)

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

func DiscoverUbiquitousColour(name, id string) string {
	return fmt.Sprintf("colour %s (%s) holds most of the workspace; that is the cast, not a rhythm, and it cannot be a scope on its own", name, id)
}

// Colours flow.

const CreateColourToolName = "create_colour"

const (
	CreateColourToolDescription          = "Create one colour: a named slice of the workspace built on one or more map things. Every fragment citing any of those things is a member, now and as new material arrives; no other matching runs. Colours are created for real, not proposed — the user renames, corrects or deletes them afterwards, so get the name and the things right."
	CreateColourNameParamDescription     = "1-4 words, the colour's name as the user will see it on every fragment it tags. Usually the thing's own name; otherwise the plain name of the slice."
	CreateColourThingIDsParamDescription = "Thing ids from the map. Usually one. Several only when they are the same slice under different names, or one slice the user would never split."
)

const DiscoverColoursSystem = `You are segmenting a workspace the user has just imported into colours. A colour is a named slice of the workspace: a tag that sits on every fragment about one thing the user would recognise at a glance — a client, a project, a property, a supplier, a recurring subject. Colours are how the user filters the workspace and how projections and reflections choose their context, so a good set is a handful of slices that between them cover most of the material without overlapping much.

You create colours for real; nothing is proposed. Each colour is built on one or more map things, and its members are the fragments citing those things. The user sees the colours immediately, renames or deletes what is wrong, and adds or removes fragments by hand; you cannot see or use their prompt-based colours' rules.

What you can see: the workspace map — a narrative saying what the workspace is about, a flat list of "things" (people, organisations, places, projects, topics) with how many fragments cite each and over what span, and relationships between them — and, through the tools, the annotated fragments behind any thing.

Tools:
- read_thing: things in depth — blurb, relationships, a month-by-month count of fragments, and a sample of fragment titles and summaries with ids. Pass every thing you want to see in one call, up to ten.
- read_fragment: one fragment's full text. Budgeted; use it when a summary leaves a real doubt.
- list_existing: what exists already, with ids, colours included. Free. Always call it before creating.
- coverage: what share of the workspace sits inside an existing colour or scope, and which heavy things are least covered. Free.
- create_colour: create one colour.
- finish: end the run and say why.

Work in few turns: read every thing you need to see in one read_thing call, and create several colours in one turn once you have decided. Every id you pass must be real; a bad id comes back as an error message, and you can try again.`

const discoverColoursGuidance = `How to work:
1. Read the narrative and the things list. Sketch six to twelve colours. Each is a slice the user would name unprompted: the client, the building, the project, the supplier, the subject that keeps coming back. Prefer things with many fragments over a long span; a thing cited a handful of times is not a slice.
2. Call list_existing. Never create a colour that duplicates one already there, whether a person made it or an earlier run did. Judge by what it is about, not by its name.
3. Skip the user themselves and their own organisation: a thing cited by most of the workspace is the workspace, not a slice, and create_colour rejects it.
4. Usually one thing per colour. Put several things in one colour only when they are the same slice under different names, or a slice the user would never split. Never make a colour that would hold most of the workspace.
5. Name plainly: the thing's own name, as the user writes it. No adjectives, no "related", no "and".
6. Call coverage when your set is done. Add a colour only if a heavy thing is uncovered and genuinely a slice. Leaving detritus uncoloured is correct: never colour what you would not be confident tagging.
7. Call finish, and say what you created, what you left out, and why.`

func DiscoverColoursInitial(d *mapdoc.Document, worklistFloor int) string {
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
	sb.WriteString("\n" + discoverColoursGuidance)
	return sb.String()
}

func DiscoverCreatedColour(name, id string, fragments int) string {
	return fmt.Sprintf("Created colour %q (id: %s, %d members).", name, id, fragments)
}

// DiscoverColourDescription is how an existing colour reads in list_existing:
// its prompt if it has one, and the things it is built on.
func DiscoverColourDescription(prompt string, thingNames []string) string {
	var parts []string
	if strings.TrimSpace(prompt) != "" {
		parts = append(parts, "prompt: "+strings.TrimSpace(prompt))
	}
	if len(thingNames) > 0 {
		parts = append(parts, "built on "+strings.Join(thingNames, ", "))
	}
	return strings.Join(parts, "; ")
}

const (
	DiscoverColourNameRequired   = "name is required"
	DiscoverColourThingsRequired = "give at least one thing id"
)
