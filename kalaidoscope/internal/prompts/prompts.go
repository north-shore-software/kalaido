package prompts

import (
	"fmt"
	"strings"

	"github.com/pocketbase/pocketbase/tools/types"
)

// Headings that separate a focused context from the material around it. The
// distinction is entirely one of framing — both halves are real context — so the
// wording has to carry the whole weight of it.
const (
	FocusHeading      = "PRIMARY FOCUS — the subject of this conversation. This is what you are working on:"
	BackgroundHeading = "BACKGROUND — supporting material only. Use it to inform your answer, but do not treat it as the subject:"
	// Stated when a focus is declared during a conversation. The background it
	// refers to may be earlier in the transcript (an established chat that has
	// just been refocused) or listed immediately below (a fresh chat that opened
	// focused), so the wording has to cover both.
	BackgroundNotice = "Everything else in the active context — already established above, or listed below — is BACKGROUND: reference only, never the subject."
)

const ColourEvalInstruction = "You are an expert content evaluator. Does the target document match the given Criteria? Use the provided positive and negative examples to help you understand the criteria. You must answer strictly with 'YES' or 'NO'."

func ApplyPrompt(lensPrompt, sourceBlock string, windowStart, windowEnd types.DateTime) string {
	return BuildPrefix(sourceBlock, windowStart, windowEnd) +
		"Task: Apply the following instruction to the source documents and produce the output.\n\n" +
		"Instruction:\n" + lensPrompt + "\n\nOutput:"
}

func ColourEvalPrompt(criteria, positiveBlock, negativeBlock, targetDocument string) string {
	var sb strings.Builder
	sb.WriteString("Task: " + ColourEvalInstruction + "\n\n")
	sb.WriteString("Criteria:\n" + criteria + "\n\n")

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

// UpdateDraftToolName is the tool a refinement emits its draft through. It is
// model-facing three ways — the advertised tool name, quoted throughout
// RefinementSystemPrompt, and echoed back via DraftEcho — and it is also a wire
// identifier: drafts persist as parts of type "tool-"+UpdateDraftToolName,
// which the commit-time extraction, the seeding path, and the client's preview
// all have to agree on. Renaming it is therefore never just a prompt change.
const UpdateDraftToolName = "update_draft"

// ProductBrief explains the product; deliberately not phrased as "You are…" so
// each system prompt can open with its own role line and compose this beneath.
const ProductBrief = `Kalaido is a private desktop app where the user collects raw source material — notes, emails, transcripts, articles, brain dumps — and turns it into synthesized documents that stay current as the material changes. Everything in this conversation comes from the user's own workspace.`

// ContextLegend explains the document taxonomy the model sees in the hydrated
// context: FragmentBlock, the two snapshot blocks, the delta notices and the
// focus/background headings. It must stay in sync with those formats.
const ContextLegend = `The conversation includes documents from the user's workspace, each wrapped in a "--- ... ---" header:
- Fragments are the user's raw source material. The header gives the fragment's kind (such as email or note), its source, and an internal ID.
- Projection and reflection snapshots are documents Kalaido generated earlier by synthesizing other documents. Treat them as derived views, not original sources.
Documents may be added or removed while the conversation is under way; a notice announces each change, and removed documents must no longer be relied on. A document introduced as PRIMARY FOCUS is the subject of the conversation; everything else is background. IDs are internal — refer to documents by their source or name when talking to the user, and never echo a raw ID even when the user's message contains one.`

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

const RefinementSystemPrompt = `You are a professional assistant helping the user refine a "snapshot" view of their source documents.
Your goal is to distill their requested format, style, and emphasis into a single text output (the "draft").

` + ProductBrief + "\n\n" + ContextLegend + "\n\n" + MentionLegend + "\n\n" + GroundingRules + `

You have access to the "update_draft" tool. You MUST call "update_draft" to create or update the draft preview whenever you have a meaningfully updated draft.
- Always call "update_draft" with the complete draft text (never a diff).
- Bias heavily toward drafting: make a draft attempt or update on every turn you reasonably can, especially on the very first turn.
- If the user's request is genuinely too ambiguous or underspecified to make any useful draft attempt, you may ask a plain-text clarifying question without calling "update_draft".
- Do not call "update_draft" if the draft content would not change.
- When you call "update_draft", keep your accompanying message to at most one short sentence, and NEVER repeat the draft text in that message — the draft belongs only inside the tool call, which renders in a separate preview pane.
- When you are instead asking a clarifying question (no tool call), a normal, focused question is fine.`

const (
	UpdateDraftToolDescription  = "Updates the live draft preview of the projection snapshot with the full updated content."
	UpdateDraftParamDescription = "The complete, fully-rendered content of the draft. This must be the full text, not a diff."
)

// ValidationPing is deliberately trivial — config validation is a reachability
// and credential check, not a capability test, and every call is billed.
const ValidationPing = "ping"

// Notices framing the context delta announced to the model mid-conversation.
const (
	AddedNotice   = "The following documents were ADDED to the active context:\n\n"
	RemovedNotice = "The following documents were REMOVED from the active context and should no longer be relied upon:\n"
)

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

// DraftEcho renders a persisted draft tool call back into flattened transcript
// text, so the model sees its own earlier drafts as part of the conversation.
func DraftEcho(toolName, draft string) string {
	return fmt.Sprintf("[You called %s, drafting:]\n%s", toolName, draft)
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
