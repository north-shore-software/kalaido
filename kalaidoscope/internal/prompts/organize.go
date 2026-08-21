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
// The search is narrative-driven, not tree-driven. The map's tree says what
// kinds of things exist and is the substrate for colours; the map's journal
// (time-ordered reporter-voice entries) is where the stories are. An
// exploration sketches candidate stories from the journal, checks them
// against what already exists (list_existing: persisted entities plus this
// run's in-flight forks), and recurses only on stories nobody has taken.
// Forks are a brief plus a set of context nodes; the nodes ground the story
// in colours and are logged, but they are not a boundary — several forks
// reading the same map ground is expected for cross-cutting stories.

const OrganizeSystem = `You are exploring a workspace map to decide what structure to surface to the user: "projections" (angle-based summary views) and "reflections" (time-windowed views), each built from one or more map nodes, or the whole workspace.

The map has two halves. Its dimensions and node trees say what kinds of things exist in the workspace — that is the labelling half, and it is how an entity gets grounded in concrete nodes when you create one. Its "journal" is a time-ordered run of short reporter-voice entries about what actually happened — that is where the stories are. People think about their own work as stories that run through time and cut across many areas at once, not as a taxonomy, so the stories are what you are looking for, and the journal is your primary material for finding them.

You have up to five tools:
- list_existing: list every projection and reflection that already exists (human-created or from any organize run) together with the stories other explorations in this run are already working on. Free to call; call it before you decide what to create or fork.
- expand_fragment: read one fragment's full text when a node's map summary alone isn't enough to judge it. Budgeted.
- create_projection / create_reflection: create the entity now. This is not a proposal for later review — calling the tool creates it and starts its content generation immediately, in the background.
- recurse: fork one or more deeper, independent explorations, each under its own framing (a "brief") over its own set of context nodes. Those nodes need not be related to each other in the map's tree, and they may overlap with nodes another fork is reading — that is expected, since different stories run through the same ground. Only offered while exploration budget remains.

Two rules are enforced mechanically, not just requested:
- Every node you reference (in expand_fragment's fragment id, create_projection/create_reflection's nodes, or recurse's contextNodes) must be real. A hallucinated reference is rejected.
- A recurse request whose contextNodes set is identical to one another fork in this run is already exploring is rejected — tell a different story, or name the nodes this one actually runs through.

A rejected tool call comes back as an error message, not a crash — read it and try again within your remaining turns.`

func OrganizeInitial(mapBody string, unconfined bool, brief, contextNodesDesc, existingColoursSummary string) string {
	var sb strings.Builder
	if unconfined {
		sb.WriteString("You are the root exploration: no specific assignment, the whole workspace is yours to consider.\n\n")
	} else {
		sb.WriteString("Your parent flagged this story for you to explore:\n" + brief + "\n\n")
		sb.WriteString("Nodes the story runs through, for grounding: " + contextNodesDesc + "\n")
		sb.WriteString("You can still see and reference the whole map below, including its journal, but your focus is the story above.\n\n")
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
1. Read the journal first. Sketch a few candidate stories (two to five) worth surfacing — each a narrative that runs through time, usually cutting across several nodes, often across dimensions. For each, note roughly which period of the journal it spans and which nodes it runs through.
2. Call list_existing. Drop any candidate that is already told by an existing projection or reflection, or that another exploration in this run is already working on. Judge this by the story, not by which nodes it touches — two different stories can legitimately share most of their nodes.
3. For each surviving candidate: create it directly when the story is already clear from the map, or recurse when it deserves its own framed exploration. A recurse brief must name the story and its time span, not just hand down node names. contextNodes are the nodes the story runs through — they ground the entity in colours and are logged, they are not a boundary on what the fork may read.
4. Stop when every candidate is covered, or when there is nothing left worth telling. Deciding there is nothing to surface is a legitimate outcome.

Guidance on what to create:
- Most created projections and reflections should reference a specific, deliberately-scoped set of nodes, not the whole workspace. At most one whole-scope overview is allowed across the entire run, and only from the root exploration.
- Projection or reflection: a projection is the default. Every story happened between two dates — that alone is not a temporal shape, and a bounded window that merely spans the story's own dates is just a projection with a date stamp; make it a projection. A reflection is for material the user would want to re-read period by period: a story that recurs entry after entry with a steady rhythm (weekly standups, monthly accounts, a long-running dispute with regular developments) supports a recurring windowSpec; a distinct, bounded episode the user would look back on as "that month" supports a single bounded window. If you can't say what the periods are and why the user would want one view per period, it's a projection.
- Call expand_fragment before deciding on a vague, high-fragment-count, or childless node — its map summary alone may hide several distinct things worth separate entities or a further fork, or may turn out to be genuinely one coherent thing worth a careful, narrow brief.

Example recurse call for a cross-cutting story, spanning nodes unrelated to each other in the tree:
{"children": [{"brief": "the estate dispute, spring 2023 to early 2024: family tension over inheritance, playing out through legal filings and financial transfers", "contextNodes": [{"dimension": "relationships", "name": "family"}, {"dimension": "activity", "name": "legal"}, {"dimension": "activity", "name": "finance"}]}]}

Example reflection creation with a window:
{"name": "Weekly team standups", "brief": "Summarise recurring themes and decisions from this workspace's weekly standup notes.", "nodes": [{"dimension": "activity", "name": "team standups"}], "windowSpec": {"mode": "recurring", "period": "P1W", "duration": "P1W", "startTime": "2024-01-01T00:00:00Z"}}`

const (
	OrganizeCreateProjectionToolDescription = "Create a projection (an angle-based summary view) now, scoped to one or more map nodes, or the whole workspace if you are the root exploration. Content generation starts immediately, in the background."
	OrganizeCreateReflectionToolDescription = "Create a reflection (a view the user re-reads period by period) now, scoped to one or more map nodes, or the whole workspace if you are the root exploration. Use it only for recurring or episodic material with a clear period; a story that merely happened between two dates is a projection. Content generation starts immediately, in the background."
	OrganizeRecurseToolDescription          = "Fork one or more independent, deeper explorations. Each child gets a brief (the story to explore and its time span) and a set of contextNodes the story runs through, which need not be related to each other in the map's tree and may overlap with other forks' nodes. Only offered while exploration budget remains for this run."
	OrganizeListExistingToolDescription     = "List every projection and reflection that already exists in the workspace, plus the stories other explorations in this run are currently working on or have just created. Call this before deciding what to create or fork, so you don't tell a story that is already told."

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
func OrganizeExistingEntity(kind, name, brief, scope, window, origin string) string {
	var sb strings.Builder
	fmt.Fprintf(&sb, "- %s %q (%s): ", kind, name, origin)
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
