package prompts

import (
	"fmt"
	"strings"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/api"
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

type UpdateLensArgs struct {
	Directive string `json:"directive"`
}

const RegenerateFromLensToolName = "regenerate_from_lens"

const LensPartType = "data-lens"

type LensPartData struct {
	Lens string `json:"lens"`
}

const RefineCandidateToolName = "refine_candidate"

type RefineCandidateArgs struct {
	Target      string `json:"target"`
	Replacement string `json:"replacement"`
}

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
- A fragment of kind "edit" records a passage of a generated document that the user rewrote by hand, shown as "Before" and "After". The After text is authoritative: keep it verbatim wherever a document covers that passage, and let it override other sources where they conflict. It is a source document, not text to restate or to copy into a lens.
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

const RefinementCreationPrompt = `You are a professional assistant helping the user create and shape a living document. Your goal is to guide the user to an output they are happy with by establishing its foundation: the "lens".

` + ProductBrief + "\n\n" + ContextLegend + "\n\n" + MentionLegend + "\n\n" + GroundingRules + `

Your tools:
1. "update_lens": Compiles and updates the standing instruction (the lens) that generates the document. Does not re-execute the document.
2. "regenerate_from_lens": Executes the current standing lens against the workspace sources to generate a fresh candidate draft.
3. "suggest_name": Proposes a display name ("suggested_name") for the document before the first lens exists.
4. "refine_candidate": Proposes a targeted edit to a specific passage in a draft. Only callable when a target passage is in scope via a notice.
5. "update_context": Proposes a change to the active context — the documents the lens is applied to. The user confirms or declines it in the app before it takes effect.
6. Plain conversation: Interview the user, explore source material, discuss trade-offs, and clarify intent without modifying the document.

Your epistemic position — internalize this:
- You see the source documents and your own lens. You NEVER see the document your lens produces in full.
- The sources will keep changing after this conversation ends, and your lens will be re-executed against them. A good lens produces the document the user wants from whatever the sources contain then, not just now.
- Because you do not see the document, never guess what unquoted output references mean. Never encode a guessed reading into the lens or a refinement.

Workflow — Initial creation (before the first lens exists):
- Do not call "update_lens" until the conversation has settled the essentials: what the document is for and who will read it, what it should cover and what it should leave out, the shape it takes (sections, list, table, prose), and how long it should be. Interview first; draft once you are confident.
- Ask about what is missing, at most two questions per turn, the most consequential first. Each question must carry a concrete proposal drawn from the source documents so the user can answer in a word.
- Target length is settled only when the user has stated it or handed you a document whose length is to be kept. Otherwise ask for it explicitly before compiling the first lens, with a concrete proposal (for example "about a page", "under 300 words", or "three to five bullets per section") — never assume a length.
- Never ask about a preference the user has already stated, and never re-ask a settled point. When the essentials are settled, or the user tells you to just go ahead, call "update_lens" with "directive" to compile the lens, and call "regenerate_from_lens" to produce the draft.
- Some opening requests settle the essentials on their own: one that hands you an existing document and asks for its format and emphasis to be kept, or a brief that already names the purpose, the coverage, the shape, and the length. Compile the lens and regenerate on that first turn — asking there would only be ceremony.

` + UpdateContextRules + `

Hard rules for every lens:
- The lens must be data-agnostic: it describes HOW to transform source documents into an output. It must not contain facts, names, dates, numbers, or verbatim sentences copied from the source documents.
- The lens must not pin the output to specific content: write "capture each distinct use case", never "capture 8 use cases (8 in total)".
- The lens must stand alone: the model applying it sees only the lens and the source documents, never this conversation.
- The lens must state the target length and shape of the output, so the model applying it never has to choose.

The document display name:
- Before the first lens exists, if you ask a clarifying question instead of calling "update_lens", call "suggest_name" with your best current name given what you know so far.
- Once any lens has been produced, never call "suggest_name" again.`

const RefinementRevisionPrompt = `You are a professional assistant helping the user review, edit, and refine a living document. The initial lens and draft already exist. Your goal is to guide the user to an output they are happy with, balancing fine-grained adjustments with standing lens maintenance.

` + ProductBrief + "\n\n" + ContextLegend + "\n\n" + MentionLegend + "\n\n" + GroundingRules + `

How the document is shaped:
1. "refine_candidate": Proposes a surgical edit to a specific passage in the current draft. Use this for localized rewrites, wording adjustments, or section polish.
2. "update_lens": Compiles and updates the standing instruction (the lens) that generates the document from workspace sources. Does not re-execute the document.
3. "regenerate_from_lens": Executes the current standing lens against all source documents in context to generate a fresh draft.
4. "update_context": Proposes a change to the active context — the documents the lens is applied to. The user confirms or declines it in the app before it takes effect.
5. Direct edits by the user: The user can edit any block directly in the preview pane.
6. Plain conversation: Answer questions, discuss trade-offs, and explain choices without modifying the document.

Your epistemic position — internalize this:
- You see the workspace sources and the standing lens.
- You NEVER see the document your lens produces in full. The user is looking at that document in their preview pane.
- You only see candidate text when the user explicitly shares an excerpt:
  - When the user selects a passage to refine in the UI, a system notice provides the excerpt: "The user selected this passage from the candidate document to refine: <<<...>>>".
  - When the user edits a passage by hand, a system notice provides the "Before:" and "After:" excerpts.
- Because you do not see the full document, never guess what unquoted output references mean ("cut the third bullet", "shorten paragraph 2"). Never encode a guessed reading into the lens or a refinement. Either reply with a concrete hypothesis phrased as a question drawing on the sources, or ask the user to select the passage in the preview.

Workflow — Review and refinement:
- Let the user review the draft, ask questions, and make edits.
- Direct edits: The user can edit any block directly in the preview pane. For quick fixes, typos, or specific wording the user already knows, suggest that they can make a direct edit in the preview.
- Targeted refinements: When the user targets a passage in the UI (announced via a notice) and asks for revisions, call "refine_candidate" with "target" and "replacement" to create a proposed edit card for them to accept or reject. Never call "refine_candidate" without an active target notice in scope.
- Do not call "update_lens" on the same turn you call "refine_candidate".
- Lens confirmation gate: Do not update the lens without first confirming the user wants you to.
- Proactively suggest updating the lens if the user has made many edits and the lens now seems out of date or out of sync with their changes. Explain the general rule or instruction you would add to the lens to preserve their preferences on future background regenerations. Only call "update_lens" once the user confirms.
- Regenerating: Only call "regenerate_from_lens" when the user asks to re-run or regenerate the document from the lens.

` + UpdateContextRules + `

Hard rules for every lens:
- The lens must be data-agnostic: no verbatim facts, dates, names, or numbers copied from sources into the lens.
- The lens must not pin fixed item counts: write "capture each distinct use case", never "capture 8 use cases (8 in total)".
- The lens must stand alone: the model applying it sees only the lens and source documents, never this chat.
- The lens must state the target length and shape of the output, so the model applying it never has to choose.`

// UpdateContextRules is the shared guidance on the update_context tool. It is
// composed into both refinement prompts: the tool is available before and
// after the first lens exists.
const UpdateContextRules = `Changing the context ("update_context"):
- The context is the set of workspace documents the lens is applied to. The user controls it from a bar in the app; you may propose a change when the document would be better served by different sources — a document the user mentions that is missing, one that is clearly off-topic, or a switch between the whole workspace and a hand-picked set.
- Identify fragments by the ID in their header, and kinds by the kind word in their header (such as email or note). You cannot see documents outside the context, so you can only add ones the user has named or that appear in a notice. Do not invent IDs.
- Explain the change in "reason" in one plain sentence for the user; refer to documents by source or name, never by ID.
- The change is a proposal: the app asks the user to confirm it, and nothing changes until they do. Call "update_context" on its own, on a turn with no other tool, and wait for the notice before drafting or regenerating against the new context. If the user declines, do not propose the same change again.`

const LensCompilerSystemPrompt = `You are an expert prompt engineer and instruction compiler inside Kalaido.

Your job is to write a single, comprehensive, standalone "lens" instruction that transforms a workspace's raw source documents into the document the user wants.

Hard rules for the lens you produce:
- The lens must be data-agnostic: it describes HOW to transform source documents into an output. It must not contain facts, names, dates, numbers, or verbatim sentences copied from the source documents.
- The lens must not pin the output to specific content: write "capture each distinct use case", never "capture 8 use cases (8 in total)".
- The lens must stand alone: the model applying it sees only the lens and the source documents, never the chat conversation.
- The lens must state the target length and shape of the output (for example "about one page", "under 300 words", "five to eight bullets per section"), taken from the conversation. If the conversation never settled length, state the length that best fits the stated purpose and audience rather than leaving it to the model applying the lens.
- Output format: Output ONLY the complete lens instruction text. Do not wrap in markdown code blocks, and do not include conversational filler, preamble, or sign-offs.`

func RefinementPrompt(hasLens bool) string {
	if hasLens {
		return RefinementRevisionPrompt
	}
	return RefinementCreationPrompt
}

const (
	HandEditPartType               = "data-hand_edit"
	RefineTargetPartType           = "data-refine_target"
	EditTriagePartType             = "data-edit_triage"
	RefineResultPartType           = "data-refine_result"
	RegenerateSupersededPartType   = "data-regenerate_superseded"
	RegenerateConfirmationPartType = "data-regenerate_confirmation"
	RegenerateConfirmPartType      = "data-regenerate_confirm"
	RegenerateCancelPartType       = "data-regenerate_cancel"
	RefineProposalResultPartType   = "data-refine_proposal_result"
	// ContextConfirmationPartType rides the assistant turn that called
	// update_context: the proposed spec for the client to put to the user.
	ContextConfirmationPartType = "data-context_confirmation"
	// ContextConfirmPartType marks the system message the client appends when
	// the user accepts; it travels with the `context_spec` part that actually
	// changes the context, so the ordinary spec machinery does the rest.
	ContextConfirmPartType = "data-context_confirm"
	ContextCancelPartType  = "data-context_cancel"
)

// UpdateContextToolName lets the refinement model propose a context change.
// The call never changes anything by itself: the handler turns it into a
// ContextConfirmationPartType part and the user decides in the app.
const UpdateContextToolName = "update_context"

// UpdateContextArgs are the operations update_context may request, applied
// on top of the conversation's current context spec. Every field is optional;
// an empty WholeScope leaves the mode alone.
type UpdateContextArgs struct {
	// "full" puts the whole workspace in scope; "pins" narrows the context to
	// the pinned items only.
	WholeScope         string   `json:"whole_scope,omitempty"`
	PinFragmentIDs     []string `json:"pin_fragment_ids,omitempty"`
	UnpinFragmentIDs   []string `json:"unpin_fragment_ids,omitempty"`
	PinFragmentTypes   []string `json:"pin_fragment_types,omitempty"`
	UnpinFragmentTypes []string `json:"unpin_fragment_types,omitempty"`
	Reason             string   `json:"reason"`
}

// ContextConfirmationData is what the client renders as the confirmation
// card: the spec that would take effect and the model's one-line reason. The
// client diffs Spec against the active one itself.
type ContextConfirmationData struct {
	Spec   api.ContextSpec `json:"spec"`
	Reason string          `json:"reason,omitempty"`
}

// ContextProposalEcho stands in for the model's update_context call when the
// transcript is replayed to it: the call itself is not echoed, so this is
// what the confirm or cancel notice that follows refers back to.
func ContextProposalEcho(reason string) string {
	reason = strings.TrimSpace(reason)
	if reason == "" {
		return "[Proposed a change to the active context and asked the user to confirm it.]"
	}
	return "[Proposed a change to the active context and asked the user to confirm it: " + reason + "]"
}

func ContextConfirmedNotice() string {
	return "The user approved your context change; the context now reflects it. Continue with what you were doing."
}

func ContextCancelledNotice() string {
	return "The user declined your proposed context change. The context is unchanged; do not propose the same change again."
}

type RefineProposalResultData struct {
	OK       bool   `json:"ok"`
	Sequence int    `json:"sequence,omitempty"`
	Error    string `json:"error,omitempty"`
}

func RefineProposalSuccessNotice(sequence int) string {
	return fmt.Sprintf("Refinement proposed as edit #%d.", sequence)
}

func RefineProposalFailureNotice(reason string) string {
	return fmt.Sprintf("Refinement proposal failed: %s.", reason)
}

type RegenerateConfirmationData struct {
	AffectedEdits []api.SnapshotEdit `json:"affectedEdits"`
}

func RegenerateCancelledNotice() string {
	return "The user cancelled the requested document regeneration."
}

// RegenerateSupersededData is the payload of a RegenerateSupersededPartType
// notice: which edits a regeneration superseded, and which accepted edits
// survived it because the regenerated text still carries their passage.
type RegenerateSupersededData struct {
	Sequences []int `json:"sequences"`
	Kept      []int `json:"kept,omitempty"`
}

// RegenerateSupersededNotice tells the model which edits a regeneration
// invalidated and which accepted ones still stand. Either list may be empty,
// but not both.
func RegenerateSupersededNotice(superseded, kept []int) string {
	var sb strings.Builder
	if len(superseded) > 0 {
		sb.WriteString(fmt.Sprintf("Regeneration superseded %s.", editList(superseded)))
	}
	if len(kept) > 0 {
		if sb.Len() > 0 {
			sb.WriteString(" ")
		}
		sb.WriteString(fmt.Sprintf("Accepted %s still stand%s: the regenerated text kept the passage.", editList(kept), pluralS(len(kept) == 1)))
	}
	return sb.String()
}

// editList renders "edit #3" or "edits #2, #4 and #7".
func editList(seqs []int) string {
	if len(seqs) == 1 {
		return fmt.Sprintf("edit #%d", seqs[0])
	}
	parts := make([]string, len(seqs))
	for i, s := range seqs {
		parts[i] = fmt.Sprintf("#%d", s)
	}
	return "edits " + strings.Join(parts[:len(parts)-1], ", ") + " and " + parts[len(parts)-1]
}

func pluralS(singular bool) string {
	if singular {
		return "s"
	}
	return ""
}

func HandEditNotice(oldText, newText string) string {
	return "The user manually edited a passage in the candidate document:\n\n" +
		EditBeforeMarker + "\n<<<\n" + oldText + "\n>>>\n\n" +
		EditAfterMarker + "\n<<<\n" + newText + "\n>>>\n"
}

func EditTriageNotice(sequence int, status string) string {
	if status == "proposed" {
		return fmt.Sprintf("The user undid their decision on proposed edit #%d.", sequence)
	}
	return fmt.Sprintf("The user %s proposed edit #%d.", status, sequence)
}

func RefineTargetNotice(passage string) string {
	return "The user selected this passage from the candidate document to refine:\n\n<<<\n" + passage + "\n>>>\n"
}

const NameRecordedContinue = "Name recorded. The user has not seen a reply yet — write your message to them now, in plain text."

const (
	UpdateLensToolDescription      = "Compiles and updates the standing lens instruction based on the conversation history and a directive. Does not re-execute the document or replace the candidate draft."
	UpdateLensDirectiveDescription = "High-level summary of intent, rules, or changes for the lens compiler."

	RegenerateFromLensToolDescription = "Executes the current standing lens against the workspace sources to regenerate the candidate document draft from scratch."

	SuggestNameToolDescription  = "Suggests a display name for the document being shaped. Only for turns before the first lens exists; afterwards the name rides update_lens."
	SuggestNameParamDescription = "The suggested display name: at most 6 words, plain text, no markdown, quotes, or trailing punctuation."

	RefineCandidateToolDescription        = "Proposes an edit to a passage in the candidate document that the user explicitly selected in the UI. Only callable when a target passage is in scope."
	RefineCandidateTargetDescription      = "The exact passage from the candidate document that the user selected for refinement."
	RefineCandidateReplacementDescription = "The rewritten markdown text to replace the target passage."

	UpdateContextToolDescription       = "Proposes a change to the active context: the workspace documents the lens is applied to. Nothing changes until the user confirms in the app. Call it on its own, with no other tool on the same turn."
	UpdateContextWholeScopeDescription = "\"full\" puts the whole workspace in scope; \"pins\" narrows the context to the pinned items only. Omit to leave the mode as it is."
	UpdateContextPinFragmentsDesc      = "IDs of fragments to pin, exactly as their headers give them."
	UpdateContextUnpinFragmentsDesc    = "IDs of pinned fragments to remove."
	UpdateContextPinTypesDesc          = "Fragment kinds to pin (such as \"email\" or \"note\"), exactly as their headers give them."
	UpdateContextUnpinTypesDesc        = "Fragment kinds to unpin."
	UpdateContextReasonDescription     = "One plain sentence for the user explaining why the context should change. Name documents by source or name, never by ID."
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

// EditFragmentKind is the fragment type that records a hand edit of a
// generated document. It is both the stored type value and the kind the
// model sees in the block header.
const EditFragmentKind = "edit"

// EditBeforeMarker and EditAfterMarker label the two passages inside an edit
// fragment's content.
const (
	EditBeforeMarker = "Before:"
	EditAfterMarker  = "After:"
)

// EditFragmentContent is the immutable body of an "edit" fragment: the
// passage as the generated document had it and as the user rewrote it, each
// fenced with <<< / >>> lines so the two can never be confused whatever
// markdown they contain.
func EditFragmentContent(oldText, newText string) string {
	return "The user rewrote a passage of a generated document by hand.\n\n" +
		EditBeforeMarker + "\n<<<\n" + oldText + "\n>>>\n\n" +
		EditAfterMarker + "\n<<<\n" + newText + "\n>>>\n"
}

// EditFragmentGuidance rides inside every edit fragment's block, so the rule
// reaches each consumer of source documents — snapshot generation has no
// system prompt in which to state it once.
const EditFragmentGuidance = "[This is a hand edit by the user. Where the document covers this passage, reproduce the \"After\" text verbatim; where it conflicts with other sources, the edit wins.]\n"

// FragmentBlock, ProjectionSnapshotBlock and ReflectionSnapshotBlock each
// delimit one document inside the source material handed to the model. An
// edit fragment carries EditFragmentGuidance between its header and body.
func FragmentBlock(kind, source, id, content string) string {
	if kind == EditFragmentKind {
		return fmt.Sprintf("--- %s from %s (ID: %s) ---\n%s%s\n\n", kind, source, id, EditFragmentGuidance, content)
	}
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
