package prompts

import "strings"

// Organize is the map's follow-on: a recursive tool-calling exploration of
// the finished workspace map. There is no separate "propose a plan, then
// materialise it" step — creating a projection/reflection *is* the tool call,
// and content generation for it starts in the background immediately.
// Forking (the recurse tool) is not tree-subtree confinement: a fork is a
// brief plus an explicit set of context nodes that need not share a common
// ancestor, because the narratives worth surfacing are often cross-cutting in
// exactly that way. Every level, including root, gets the whole map and the
// same tool palette.

const OrganizeSystem = `You are exploring a workspace map to decide what structure to surface to the user: "projections" (angle-based summary views) and "reflections" (time-windowed views), each built from one or more map nodes, or the whole workspace.

You have up to four tools:
- expand_fragment: read one fragment's full text when a node's map summary alone isn't enough to judge it. Budgeted.
- create_projection / create_reflection: create the entity now. This is not a proposal for later review — calling the tool creates it and starts its content generation immediately, in the background.
- recurse: fork one or more deeper, independent explorations, each under its own framing (a "brief") over its own set of nodes. Those nodes need not be related to each other in the map's tree — a cross-cutting narrative often touches nodes that share no common ancestor. Only offered while exploration budget remains.

Two rules are enforced mechanically, not just requested:
- Every node you reference (in expand_fragment's fragment id, create_projection/create_reflection's nodes, or recurse's contextNodes) must be real. A hallucinated reference is rejected.
- A recurse request whose contextNodes overlap too heavily with another fork already exploring that ground — anywhere in this run, not just among your own siblings — is rejected.

A rejected tool call comes back as an error message, not a crash — read it and try again within your remaining turns.`

func OrganizeInitial(mapBody string, unconfined bool, brief, contextNodesDesc, existingColoursSummary string) string {
	var sb strings.Builder
	if unconfined {
		sb.WriteString("You are the root exploration: no specific assignment, the whole workspace is yours to consider.\n\n")
	} else {
		sb.WriteString("Your parent flagged this angle for you to explore:\n" + brief + "\n\n")
		sb.WriteString("Nodes flagged as your specific focus: " + contextNodesDesc + "\n")
		sb.WriteString("You can still see and reference the whole map below for context, but your focus is the angle above.\n\n")
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

const organizeGuidance = `Guidance:
- Most created projections and reflections should reference a specific, deliberately-scoped set of nodes, not the whole workspace. At most one whole-scope overview is allowed across the entire run, and only from the root exploration.
- Reflections need a temporal shape to be worth creating: only give one a windowSpec where the underlying material's time distribution clearly supports it (e.g. a node whose first_seen/last_seen span and fragment volume show real recurring activity). Not every reflection needs a window, but consider it — don't default every entity to a projection.
- Call expand_fragment before deciding on a vague, high-fragment-count, or childless node — its map summary alone may hide several distinct things worth splitting into separate entities or a further fork, or may turn out to be genuinely one coherent thing worth a careful, narrow brief.
- Use recurse when a distinct angle or thread — whether within one node, or cutting across several nodes that share no common ancestor — deserves its own framed exploration. Write a real brief explaining the angle; don't just hand down bare node names. Prefer a tight, deliberately-scoped contextNodes set: an overly broad or heavily-overlapping one will be rejected.
- Resolve directly (create something, or decide there's nothing worth surfacing) when a node or set of nodes is already clear enough from the map and doesn't need deeper reading or its own fork.

Example recurse call showing a cross-cutting angle, spanning nodes unrelated to each other in the tree:
{"children": [{"brief": "the estate-dispute thread: family tension over inheritance, playing out through legal filings and financial transfers", "contextNodes": [{"dimension": "relationships", "name": "family"}, {"dimension": "activity", "name": "legal"}, {"dimension": "activity", "name": "finance"}]}]}

Example reflection creation with a window:
{"name": "Weekly team standups", "brief": "Summarise recurring themes and decisions from this workspace's weekly standup notes.", "nodes": [{"dimension": "activity", "name": "team standups"}], "windowSpec": {"mode": "recurring", "period": "P1W", "duration": "P1W", "startTime": "2024-01-01T00:00:00Z"}}`

const (
	OrganizeCreateProjectionToolDescription = "Create a projection (an angle-based summary view) now, scoped to one or more map nodes, or the whole workspace if you are the root exploration. Content generation starts immediately, in the background."
	OrganizeCreateReflectionToolDescription = "Create a reflection (a time-windowed view) now, scoped to one or more map nodes, or the whole workspace if you are the root exploration. Only give it a windowSpec where the material's time distribution clearly supports one. Content generation starts immediately, in the background."
	OrganizeRecurseToolDescription          = "Fork one or more independent, deeper explorations. Each child gets a brief (the angle or framing to explore) and a set of contextNodes to focus on, which need not be related to each other in the map's tree. Only offered while exploration budget remains for this run."

	OrganizeExpandBudgetExhausted = "No further fragments can be expanded at this level. Decide with what you have, or recurse if you need a deeper look."
	OrganizeWholeScopeRejected    = "Rejected: wholeScope is only legal for the root exploration. You were given a specific assignment — reference nodes within it (or ones you've discovered are relevant) instead."
)
