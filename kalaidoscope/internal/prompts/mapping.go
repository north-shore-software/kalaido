package prompts

// The workspace map algorithm, for humans (the prompts below are the source of truth; this is a
// summary, not a spec):
//  1. Map = dimensions (independent axes), each holding a tree of nodes (broad -> narrow), plus
//     entities/relationships/narrative.
//  2. A node is one coherent point; fragments attach at any level, never double-counted — child
//     totals are never rolled into a parent's own count.
//  3. Purity: if a node's description needs "and" or lists several distinct things, split it into
//     children, regardless of duration or how related the parts seem.
//  4. Children are cheap to create, even from a single fragment — a thin, genuinely recurring
//     topic never looks significant in any one incorporation pass, so waiting for it to "earn" a
//     child means it never gets one.
//  5. Childless nodes that stay thin and go stale (no recent material relative to what's
//     currently being processed) get folded back into their parent — this prunes one-off mentions.
//  6. Hard cap: no node may sit more than 5 levels below its dimension root; a distinction that
//     would need a 6th level stays as prose in the deepest allowed node instead.
//  7. Duration/breadth trade-off: the longer a node has been open, the narrower its own directly-
//     attached material must be to still justify that span.
//  8. Breadth cap of roughly 3-8 children per node/dimension, judged in steady state after
//     pruning, not per incorporation pass.
//  9. Incorporation always walks down to the most specific existing node that genuinely fits,
//     across every dimension that plausibly applies — never force-fit onto a loosely-related node.
//  10. Two-stage pipeline: markup annotates each fragment against the current map (proposing
//     nodes/dimensions), then incorporate folds annotated batches into the map, occasionally
//     expanding a fragment's full text via tool call when its annotation is too thin to place.
//  11. Journal: alongside the tree, the map keeps a time-ordered journal of short reporter-voice
//     entries (headlines + a short story per period) covering what happened in the workspace's
//     "world". Period grain follows the material's density; entries are edited in place as a
//     story moves on. The tree is for labelling; the journal is the narrative/time axis that
//     organize reads to find stories worth surfacing.
//  12. Four more cross-cutting lists sit beside the journal — questions, decisions, events,
//     projects — each a Thread {title, summary, from, to, status, nodes}. Same maintenance
//     rules as the journal (edit in place, add only for the new, never drop what's still
//     supported). Together with the journal they are organize's raw material; the tree is
//     grounding.

import (
	"encoding/json"
	"fmt"
	"strings"
)

const MapSchemaDescription = `The map is a single JSON object with this exact shape:
{
  "dimensions": [{"name": string, "description": string, "nodes": [Node]}],
  "entities": [{"name": string, "kind": string, "notes": string}],
  "relationships": [{"from": string, "to": string, "kind": string}],
  "narrative": string,
  "journal": [{"from": "YYYY-MM-DD", "to": "YYYY-MM-DD", "headlines": [string], "story": string}],
  "questions": [Thread], "decisions": [Thread], "events": [Thread], "projects": [Thread]
}
A Node is {"name": string, "description": string, "aliases": [string], "fragments": number, "exemplar_ids": [string], "first_seen": string, "last_seen": string, "children": [Node]}.
A Thread is {"title": string, "summary": string, "from": "YYYY-MM-DD", "to": "YYYY-MM-DD", "status": string, "nodes": [{"dimension": string, "name": string}]}.

A "dimension" is one independent axis along which the workspace's fragments vary — for example, what kind of activity a fragment represents, versus what tool or vendor it concerns, versus which external relationship it belongs to. Two fragments can share a node on one dimension while differing completely on another. Illustrative, non-exhaustive examples of dimensions: what kind of activity this is; what tool, product, or subject matter is involved; which external relationship (client, partner, contact) it belongs to. The actual dimensions must be discovered from the material at hand, not assumed — a workspace's real axes of variation may be nothing like these examples. Most workspaces settle around 3-8 dimensions: don't spin up a new one for a single passing distinction, but don't force unrelated material onto one that doesn't truly fit either.

Each dimension holds a tree of nodes, not a flat list. A node must be a single coherent point on its dimension — broad enough to cover many fragments, specific enough to mean something — but it may have "children" that break it into narrower sub-points, to whatever depth it earns (see below). A fragment can attach directly to any node, leaf or not: something only generically about a node's topic belongs on the node itself, not forced down into a child. "fragments" on a node counts only what is attached directly there, never its descendants — a subtree's total is always just the node's own count plus its children's, summed recursively by whoever reads the map; never fold a child's count into its parent's number.

If a node's own description needs "and" to join two unrelated concerns, or lists several distinct things (several different tools, systems, physical assets, or categories of concern), it is not one node any more, no matter how long it has held together or how naturally its parts seem related — a shared actor, project, or counterparty running through everything is not by itself grounds to keep concerns fused. Give it children: one per distinct thing the description was listing. Don't reprocess or reassign what the parent has already counted — those fragments stay attributed at the coarser level; only new material needs to choose a child from now on. The same breadth guidance as dimensions applies to a node's children (most nodes that split settle around 3-8 children, once dead ends have had a chance to be pruned — see below): too many surviving long-term is a sign some should be merged back into fewer, coarser ones.

Create a child as soon as a fragment shows a genuinely distinct, nameable sub-pattern within a node — even from a single fragment. Don't wait for it to prove itself first: a real recurring topic that arrives thinly, one or two fragments at a time across many separate incorporation passes, will never look like a meaningful share of its parent in any single pass, so waiting for that signal means it never gets created at all, no matter how much it eventually accumulates. The cost of creating early is low, because of the check below — a node that never earns its place quietly disappears again.

Each time you touch a dimension's tree, also check its existing childless nodes for dead ends: if a node has no children of its own, has stayed at only a handful of fragments, and its "last_seen" sits far behind the event time of the material you are processing now with nothing recent reinforcing it, fold it back — add its fragment count and exemplar_ids into its parent, keep what it was about as a passing mention in the parent's own description only if it still seems worth remembering, and remove the node. A node that keeps getting new material survives this indefinitely, however thin each individual addition was on its own; only genuinely one-off topics get pruned.

That expiry check only prunes dead ends — a topic that keeps getting real, recurring reinforcement could otherwise keep earning deeper and deeper children forever. So treat depth itself as capped, full stop: no node may sit more than 5 levels below its dimension root. If new material would need a 6th level to stay pure, do not create it — name the distinction in the deepest allowed node's own description instead, the same way you would below the bar to create at all. A dimension whose tree keeps pressing against that cap usually means the material wants a dimension of its own alongside this one, not another layer.

Duration and breadth trade off against each other at every level, the same way: the longer a node's "first_seen" to "last_seen" span grows, the narrower and more focused its own material (what's attached directly to it, not what's pushed into children) needs to be to still earn that span, relative to its siblings. A node open a long time is not by itself a problem — a single long-running negotiation or relationship can legitimately span years while staying narrow — but a node that has been open a long time and is still broad at its own level is not a stable, enduring topic, it is a container that was never given children when it should have been.

Never fold a fragment onto an existing node just because it loosely fits — check every existing dimension against new material, and within each, walk down to the most specific node that genuinely applies. If it shows a pattern of variation nothing in the tree captures, add a new node or a new dimension alongside what's already there, in addition to (never instead of) the existing ones. Most fragments touch more than one dimension at once and should end up tagged in each dimension that plausibly applies to them, not just whichever single node fits best overall.

"entities" are the recurring people, organisations, places, and projects. "kind" is one of "person", "organisation", "place", "project", or "other". "relationships" connect two node or entity names with a short "kind" such as "part of", "works on", or "related". "narrative" is your own running account of what this workspace is about and how it is developing over time.

"journal" is the map's time axis, and it is deliberately not a restatement of the tree. Treat the workspace's contents as what has happened in a "world", and write each entry as a tabloid or magazine reporter covering that world's events during one period: a few "headlines" and/or a "story" — short, focused, about what happened and what developed, who did what, what changed. The tree says what kinds of things exist; the journal says what actually went on, in the order it went on.

Each entry covers one period, "from" and "to" inclusive. Choose the period grain to fit the material's density, not a fixed calendar unit: a busy week earns its own entry, a quiet stretch can be one entry spanning a month or more, and the grain may vary along the journal. Keep entries in "from" order and non-overlapping. Keep each one short — at most about five headlines and a story of roughly 80 words — so the journal stays small even on a workspace spanning many years. An entry must account for its whole period: every node whose "first_seen" or "last_seen" falls inside it appeared or moved then, and an entry that mentions none of that is incomplete — a busy period with many new nodes is the one that most needs its entry to say so.

Edit entries in place. When new material continues a story that already has an entry — including late-arriving material for an earlier period — rewrite that entry to reflect where the story now stands, rather than adding a second partial account of the same thing alongside it. Add a new entry only for a period nothing yet covers, or split an entry when its period turns out to hold more than one dense stretch. Never drop an entry that earlier material still supports.

"questions", "decisions", "events" and "projects" are four more cross-cutting lists, kept alongside the journal and, like it, deliberately not a restatement of the tree. The tree says what kinds of things exist; these say what is going on with them, and one item usually runs through several nodes, often across dimensions:
- "questions": things being asked, researched, or left unresolved — a question the material keeps circling. "status" is "open" or "answered"; once answered, the summary names the decision that answered it.
- "decisions": commitments made — what was settled, and in one clause why. "status" is "decided" or "reversed".
- "events": discrete things that happened — a launch, a meeting, a failure, an arrival, a deadline passed. Leave "status" empty.
- "projects": creative or constructive efforts underway — something being built, written, or pursued over time, as opposed to a topic that merely exists. "status" is "active", "paused", or "done".
Each Thread has a short "title", a "summary" of roughly 40 words, "from"/"to" for the span the material supports, and "nodes": the real tree nodes it runs through, by dimension and exact node name. Maintain all four lists the way the journal is maintained: edit an item in place when new material moves it on (a question gets answered, a project pauses, a decision is reversed, an event gains its outcome); add an item only for something genuinely new; fold near-duplicates into one; keep each short; never drop an item earlier material still supports. Keep each list in "from" order.`

const emptyMapNotice = "The map is empty so far: this is the first material ever added to the workspace."

func mapStateBlock(mapBody string) string {
	if strings.TrimSpace(mapBody) == "" || mapBody == "{}" || mapBody == "null" {
		return emptyMapNotice
	}
	return "Current map:\n" + mapBody
}

func MapMarkupPrompt(mapBody, fragmentBlock string) string {
	return `You are annotating one fragment from a user's personal workspace so it can be folded into the workspace map: a living index of the workspace's dimensions (independent axes like what kind of activity, what tool/subject, which relationship), each holding a tree of nodes from broad topics down to narrow ones, plus entities, and story.

` + mapStateBlock(mapBody) + `

Fragment:
` + fragmentBlock + `
Write a JSON object with exactly these keys:
{"summary": string, "nodes": [{"node": string, "dimension": string}], "entities": [string]}

- "summary": if the fragment is long, a dense summary of its content in at most 150 words; if it is short, a one-sentence reading of what it is about and why it likely exists.
- "nodes": one entry per dimension in the current map that plausibly applies to this fragment — most fragments touch more than one dimension, so check them all rather than stopping at the first one that feels sufficient. For each, prefer the exact "name" of the most specific existing node within that dimension's tree that genuinely fits (walk down into children where they exist); if only a coarser node truly applies, use that rather than forcing a child. Propose a new short node name, and the dimension it belongs to (an existing dimension's name, or a new one), only when nothing in the map covers it.
- "entities": the people, organisations, places, or projects the fragment mentions, using existing map entity names where they match.

Reply with only the JSON object.`
}

func MapIncorporatePrompt(mapBody, inputBlock string) string {
	return `You maintain the map of a user's personal workspace: a living index of its dimensions (each a tree of nodes from broad topics down to narrow ones), entities, relationships, and story.

` + MapSchemaDescription + `

` + mapStateBlock(mapBody) + `

New material, in event-time order:
` + inputBlock + `
Update the map to incorporate the new material:
- Only add and refine. Never drop a dimension, node, or entity that earlier material still supports; fold spelling and naming variants into "aliases" instead of creating near-duplicate nodes.
- Keep every node at a useful grain: broad enough that it covers a meaningful share of its parent's material, specific enough to mean something, and never a fusion of unrelated concerns — give it children instead. This applies to existing nodes as new material lands on them, not just when creating new ones: check whether a node is still one point or has quietly become several, and split off a child as soon as a distinct sub-pattern shows itself, even from a single fragment. In the same pass, check existing childless nodes for dead ends: ones that have stayed thin, gained no children, and seen nothing recent relative to the material you're processing now — fold those back into their parent rather than leaving them cluttering the tree.
- Check the new material against every existing dimension, not just the one that first comes to mind, and within each, walk down to the most specific node that genuinely fits. If it shows a pattern of variation nothing in the tree captures, add a new node or dimension alongside what's already there — don't force it onto something it doesn't truly belong to.
- Update "fragments" counts, "exemplar_ids" (keep the most representative, at most 5), and "first_seen"/"last_seen" dates — only on the node(s) the material actually attaches to directly, never on their ancestors.
- Keep "narrative" a concise account of the whole space and how it has developed. Rewrite it freely, but keep it under 300 words.
- Update "journal" for the periods the new material spans, in a reporter's voice: extend or rewrite the existing entry for a period the new material continues, and add entries only for periods nothing yet covers. Choose period grain from the density of the material, keep every entry short, and keep the list in "from" order with no overlaps.
- Update "questions", "decisions", "events" and "projects" for the new material: move existing items on (answered, reversed, paused, done) before adding new ones, and point each item at the real nodes it runs through.
- If an annotation is too thin to place confidently, call expand_fragment with that fragment's ID to read its full text before deciding.

Reply with only the complete updated map JSON object.`
}

func AnnotationBlock(fragType, id, eventTime, annotation string) string {
	return fmt.Sprintf("--- annotation of %s fragment (ID: %s, event time: %s) ---\n%s\n\n", fragType, id, eventTime, annotation)
}

const (
	ExpandFragmentToolName         = "expand_fragment"
	ExpandFragmentToolDescription  = "Fetch the full text of one fragment from the new material when its annotation is not enough to update the map confidently."
	ExpandFragmentParamDescription = "The fragment ID to expand, exactly as it appears in the material."
)

func MapExpandEcho(ids []string) string {
	return fmt.Sprintf("[You called %s for: %s]", ExpandFragmentToolName, strings.Join(ids, ", "))
}

func MapExpandResult(fragmentsBlock string) string {
	return `Full text of the requested fragments:

` + fragmentsBlock + `
Continue: reply with only the complete updated map JSON object.`
}

const MapExpandBudgetExhausted = "No further fragments can be expanded. Reply with only the complete updated map JSON object."

const MapExpandNotFound = "(no such fragments)\n\n"

const MapJSONRetryNudge = "Your last reply could not be read as a single JSON object with the required keys. Reply again with only the JSON object: no code fences, no commentary."

func ParseMarkupReply(text string) (json.RawMessage, bool) {
	return extractJSONObject(text, "nodes")
}

func ParseMapReply(text string) (json.RawMessage, bool) {
	return extractJSONObject(text, "dimensions")
}

func extractJSONObject(text, requiredKey string) (json.RawMessage, bool) {
	start := strings.Index(text, "{")
	end := strings.LastIndex(text, "}")
	if start < 0 || end <= start {
		return nil, false
	}
	raw := json.RawMessage(text[start : end+1])
	var obj map[string]json.RawMessage
	if err := json.Unmarshal(raw, &obj); err != nil {
		return nil, false
	}
	if _, ok := obj[requiredKey]; !ok {
		return nil, false
	}
	return raw, true
}
