package prompts

import (
	"fmt"
	"strings"
	"unicode"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/mapdoc"
)

// Summaries mode: the chat sees the workspace map plus one annotation row per
// fragment instead of full bodies, and reads full text through tools. The
// tool names are shared with discover (ReadThingToolName,
// ReadFragmentToolName); the descriptions here are chat's own, because
// discover's talk about proposing and a per-run budget.
const (
	ChatReadThingToolDescription     = "Read things from the map in depth: what each is, its relationships, how its fragments spread over time, and a sample of those fragments' titles and summaries with their ids. Pass every thing you want to see in one call, up to ten. Takes thing ids from the digest or the rows, or exact names."
	ChatReadFragmentToolDescription  = "Read the full text of one or more fragments by id, when a summary row is not enough to answer. Pass every id you need in one call. Budgeted per turn."
	ChatReadFragmentParamDescription = "Fragment ids, exactly as shown in the rows."
)

// SummariesThingFloor keeps one-off things out of the digest; same rationale
// as annotate's inline floor.
const SummariesThingFloor = 2

// SummarySnippetChars bounds the stub shown for a fragment with no annotation.
const SummarySnippetChars = 200

// ChatSummariesLegend extends ContextLegend for summaries mode. It must stay
// in sync with SummariesMapDigest, SummaryRowLine and SummaryStubLine, and it
// overrides ContextLegend's rule on IDs: here the ids exist for tool calls.
const ChatSummariesLegend = `In this conversation the active context is presented as summaries, not full documents. Below is the workspace map: a narrative saying what the workspace is about, a list of "things" (people, organisations, places, projects, topics) with how many fragments cite each, and relationships between them. Each document in the context is then one line: its date, a short title, a one-paragraph summary, the fragment's ID, and the things it cites. A line marked "not yet annotated" carries only the opening of the document instead of a summary. Documents the user pinned are the exception: they appear in full, wrapped in the "--- ... ---" headers described above, alongside the rows.

Two tools give you the full material:
- read_fragment: the full text of one or more fragments by id. Pass every id you need in one call. Budgeted per turn; when the budget is spent, work from the rows you have.
- read_thing: a thing in depth, by id or exact name — blurb, relationships, a month-by-month count of fragments, and sampled fragment rows with ids. Pass every thing you want in one call.

A summary is a summary: before asserting a detail, a quotation, a figure or a date that the rows cannot support, read the fragment. Prefer one read_fragment call with several ids over several calls. The IDs in the rows are for these tool calls only — when talking to the user, refer to documents by their title, source or date, never by raw ID.`

// ChatSummariesSystemPrompt is the main chat's system prompt in summaries
// mode: the ordinary prompt, the summaries legend, and the current digest.
func ChatSummariesSystemPrompt(digest string) string {
	return ChatSystemPrompt + "\n\n" + ChatSummariesLegend + "\n\n" + digest
}

// SummariesMapDigest renders the workspace map for the system prompt.
func SummariesMapDigest(d *mapdoc.Document, floor int) string {
	var sb strings.Builder
	sb.WriteString("What the workspace is about:\n")
	if strings.TrimSpace(d.Narrative) == "" {
		sb.WriteString("(no narrative yet)\n")
	} else {
		sb.WriteString(strings.TrimSpace(d.Narrative) + "\n")
	}
	sb.WriteString("\nThings, heaviest first (id · name · kind · fragments · span · what it is):\n")
	sb.WriteString(discoverThingsBlock(d, floor))
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
	return sb.String()
}

// SummariesAddedNotice replaces AddedNotice when the added documents are
// rendered as rows.
const SummariesAddedNotice = "The following documents were ADDED to the active context, as summaries; call read_fragment for any whose full text you need:\n\n"

// SummaryRowLine renders one annotated fragment. names resolves a thing
// citation's ref to its map name; unresolved refs fall back to the citation's
// own name. The shape mirrors the rows in DiscoverThingCard so context rows
// and read_thing output look alike.
func SummaryRowLine(r AnnotationRow, names map[string]string) string {
	date := r.Date
	if date == "" {
		date = DiscoverUndated
	}
	var b strings.Builder
	fmt.Fprintf(&b, "- %s · %s · %s (ID: %s)", date, r.Title, strings.TrimSpace(r.Summary), r.FragmentID)
	var cites []string
	for _, c := range r.Things {
		switch {
		case c.Ref != "":
			if n := names[c.Ref]; n != "" {
				cites = append(cites, fmt.Sprintf("%s (%s)", n, c.Ref))
			} else {
				cites = append(cites, c.Ref)
			}
		case c.Name != "":
			cites = append(cites, c.Name)
		}
	}
	if len(cites) > 0 {
		b.WriteString(" [things: " + strings.Join(cites, "; ") + "]")
	}
	b.WriteString("\n")
	return b.String()
}

// SummaryStubLine renders a fragment that has no annotation yet.
func SummaryStubLine(kind, source, id, date, snippet string) string {
	if date == "" {
		date = DiscoverUndated
	}
	return fmt.Sprintf("- %s · %s from %s · %q (ID: %s; not yet annotated)\n", date, kind, source, snippet, id)
}

// SummarySnippet is the opening of a fragment, whitespace collapsed, cut to
// SummarySnippetChars runes.
func SummarySnippet(content string) string {
	fields := strings.FieldsFunc(content, unicode.IsSpace)
	s := strings.Join(fields, " ")
	runes := []rune(s)
	if len(runes) <= SummarySnippetChars {
		return s
	}
	return string(runes[:SummarySnippetChars]) + "…"
}

// ChatReadBudgetExhausted is the tool result once a turn's fragment reads are
// spent; discover's counterpart says "per run".
func ChatReadBudgetExhausted(limit int) string {
	return fmt.Sprintf("Fragment read budget exhausted (%d per turn). Work from the summaries you already have, or tell the user what you would need to read.", limit)
}
