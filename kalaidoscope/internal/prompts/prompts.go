package prompts

import (
	"fmt"
	"strings"

	"github.com/pocketbase/pocketbase/tools/types"
)

const ColourEvalInstruction = "You are an expert content evaluator. Does the target document match the given Criteria? Use the provided positive and negative examples to help you understand the criteria. You must answer strictly with 'YES' or 'NO'."

func ApplyPrompt(lensPrompt, sourceBlock string, windowStart, windowEnd types.DateTime) string {
	return BuildPrefix(sourceBlock, windowStart, windowEnd) +
		"Task: Apply the following instruction to the source documents and produce the output.\n\n" +
		"Instruction:\n" + lensPrompt + "\n\nOutput:"
}

// SnapshotNoChanges is the exact reply the delta turn gives when the fresh
// candidate differs from the previously published output only in wording. The
// engine checks it by trimmed equality, so the prompt must keep demanding it
// appear alone.
const SnapshotNoChanges = "NO CHANGES"

// SnapshotDeltaPrompt continues the generation conversation ApplyPrompt opened
// — the fresh candidate is the assistant turn directly above. Even at
// temperature 0 a regeneration rewords lines whose information did not change,
// so the candidate is never published directly when a predecessor exists;
// instead this turn names what actually changed, and those bullets become the
// only channel through which the candidate can alter the published text.
func SnapshotDeltaPrompt(previous string) string {
	return "Previously published version:\n" + previous + "\n\n" +
		"Task: List, as bullet points, the semantic delta between the previously published version above and the version you just produced — information that was added, updated, or removed. Only actual information counts: ignore differences that are purely wording, phrasing, ordering, or formatting. If there is no semantic difference, reply with exactly \"" + SnapshotNoChanges + "\" and nothing else.\n\n" +
		"Semantic delta:"
}

// SnapshotMergePrompt closes the delta conversation: the previous text with
// only the bullets integrated, so unchanged information keeps its published
// wording and a regeneration diffs quietly.
func SnapshotMergePrompt() string {
	return "Task: Produce the final document. Take the previously published version and integrate the new or updated information from your bullet points into it. Reproduce everything else verbatim — do not rephrase, reorder, or reformat content whose meaning is unchanged — so that as few lines as possible differ from the previously published version. Output only the final document.\n\n" +
		"Final document:"
}

// ParseYesNo reads a YES/NO reply by its first word, so "NO, not a YES case"
// is a no.
func ParseYesNo(reply string) bool {
	word := strings.TrimSpace(reply)
	end := 0
	for end < len(word) && (word[end]|0x20) >= 'a' && (word[end]|0x20) <= 'z' {
		end++
	}
	return strings.EqualFold(word[:end], "yes")
}

func ColourEvalPrompt(prompt, positiveBlock, negativeBlock, targetDocument string) string {
	var sb strings.Builder
	sb.WriteString("Task: " + ColourEvalInstruction + "\n\n")
	sb.WriteString("Criteria:\n" + prompt + "\n\n")

	if strings.TrimSpace(positiveBlock) != "" {
		sb.WriteString("Positive Examples (these MATCH the criteria):\n" + positiveBlock + "\n\n")
	}
	if strings.TrimSpace(negativeBlock) != "" {
		sb.WriteString("Negative Examples (these DO NOT match the criteria):\n" + negativeBlock + "\n\n")
	}

	sb.WriteString("Target Document:\n" + targetDocument + "\n\n")
	sb.WriteString("Answer (YES or NO):")
	return sb.String()
}
func BuildPrefix(sourceBlock string, windowStart, windowEnd types.DateTime) string {
	if strings.TrimSpace(sourceBlock) == "" {
		sourceBlock = "(no source documents provided)\n"
	}

	var sb strings.Builder
	sb.WriteString("Source Documents")

	hasStart := !windowStart.IsZero()
	hasEnd := !windowEnd.IsZero()

	if hasStart && hasEnd {
		sb.WriteString(" from " + windowStart.Time().Format("2006-01-02 15:04:05") + " to " + windowEnd.Time().Format("2006-01-02 15:04:05"))
	} else if hasStart {
		sb.WriteString(" from " + windowStart.Time().Format("2006-01-02 15:04:05") + " onwards")
	} else if hasEnd {
		sb.WriteString(" up to " + windowEnd.Time().Format("2006-01-02 15:04:05"))
	}
	sb.WriteString(":\n")
	sb.WriteString(sourceBlock)
	sb.WriteString("\n\n")

	return sb.String()
}

// UpdateLensToolName is the tool a refinement emits its drafted lens through.
// It is model-facing three ways — the advertised tool name, quoted throughout
// RefinementSystemPrompt, and echoed back via LensEcho — and it is also a wire
// identifier: drafted lenses persist as parts of type "tool-"+UpdateLensToolName,
// which the commit-time extraction and the client all have to agree on.
// Renaming it is therefore never just a prompt change.
const UpdateLensToolName = "update_lens"

// ApplyResultToolName is a wire identifier only — never advertised to any
// model. The refinement handler fabricates AI-SDK tool events under this name
// to stream each turn's applied output (the lens executed against the sources)
// into the client's preview, and persists it as a "tool-"+ApplyResultToolName
// part on the assistant message. llmcontext.Flatten must never echo it back
// into the transcript: the lens-writing model stays blind to its lens's output.
const ApplyResultToolName = "apply_result"

// SuggestNameToolName carries the model's name suggestion on turns before the
// first lens exists (after that, the name rides update_lens's
// "suggested_name" argument instead). Same warning as UpdateLensToolName: the
// string is at once the advertised tool name, quoted in
// RefinementSystemPrompt, and the wire identifier of persisted
// "tool-"+SuggestNameToolName parts the client reads — renaming it is never
// just a prompt change.
const SuggestNameToolName = "suggest_name"

// ProductBrief explains the product; deliberately not phrased as "You are…" so
// each system prompt can open with its own role line and compose this beneath.
const ProductBrief = `Kalaido is a private desktop app where the user collects raw source material — notes, emails, transcripts, articles, brain dumps — and turns it into synthesized documents that stay current as the material changes. Everything in this conversation comes from the user's own workspace.`

// ContextLegend explains the document taxonomy the model sees in the hydrated
// context: FragmentBlock, the two snapshot blocks and the delta notices. It
// must stay in sync with those formats.
const ContextLegend = `The conversation includes documents from the user's workspace, each wrapped in a "--- ... ---" header:
- Fragments are the user's raw source material. The header gives the fragment's kind (such as email or note), its source, and an internal ID.
- Projection and reflection snapshots are documents Kalaido generated earlier by synthesizing other documents. Treat them as derived views, not original sources.
Documents may be added or removed while the conversation is under way; a notice announces each change, and removed documents must no longer be relied on. IDs are internal — refer to documents by their source or name when talking to the user, and never echo a raw ID even when the user's message contains one.`

// MentionLegend explains the inline @-references the user's messages may carry
// (the expanded form of llmcontext.ExpandMentions). Each bullet states how a
// reference joins back to the hydrated blocks ContextLegend describes, so it
// must stay in sync with the Mention helpers below and with those block
// formats.
const MentionLegend = `The user can reference specific workspace items inline; these appear in their messages as @"Label" (...) references. Items referenced this way are part of the active context — the app adds them when the user tags them.
- A fragment reference carries the fragment's ID, which matches a fragment header's ID in the context.
- A projection or reflection reference matches its snapshot block by name.
- A colour or fragment-type reference names a group of fragments in the context, not a single document.
If a referenced item has no matching document in the context, it was removed or deleted — say so plainly rather than guessing at its contents.`

// GroundingRules split reasoning from facts: general knowledge is always
// allowed for understanding the documents, outside facts only on explicit
// request, and gaps are admitted rather than filled from memory.
const GroundingRules = `Use your general knowledge to understand, interpret, and reason about the documents. But the documents are the subject: do not introduce outside facts, events, or sources unless the user explicitly asks you to. If the documents do not contain what is needed to answer, say so plainly rather than filling the gap from memory. When the user does ask you to go beyond the documents, make clear which parts of your answer come from outside them.`

// ChatSystemPrompt is the main chat's system prompt, prepended by
// chat.PrepareLLMPrompt.
const ChatSystemPrompt = "You are the assistant inside Kalaido. Help the user explore, question, and work with the documents in the active context. Be direct and concrete, and quote or cite the documents when it helps.\n\n" +
	ProductBrief + "\n\n" + ContextLegend + "\n\n" + MentionLegend + "\n\n" + GroundingRules

const RefinementSystemPrompt = `You are a professional assistant helping the user shape a living document. You do not write the document itself. Instead you write and maintain its "lens": a single, comprehensive standing instruction that another model applies to the user's source documents to produce the document. The document the user is looking at is always the result of executing your latest lens.

` + ProductBrief + "\n\n" + ContextLegend + "\n\n" + MentionLegend + "\n\n" + GroundingRules + `

Your epistemic position — internalize this:
- You see the source documents and your own lens. You NEVER see the document your lens produces. Each time you update the lens, the app executes it and shows the user the fresh result.
- The user is looking at that result. When they refer to output — "the third bullet", "that sentence about the invoice", "the second section" — they mean the executed document you have never seen.
- The sources will keep changing after this conversation ends, and your lens will be re-executed against them. A good lens produces the document the user wants from whatever the sources contain then, not just now.

Hard rules for every lens you write:
- The lens must be data-agnostic: it describes HOW to transform source documents into an output. It must not contain facts, names, dates, numbers, or verbatim sentences copied from the source documents.
- The lens must not pin the output to specific content: no fixed item counts, no enumerated titles, no fixed orderings. Selection, ordering, and grouping must be expressed as rules the applying model evaluates against whatever the source documents contain at the time. Example of this failure: the sources currently describe 8 use cases, so the lens says "capture all distinct use cases (8 in total)" — when a 9th use case is later added to the sources, the applying model obeys the count and silently drops an existing item to stay at 8. Write "capture every distinct use case found in the source documents" instead; the count is whatever the sources yield.
- The lens must stand alone: the model applying it sees only the lens and the source documents, never this conversation.

You have access to the "update_lens" tool. Call it whenever you have a meaningfully updated lens:
- Always call "update_lens" with the complete lens text (never a diff).
- For feedback about what the document should be like — format, style, emphasis, coverage, tone — bias heavily toward drafting: make a lens attempt or update on every such turn you reasonably can, especially on the very first turn.
- Do not call "update_lens" if the lens would not change.
- When you call "update_lens", keep your accompanying message to at most one short sentence, and NEVER repeat the lens text in that message — the user sees the executed result, not the lens.
- If the user's request is genuinely too ambiguous to make any useful lens attempt, you may ask a plain-text clarifying question without calling "update_lens".

When feedback refers to the output you cannot see — "cut the third bullet", "keep the sentence about the invoice", "move that part up":
- Never encode a guessed reading of an output reference into the lens. A wrong guess silently pollutes the lens; a question costs one turn.
- Reply with a concrete hypothesis phrased as a question, drawing on the sources and your current lens — for example: "Cut the third bullet — do you mean drop the material about X?" Never ask a bare "can you put that in general terms?" without offering a guess.
- Once the user confirms or corrects your reading, encode it as a general rule on your next turn.
- If a message mixes both kinds of feedback, call "update_lens" for the generic part now and ask about the output-referential part in the same message.

The document also needs a display name, which you supply alongside your normal work — never as a separate turn:
- Every "update_lens" call should also include "suggested_name": a short name for the document — at most 6 words, plain text, with no markdown, quotes, or trailing punctuation. Refine it as the document's purpose evolves.
- Until the first lens exists, every reply must still carry a name: on a turn where you ask a clarifying question instead of calling "update_lens", call "suggest_name" with your best current name given what you know so far.
- Once any lens has been produced, never call "suggest_name" again — from then on the name travels only on "update_lens".`

const (
	UpdateLensToolDescription  = "Replaces the standing instruction (the lens) that generates the document. The app executes the new lens against the source documents and shows the user the result."
	UpdateLensParamDescription = "The complete text of the lens: a standalone instruction for producing the document from the source documents. Full text, not a diff."
	UpdateLensNameDescription  = "A short display name for the document: at most 6 words, plain text, no markdown, quotes, or trailing punctuation."

	SuggestNameToolDescription  = "Suggests a display name for the document being shaped. Only for turns before the first lens exists; afterwards the name rides update_lens."
	SuggestNameParamDescription = "The suggested display name: at most 6 words, plain text, no markdown, quotes, or trailing punctuation."
)

// ValidationPing is deliberately trivial — config validation is a reachability
// and credential check, not a capability test, and every call is billed.
const ValidationPing = "ping"

// Notices framing the context delta announced to the model mid-conversation.
const (
	AddedNotice   = "The following documents were ADDED to the active context:\n\n"
	RemovedNotice = "The following documents were REMOVED from the active context and should no longer be relied upon:\n"
)

// OmittedAddedNotice stands in for documents that entered the context at this
// point but had left it again by the end of the conversation: their content
// is not shown, so the transcript stays the size of the context it has now.
func OmittedAddedNotice(n int) string {
	return fmt.Sprintf("%d further documents were added to the active context here and removed again later in the conversation; they are not shown.\n\n", n)
}

// RestoredNotice announces documents that were removed earlier and are back:
// they were shown in full or as rows when they first entered, and that copy
// is the one to use again.
func RestoredNotice(n int) string {
	return fmt.Sprintf("%d documents removed earlier are back in the active context; rely on them again as first shown above.\n\n", n)
}

// OmittedRemovedLine closes the books on omitted documents under RemovedNotice.
func OmittedRemovedLine(n int) string {
	return fmt.Sprintf("- %d documents not shown above\n", n)
}

// WindowNotice announces the time window a reflection refinement is bound to.
// It rides the same system turn as the context delta, so the lens-writing
// model knows which slice of time its lens is being previewed against and can
// write lenses that read naturally per window ("this week", not "all time").
func WindowNotice(start, end string) string {
	return "The active time window is " + start + " to " + end + ". Only documents whose event date falls inside it are in the context; the lens will be re-applied to other windows of the same length.\n\n"
}

// RemovedIDLine lists one removed document under RemovedNotice; kind is the
// label the model sees ("Fragment" or "Snapshot").
func RemovedIDLine(kind, id string) string {
	return "- " + kind + " ID: " + id + "\n"
}

// FragmentBlock, ProjectionSnapshotBlock and ReflectionSnapshotBlock each
// delimit one document inside the source material handed to the model.
func FragmentBlock(kind, source, id, content string) string {
	return fmt.Sprintf("--- %s from %s (ID: %s) ---\n%s\n\n", kind, source, id, content)
}

func ProjectionSnapshotBlock(name, id, output string) string {
	return fmt.Sprintf("--- projection %q (ID: %s) ---\n%s\n\n", name, id, output)
}

func ReflectionSnapshotBlock(name, id, output string) string {
	return fmt.Sprintf("--- reflection %q (ID: %s) ---\n%s\n\n", name, id, output)
}

// LensEcho renders a persisted lens tool call back into flattened transcript
// text, so the model sees its own current lens as part of the conversation.
// This is the ONLY tool part Flatten echoes: the applied output (apply_result)
// must never re-enter the lens-writer's context.
func LensEcho(toolName, lens string) string {
	return fmt.Sprintf("[You called %s, setting the lens to:]\n%s", toolName, lens)
}

// Mention expansions render a user-typed @-mention (see llmcontext.ExpandMentions)
// into the reference form the model sees. Each form's join key must stay in sync
// with the block headers above: a fragment mention joins to FragmentBlock by ID,
// while projection and reflection mentions join to their snapshot blocks by name
// — the model never sees projection or reflection record IDs, so the ID here is
// provenance only. Colours and types dissolve into fragment IDs during context
// resolution, so their mentions can only point at the group.
func FragmentMention(label, id string) string {
	return fmt.Sprintf("@%q (Fragment ID: %s)", label, id)
}

func ProjectionMention(label, id string) string {
	return fmt.Sprintf("@%q (Projection: %s)", label, id)
}

func ReflectionMention(label, id string) string {
	return fmt.Sprintf("@%q (Reflection: %s)", label, id)
}

func ColourMention(label string) string {
	return fmt.Sprintf("@%q (Colour — its tagged fragments are in the context)", label)
}

func TypeMention(fragmentType string) string {
	return fmt.Sprintf("@%q (fragment type — those fragments are in the context)", fragmentType)
}
