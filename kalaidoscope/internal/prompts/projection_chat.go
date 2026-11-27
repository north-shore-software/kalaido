package prompts

import (
	"fmt"
	"strings"
)

// Projection canvas-aware tool names and wire part types.
const (
	WriteDraftToolName         = "write_draft"
	ProposeEditToolName        = "propose_edit"
	UpdateDraftToolName        = "update_draft"
	RequestFullRewriteToolName = "request_full_rewrite"

	FullRewriteConfirmationPartType = "data-full_rewrite_confirmation"
	FullRewriteConfirmPartType      = "data-full_rewrite_confirm"
	FullRewriteCancelPartType       = "data-full_rewrite_cancel"
	DraftUpdatedPartType            = "data-draft_updated"
)

type WriteDraftArgs struct {
	Content string `json:"content"`
}

type ProposeEditArgs struct {
	Target      string `json:"target"`
	Replacement string `json:"replacement"`
}

type UpdateDraftArgs struct {
	Instructions string `json:"instructions"`
}

type RequestFullRewriteArgs struct {
	Reason string `json:"reason"`
}

type FullRewriteConfirmationData struct {
	Reason          string `json:"reason,omitempty"`
	ChangedPercent  int    `json:"changedPercent,omitempty"`
	ProposedContent string `json:"proposedContent,omitempty"`
}

type DraftUpdatedData struct {
	EditsCount int    `json:"editsCount"`
	Summary    string `json:"summary,omitempty"`
}

const (
	WriteDraftToolDescription    = "Writes the complete markdown document draft. Use this to produce the initial first draft (when no draft exists yet) or to write the full replacement after the user has confirmed a full rewrite."
	WriteDraftContentDescription = "The complete markdown document text."
	ProposeEditToolDescription   = "Proposes a surgical edit to a specific passage in the current draft, creating an inline accept/reject diff card for the user. Use for block-level Refine requests and small/localized edits."
	ProposeEditTargetDescription = "The exact passage from the current draft to replace."
	ProposeEditReplacementDesc   = "The rewritten markdown text to replace the target passage."
	UpdateDraftToolDescription   = "Runs an anchored revision across the current draft to integrate new sources or apply broader multi-section changes while preserving untouched sections verbatim."
	UpdateDraftInstructionsDesc  = "Clear, specific instructions describing what to add, revise, reorganize, or remove in the current draft."
	RequestFullRewriteToolDesc   = "Asks the user to confirm before rewriting the entire draft from scratch. Call this on its own when the user's request requires replacing the whole document structure."
	RequestFullRewriteReasonDesc = "One plain sentence explaining why a ground-up rewrite is needed."
)

// FullRewriteProposalEcho stands in for a full-rewrite confirmation card when
// replaying transcript history to the model.
func FullRewriteProposalEcho(reason string) string {
	reason = strings.TrimSpace(reason)
	if reason == "" {
		return "[Asked the user to confirm replacing the full document draft.]"
	}
	return "[Asked the user to confirm replacing the full document draft: " + reason + "]"
}

func FullRewriteConfirmedNotice() string {
	return "The user confirmed the full-document rewrite. Write the complete replacement document now using write_draft."
}

func FullRewriteCancelledNotice() string {
	return "The user declined the full-document rewrite and chose to keep the current draft."
}

const PickerContextChangeHint = "The user just updated the active context in the picker. Briefly acknowledge what was added or removed (refer to items by source or name, never by raw ID) and ask whether they would like you to update the draft now. Do not modify the draft until they say so."

// ProjectionChatSystemPrompt builds the goal-directed, canvas-aware system
// prompt for a projection session. The live draft and standing editorial brief
// are injected freshly here on every turn so stale copies never accumulate in
// conversation history.
func ProjectionChatSystemPrompt(hasDraft, isUnnamed, fullRewriteConfirmed bool, standingBrief, liveDraft string) string {
	var sb strings.Builder

	sb.WriteString("You are a collaborative editor inside Kalaido helping the user shape a projection — a living, persistent synthesized document built from their workspace sources. Unlike an open-ended exploration chat, this session is goal-directed: help the user converge on a concrete, clear document they are ready to save.\n\n")
	sb.WriteString(ProductBrief + "\n\n" + ContextLegend + "\n\n" + MentionLegend + "\n\n" + GroundingRules + "\n\n")

	if !hasDraft {
		sb.WriteString(`Workflow — Creating the initial draft:
- You can see the active workspace sources directly.
- Once you understand what the user wants (or immediately if their opening message already makes the goal, audience, and shape clear), call "write_draft" with the complete markdown document.
- If the request is genuinely ambiguous on major choices (purpose, scope, structure, or length), ask at most two concise clarifying questions with concrete proposals grounded in the sources — do not ask unnecessary ceremony questions when the intent is clear.
`)
		if isUnnamed {
			sb.WriteString("- While the projection is unnamed, call \"suggest_name\" with a concise display name (at most 6 words, plain text) whenever you have a clear idea of what this document is.\n")
		}
	} else if fullRewriteConfirmed {
		sb.WriteString(`Workflow — Confirmed full rewrite:
- The user has confirmed replacing the full draft. Call "write_draft" with the complete new markdown document now.
`)
	} else {
		sb.WriteString(`Workflow — Editing the live draft:
- You can see the COMPLETE live draft below (including any manual edits the user made and any pending proposed edits).
- Prefer the smallest tool that fits the user's request so untouched wording stays intact:
  1. "propose_edit": Use for localized wording changes, single-section tweaks, or when the user targets a specific passage via Refine. Quote the exact "target" passage from the live draft below.
  2. "update_draft": Use for broader multi-section revisions or integrating newly added sources across the document.
  3. "request_full_rewrite": Use when the user asks to start over or completely restructure the document from scratch (this asks the user to confirm before replacing the whole body).
  4. "update_context": Use when the document would be better served by adding or removing sources. Call it on its own and wait for user confirmation.
  5. Plain conversation: Answer questions, explain trade-offs, or ask clarifying questions without mutating the draft.
- When you modify the draft via a tool, also include a brief 1–2 sentence reply summarizing what you changed.
`)
		if isUnnamed {
			sb.WriteString("- While the projection is unnamed, you may call \"suggest_name\" with a concise display name (at most 6 words, plain text).\n")
		}
	}

	sb.WriteString("\n" + UpdateContextRules)

	if strings.TrimSpace(standingBrief) != "" {
		sb.WriteString("\n\nStanding editorial brief (background guidance on purpose, structure, tone, and inclusion rules — follow unless the user asks to change direction):\n<<<\n")
		sb.WriteString(strings.TrimSpace(standingBrief))
		sb.WriteString("\n>>>")
	}

	if hasDraft {
		sb.WriteString("\n\nCurrent live draft (authoritative state the user is currently looking at):\n<<<\n")
		sb.WriteString(strings.TrimSpace(liveDraft))
		sb.WriteString("\n>>>")
	}

	return sb.String()
}

// AnchoredUpdatePrompt builds the single-call anchored prompt for updating a
// saved projection against newly arrived fragments or updated upstream snapshots.
func AnchoredUpdatePrompt(previousOutput, standingBrief, existingSources, newSources string) string {
	var sb strings.Builder
	sb.WriteString("You are updating an existing living document in Kalaido with newly arrived or updated workspace sources.\n\n")
	sb.WriteString(ContextLegend + "\n\n" + GroundingRules + "\n\n")

	if strings.TrimSpace(standingBrief) != "" {
		sb.WriteString("Standing editorial brief (purpose, structure, tone, inclusion rules):\n<<<\n")
		sb.WriteString(strings.TrimSpace(standingBrief))
		sb.WriteString("\n>>>\n\n")
	}

	if strings.TrimSpace(previousOutput) != "" {
		sb.WriteString("Current saved document:\n<<<\n")
		sb.WriteString(strings.TrimSpace(previousOutput))
		sb.WriteString("\n>>>\n\n")
	}

	if strings.TrimSpace(newSources) != "" {
		sb.WriteString("NEW / UPDATED SOURCES SINCE LAST SAVE (focus on integrating relevant information from these):\n")
		sb.WriteString(newSources)
		sb.WriteString("\n\n")
	}

	if strings.TrimSpace(existingSources) != "" {
		sb.WriteString("EXISTING SOURCES (already reflected in the saved document; provided for reference):\n")
		sb.WriteString(existingSources)
		sb.WriteString("\n\n")
	}

	sb.WriteString(`Task:
Review the new/updated sources against the current saved document and standing editorial brief.
- If the new sources contain relevant new information, updates, or corrections: integrate them cleanly into the document while preserving untouched sections, phrasing, and formatting verbatim so the diff stays minimal.
- If the new sources do NOT warrant any edits to the document (e.g. off-topic, already covered, or no material change): do NOT rewrite the document; output NO_CHANGES inside <document>.

Respond in exactly this XML format:
<summary>
1-3 concise sentences addressed to the user explaining what you updated (or why the new sources did not warrant changes). Refer to sources by name/source, never by raw ID.
</summary>
<document>
The complete updated markdown document, OR exactly NO_CHANGES if no edits are needed.
</document>`)

	return sb.String()
}

// ParseAnchoredUpdateResponse parses the <summary> and <document> tags from
// AnchoredUpdatePrompt's response, gracefully falling back to plain text if the
// model omitted XML wrappers.
func ParseAnchoredUpdateResponse(raw string) (summary, doc string, noChanges bool) {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return "", "", true
	}

	if strings.EqualFold(trimmed, "NO_CHANGES") || strings.EqualFold(trimmed, SnapshotNoChanges) {
		return "I reviewed the new sources and found no changes needed for the current document.", "", true
	}

	summary = extractTag(trimmed, "summary")
	doc = extractTag(trimmed, "document")

	if doc != "" {
		if strings.EqualFold(doc, "NO_CHANGES") || strings.EqualFold(doc, SnapshotNoChanges) {
			if summary == "" {
				summary = "I reviewed the new sources and found no changes needed for the current document."
			}
			return summary, "", true
		}
		if summary == "" {
			summary = "I've updated the draft with the latest sources."
		}
		return summary, doc, false
	}

	// Fallback: model returned plain markdown without XML tags.
	if summary == "" {
		summary = "I've updated the draft with the latest sources."
	}
	return summary, trimmed, false
}

func extractTag(s, tag string) string {
	openTag := "<" + tag + ">"
	closeTag := "</" + tag + ">"
	start := strings.Index(s, openTag)
	if start == -1 {
		return ""
	}
	start += len(openTag)
	end := strings.Index(s[start:], closeTag)
	if end == -1 {
		return strings.TrimSpace(s[start:])
	}
	return strings.TrimSpace(s[start : start+end])
}

// AnchoredUpdateDraftPrompt builds the single-call anchored prompt used by the
// in-session update_draft tool for broad multi-section edits or integrating new
// sources added mid-session.
func AnchoredUpdateDraftPrompt(currentDraft, standingBrief, sources, instructions string) string {
	var sb strings.Builder
	sb.WriteString("You are revising an existing markdown draft in Kalaido.\n\n")
	sb.WriteString(ContextLegend + "\n\n" + GroundingRules + "\n\n")

	if strings.TrimSpace(standingBrief) != "" {
		sb.WriteString("Standing editorial brief:\n<<<\n")
		sb.WriteString(strings.TrimSpace(standingBrief))
		sb.WriteString("\n>>>\n\n")
	}

	if strings.TrimSpace(sources) != "" {
		sb.WriteString("Active workspace sources:\n")
		sb.WriteString(sources)
		sb.WriteString("\n\n")
	}

	sb.WriteString("Current draft:\n<<<\n")
	sb.WriteString(strings.TrimSpace(currentDraft))
	sb.WriteString("\n>>>\n\n")

	sb.WriteString("Revision instructions:\n")
	sb.WriteString(strings.TrimSpace(instructions))
	sb.WriteString("\n\nTask: Apply the revision instructions to the current draft. Preserve all untouched blocks, headings, phrasing, and formatting verbatim so only the necessary parts change. Output ONLY the complete revised markdown document with no wrapper tags or commentary.")
	return sb.String()
}

// DistillLivingBriefSystemPrompt is the system prompt for the asynchronous
// post-Save living editorial brief distillation job.
const DistillLivingBriefSystemPrompt = `You are an editorial strategist inside Kalaido. Your job is to distill or update a concise, standalone "living editorial brief" for a projection after the user saves a version of it.

A living editorial brief guides future updates and forks of this document. It captures the document's standing purpose, audience, structure/sections, tone, target length/density, and inclusion/exclusion rules — inferred from the saved document, any prior brief, the user's conversation, and the edits they accepted or wrote by hand.

Hard rules:
- Data-agnostic: describe HOW to synthesize and structure the document, NOT specific source facts, dates, names, numbers, or verbatim sentences copied from current notes.
- Do not pin fixed counts of items ("list all open risks", never "list 5 risks").
- Preserve still-valid standing guidance from the previous brief while reflecting any clear shifts in direction, structure, tone, or scope from this session.
- Keep it crisp, scannable, and practical (typically 120–300 words).
- Output ONLY the editorial brief text — no markdown code fences, no preamble, no sign-off.`

// DistillLivingBriefUserPrompt builds the user prompt for async brief distillation.
func DistillLivingBriefUserPrompt(previousBrief, finalOutput, transcriptSummary, editsSummary string) string {
	var sb strings.Builder
	if strings.TrimSpace(previousBrief) != "" {
		sb.WriteString("Previous editorial brief:\n<<<\n")
		sb.WriteString(strings.TrimSpace(previousBrief))
		sb.WriteString("\n>>>\n\n")
	} else {
		sb.WriteString("Previous editorial brief: (none yet — this is the first brief for this projection)\n\n")
	}

	sb.WriteString("Final saved document:\n<<<\n")
	sb.WriteString(strings.TrimSpace(finalOutput))
	sb.WriteString("\n>>>\n\n")

	if strings.TrimSpace(transcriptSummary) != "" {
		sb.WriteString("Session conversation highlights:\n<<<\n")
		sb.WriteString(strings.TrimSpace(transcriptSummary))
		sb.WriteString("\n>>>\n\n")
	}

	if strings.TrimSpace(editsSummary) != "" {
		sb.WriteString("Manual & accepted edits in this session:\n<<<\n")
		sb.WriteString(strings.TrimSpace(editsSummary))
		sb.WriteString("\n>>>\n\n")
	}

	sb.WriteString(fmt.Sprintf("Write the updated living editorial brief now."))
	return sb.String()
}
