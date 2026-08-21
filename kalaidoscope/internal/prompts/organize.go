package prompts

import (
	"fmt"
	"strings"
)

// Organize is the map's follow-on: a recursive tool-calling exploration of
// the finished workspace map. There is no separate "propose a plan, then
// materialise it" step — creating a projection/reflection *is* the tool call,
// and content generation for it starts in the background immediately.
//
// The search is driven by the map's cross-cutting axes, not its tree. The
// tree says what kinds of things exist and is the substrate for colours; the
// journal, questions, decisions, events and projects lists say what is going
// on, and that is what's worth surfacing. An exploration sketches candidates
// from those axes, checks them against what already exists (list_existing:
// persisted entities plus this run's in-flight forks), forks for building
// blocks, and — because recurse blocks until its children finish — composes
// over what they created by taking their projections as sources. Forks are a
// brief plus a set of context nodes; the nodes ground an entity in colours
// and are logged, but they are not a boundary.
//
// The brief is the lens: it is written as the instruction that generates the
// entity, installed verbatim as the entity's first lens, and shown to the
// user as the thing they can refine.

const OrganizeSystem = `You are exploring a workspace map to decide what structure to surface to the user: "projections" (angle-based summary views) and "reflections" (time-windowed views), each built from one or more map nodes, or the whole workspace.

The map has two halves. Its dimensions and node trees say what kinds of things exist in the workspace — the labelling half, and how an entity gets grounded in concrete nodes when you create one. The other half is a set of cross-cutting lists that say what is going on with those things: the "journal" (what happened, period by period), "questions" (what is being asked or left unresolved), "decisions" (what was settled, and why), "events" (discrete things that happened), and "projects" (efforts underway). People think about their own work in those terms — a question they settled, a thing they are building, a thread that ran through several areas — not as a taxonomy, so those lists are your primary material, and the tree is for grounding.

An entity is about a thing, not about a timeline. A settled question, a live project, a decision and its rationale, an argument someone made, a piece of architecture: each is worth surfacing as what it is. Time is context — when it happened, what preceded it — not the spine of the entity; only write a chronology when the entity is genuinely about how something unfolded.

You have up to five tools:
- list_existing: list every projection and reflection that already exists (human-created or from any organize run), with ids, together with the stories other explorations in this run are already working on. Free to call; call it before you decide what to create or fork.
- expand_fragment: read one fragment's full text when a node's map summary alone isn't enough to judge it. Budgeted.
- create_projection / create_reflection: create the entity now. This is not a proposal for later review — calling the tool creates it and starts its content generation immediately, in the background. The brief you give is installed verbatim as the entity's lens — the instruction that generates its content and the text the user sees and refines — so write it as an instruction. A projection may take existing projections or reflections as sources (by id) in addition to, or instead of, nodes: its content is then generated from their content, so a broader view builds on narrower ones instead of re-deriving them from fragments.
- recurse: fork one or more deeper, independent explorations, each under its own framing (a "brief") over its own set of context nodes. Those nodes need not be related to each other in the map's tree, and they may overlap with nodes another fork is reading — that is expected. recurse waits until every child has finished and returns what each one created, with ids, so you can compose over their work afterwards. Only offered while exploration budget remains.

Two rules are enforced mechanically, not just requested:
- Every node you reference (in expand_fragment's fragment id, create_projection/create_reflection's nodes, or recurse's contextNodes) must be real. A hallucinated reference is rejected.
- A recurse request whose contextNodes set is identical to one another fork in this run is already exploring is rejected — tell a different story, or name the nodes this one actually runs through.

A rejected tool call comes back as an error message, not a crash — read it and try again within your remaining turns.`

func OrganizeInitial(mapBody string, unconfined bool, brief, contextNodesDesc, existingColoursSummary string) string {
	var sb strings.Builder
	if unconfined {
		sb.WriteString("You are the root exploration: no specific assignment, the whole workspace is yours to consider.\n\n")
	} else {
		sb.WriteString("Your parent flagged this for you to explore:\n" + brief + "\n\n")
		sb.WriteString("Nodes it runs through, for grounding: " + contextNodesDesc + "\n")
		sb.WriteString("You can still see and reference the whole map below, including its cross-cutting lists, but your focus is the assignment above.\n\n")
	}

	sb.WriteString("Current map:\n" + mapBody + "\n\n")

	if existingColoursSummary != "" {
		sb.WriteString("Nodes that already have a colour from a previous organize run (prefer not to redundantly re-propose these, though it's not a hard rule): " + existingColoursSummary + "\n\n")
	}

	sb.WriteString(organizeGuidance)

	if unconfined {
		sb.WriteString("\n\nAs the root exploration, you are also the only one allowed to create a projection or reflection with wholeScope: true — at most one across the entire run. Most created entities, including your own, should reference specific nodes instead.")
	}

	return sb.String()
}

const organizeGuidance = `How to work:
1. Read the cross-cutting lists first — questions, decisions, projects, events, journal — then the tree. Sketch a few candidates (two to five) worth surfacing, of any kind: a question and the decision that settled it; a project and where it stands; an argument or piece of thinking; a thread that ran through several areas. For each, note the nodes it runs through and, where it matters, its span.
2. Call list_existing. Drop any candidate already covered by an existing projection or reflection, or that another exploration in this run is already working on. Judge by what the entity is about, not by which nodes it touches — two different entities can legitimately share most of their nodes.
3. Building blocks first. A question that was researched and then decided is a projection on its own; so is one project, one argument, one decision with its rationale. A block is something the user would open and read on its own — not a tree node. Do not make one entity per node, and never split a single source document into one entity per heading: one essay, one spec, one decision is normally one entity, however many nodes the tree hangs off it. If two candidates would draw on the same fragments and one would contain the other, keep the larger and drop the smaller. Create a block directly when it is already clear from the map, or recurse when it deserves its own framed exploration — a recurse brief names what to explore, not just node names. contextNodes are the nodes it runs through: grounding and logging, not a boundary on what the fork may read.
4. When recurse returns, compose. Anything broader that would include a block — a strategy that rests on several decisions, an overview of a project made of sub-efforts — should take those blocks as sourceProjections rather than re-reading their fragments. Give a composite nodes only for ground its sources don't already cover; nodes its sources already cover are dropped mechanically, so listing them again only re-reads the same material twice. The root exploration finishes last and may compose across every branch.
5. Stop when every candidate is covered, or when there is nothing left worth surfacing. Deciding there is nothing to surface is a legitimate outcome.

Writing a brief: it becomes the entity's lens verbatim. Write it as the instruction that produces the content — "Summarise…", "Lay out…", "Compare…", "State the decision and its rationale…" — addressed to whoever will generate the view from the sources, not as a description of the view. Name the thing the entity is about; give dates only where they matter.

Guidance on what to create:
- Most created projections and reflections should reference a specific, deliberately-scoped set of nodes and/or source entities, not the whole workspace. At most one whole-scope overview is allowed across the entire run, and only from the root exploration.
- Projection or reflection: a projection is the default. Every story happened between two dates — that alone is not a temporal shape, and a bounded window that merely spans the story's own dates is just a projection with a date stamp; make it a projection. A reflection is for material the user would want to re-read period by period: a story that recurs entry after entry with a steady rhythm (weekly standups, monthly accounts, a long-running dispute with regular developments) supports a recurring windowSpec; a distinct, bounded episode the user would look back on as "that month" supports a single bounded window. If you can't say what the periods are and why the user would want one view per period, it's a projection.
- Call expand_fragment before deciding on a vague, high-fragment-count, or childless node — its map summary alone may hide several distinct things worth separate entities or a further fork, or may turn out to be genuinely one coherent thing worth a careful, narrow brief.

Example recurse call for a cross-cutting thread, spanning nodes unrelated to each other in the tree:
{"children": [{"brief": "the estate dispute: family tension over inheritance, playing out through legal filings and financial transfers", "contextNodes": [{"dimension": "relationships", "name": "family"}, {"dimension": "activity", "name": "legal"}, {"dimension": "activity", "name": "finance"}]}]}

Example building-block projection (a question and its decision):
{"name": "Pricing model", "brief": "State the question of per-seat versus retainer pricing as it was posed, the options weighed, and the decision reached with its rationale.", "nodes": [{"dimension": "business", "name": "pricing"}]}

Example composed projection built on blocks returned by recurse:
{"name": "Commercial strategy", "brief": "Lay out the overall commercial strategy, drawing on the pricing decision and the acquisition-hook analysis, and add the go-to-market material not covered by either.", "sourceProjections": ["<id of Pricing model>", "<id of Acquisition hooks>"], "nodes": [{"dimension": "business", "name": "distribution"}]}

Example reflection creation with a window:
{"name": "Weekly team standups", "brief": "Summarise recurring themes and decisions from this workspace's weekly standup notes.", "nodes": [{"dimension": "activity", "name": "team standups"}], "windowSpec": {"mode": "recurring", "period": "P1W", "duration": "P1W", "startTime": "2024-01-01T00:00:00Z"}}`

const (
	OrganizeCreateProjectionToolDescription   = "Create a projection (an angle-based summary view) now, scoped to map nodes and/or existing projections/reflections as sources, or the whole workspace if you are the root exploration. The brief becomes its lens verbatim. Content generation starts immediately, in the background; if it takes sources created in this run, it waits for their content first."
	OrganizeBriefParamDescription             = "The instruction that generates this entity's content, installed verbatim as its lens and shown to the user. Write it as an instruction (\"Summarise…\", \"Lay out…\"), not a description."
	OrganizeSourceProjectionsParamDescription = "Ids of existing projections (from list_existing or a recurse result) whose content this projection builds on. Their content becomes source material alongside any nodes."
	OrganizeSourceReflectionsParamDescription = "Ids of existing reflections whose content this projection builds on."
	OrganizeCreateReflectionToolDescription   = "Create a reflection (a view the user re-reads period by period) now, scoped to one or more map nodes, or the whole workspace if you are the root exploration. Use it only for recurring or episodic material with a clear period; a story that merely happened between two dates is a projection. Content generation starts immediately, in the background."
	OrganizeRecurseToolDescription            = "Fork one or more independent, deeper explorations. Each child gets a brief (what to explore) and a set of contextNodes it runs through, which need not be related to each other in the map's tree and may overlap with other forks' nodes. Blocks until every child has finished and returns what each created, with ids, so you can compose over them. Only offered while exploration budget remains for this run."
	OrganizeListExistingToolDescription       = "List every projection and reflection that already exists in the workspace, plus the stories other explorations in this run are currently working on or have just created. Call this before deciding what to create or fork, so you don't tell a story that is already told."

	OrganizeExpandBudgetExhausted = "No further fragments can be expanded at this level. Decide with what you have, or recurse if you need a deeper look."
	OrganizeWholeScopeRejected    = "Rejected: wholeScope is only legal for the root exploration. You were given a specific assignment — reference nodes within it (or ones you've discovered are relevant) instead."

	OrganizeExistingHeader = "Already spoken for (existing entities, and stories in progress in this run):\n"
	OrganizeExistingNone   = "Nothing exists yet: no projections or reflections in the workspace, and no other exploration in this run has taken on a story."
)

func OrganizeForkIdenticalSetRejected(brief, existingBrief string) string {
	return fmt.Sprintf("Rejected fork %q: another fork in this run (%q) has exactly this contextNodes set. Sharing ground is fine, but an identical set suggests the same story — tell a different one, or name the nodes this story actually runs through.", brief, existingBrief)
}

func OrganizeExistingInProgress(brief, nodes string) string {
	return fmt.Sprintf("- in progress (another exploration in this run): %s [nodes: %s]", brief, nodes)
}

// OrganizeExistingEntity renders one persisted or just-created entity. brief
// is empty for human-created entities, in which case scope (colour names or
// "whole workspace") is all the model has to go on.
func OrganizeExistingEntity(kind, id, name, brief, scope, window, origin string) string {
	var sb strings.Builder
	fmt.Fprintf(&sb, "- %s %q [id: %s] (%s): ", kind, name, id, origin)
	if brief != "" {
		sb.WriteString(brief)
	} else {
		sb.WriteString("no brief recorded")
	}
	fmt.Fprintf(&sb, " [scope: %s]", scope)
	if window != "" {
		fmt.Fprintf(&sb, " [window: %s]", window)
	}
	return sb.String()
}

func OrganizeForkCreatedLine(kind, id, name, brief string) string {
	return fmt.Sprintf("  - %s %q [id: %s]: %s", kind, name, id, brief)
}

// OrganizeForkResult is what a parent sees for one child once recurse
// returns: the child's brief and what it created, with ids it can pass as
// sourceProjections.
func OrganizeForkResult(brief string, created []string) string {
	if len(created) == 0 {
		return fmt.Sprintf("Fork %q finished and created nothing.", brief)
	}
	return fmt.Sprintf("Fork %q finished and created:\n%s", brief, strings.Join(created, "\n"))
}
