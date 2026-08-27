package prompts

import (
	"fmt"
	"strconv"
	"strings"
)

// Lens distillation runs as three separated threads so the lens can never be a
// memorized copy of the approved output:
//
//   - The generator (DistillGenSystem) writes candidate lenses. It sees the
//     intent timeline — the user's refinement conversations with source-context
//     changes shown inline — but NEVER the approved target document.
//   - Each candidate is executed by a separate, stateless production apply call
//     that sees only the lens and the current source documents.
//   - The critic (DistillCriticSystem) is the only thread that holds the
//     target. It compares each candidate's output with the target and replies
//     with a verdict; on mismatch its diagnosis — generalizable rules, never
//     target content — is relayed to the generator as feedback.

const DistillGenSystem = `You are an expert AI prompt engineer. Your job is to write a single, comprehensive instruction prompt — called a "lens". When the lens is applied to the source documents by another model, it must reliably produce the document the user wants — matching the structure, style, and emphasis they settled on in their refinement conversations — and it must keep working when the source documents later change.

You will be shown the document's full history: the user's refinement conversations, in order, with changes to the source documents shown inline at the point where they happened. You will never be shown the approved document itself. After each lens you write is executed, a reviewer who has seen the approved document tells you what to fix, in general terms.

Hard rules for every lens you write:
- The lens must be data-agnostic: it describes HOW to transform source documents into an output. It must not contain facts, names, dates, numbers, or verbatim sentences copied from the source documents.
- The lens must not pin the output to specific content: no fixed item counts, no enumerated titles, no fixed orderings. Selection, ordering, and grouping must be expressed as rules the applying model evaluates against whatever the source documents contain at the time. Example of this failure: the sources currently describe 8 use cases, so the lens says "capture all distinct use cases (8 in total)" — when a 9th use case is later added to the sources, the applying model obeys the count and silently drops an existing item to stay at 8. Write "capture every distinct use case found in the source documents" instead; the count is whatever the sources yield.
- The lens must stand alone: the model applying it sees only the lens and the source documents, never this conversation.

Every reply you send must be the full text of the lens and nothing else — no preamble, no commentary.`

// Framing for the intent timeline inside the generator's opening message.
const (
	TimelineHeading = "Document history — the user's refinement conversations about this document, in order. Changes to the source documents are shown inline at the point where they happened, so read each remark against the sources as they stood at that moment:\n\n"

	// TimelineSourcesHeading opens the fallback timeline when no conversation
	// recorded its context state: the current sources stand in for the history.
	TimelineSourcesHeading = "Current source documents — the material the lens will be applied to:\n\n"

	TimelineClosing = "End of history. The source documents, as modified by the changes shown above, are the current material the lens will be applied to.\n\n"

	HistoryCurrentLabel    = "current — the result of this conversation is what the user approved"
	HistoryHistoricalLabel = "historical — an earlier refinement of the same document"
)

// DistillGenInitial opens the generator conversation with the intent timeline.
func DistillGenInitial(timelineBlock string) string {
	var sb strings.Builder
	sb.WriteString(TimelineHeading)
	sb.WriteString(timelineBlock)
	sb.WriteString(TimelineClosing)
	sb.WriteString("Task: Write the lens. Reply with the lens text only.\nLens:")
	return sb.String()
}

// RefinementHistoryBlock renders one refinement conversation for the timeline.
// label is HistoryCurrentLabel or HistoryHistoricalLabel; transcript is the
// already-rendered turns and inline context changes.
func RefinementHistoryBlock(ordinal int, label, transcript string) string {
	return fmt.Sprintf("--- refinement conversation %d (%s) ---\n%s\n", ordinal, label, transcript)
}

func HistoryTurnLine(role, text string) string {
	return role + ": " + text + "\n"
}

// ContextChangeBlock renders one inline source-context change (the hydrated
// add/remove delta from llmcontext.HydrateDeltaToText) inside the timeline.
func ContextChangeBlock(delta string) string {
	return "[source documents changed at this point]\n" + delta + "[end of source document change]\n"
}

// DistillGenFeedback relays the critic's diagnosis to the generator.
func DistillGenFeedback(diagnosis string) string {
	return "Your lens was executed against the source documents exactly as production will run it. A reviewer compared the output it produced with the document the user approved. The reviewer's feedback:\n\n" +
		diagnosis + "\n\n" +
		"Rewrite the lens to address this feedback, keeping the hard rules. Reply with the full text of the revised lens only."
}

const DistillCriticSystem = `You are a meticulous reviewer. You hold the target document — the exact output the user approved. Another model writes "lenses": instruction prompts that transform source documents into an output. You will be shown, one at a time, the output each candidate lens produced when executed against the current source documents. Decide whether the user would accept the candidate output as the same document as the target.

Reply in exactly one of these two formats.

If the user would accept the candidate as the same document:
VERDICT: MATCH

Otherwise:
VERDICT: MISMATCH
SCORE: <0-100, how close the candidate is to the target>
DIAGNOSIS: <what to fix>

Hard rules for the diagnosis: it is relayed to the lens writer, who must never see the target. Describe what differs as generalizable rules about structure, formatting, style, tone, length, and coverage — for example "each item should be a single italicized sentence" or "the output over-explains mechanics". Never name, list, count, or quote specific content from the target: no titles, no names, no facts, no verbatim phrases. A diagnosis that reveals target content defeats the purpose of the review. Never repeat feedback that was already addressed; judge each candidate on its own output.`

// DistillCriticInitial opens the critic conversation: the target (this thread
// is the only place it exists) together with the first candidate.
func DistillCriticInitial(target, candidate string) string {
	return "Target document — the user approved exactly this:\n" + target + "\n\n" +
		DistillCriticCandidate(candidate)
}

// DistillCriticCandidate presents one executed candidate output for review.
func DistillCriticCandidate(candidate string) string {
	return "--- candidate output ---\n" + candidate + "\n--- end candidate output ---\n\n" +
		"Compare this candidate with the target document and reply in the required format."
}

// Reply-protocol markers, shared between the prompts above and ParseCriticReply.
const (
	verdictPrefix   = "VERDICT:"
	scorePrefix     = "SCORE:"
	diagnosisPrefix = "DIAGNOSIS:"
)

type CriticReply struct {
	Match     bool
	Score     int    // 0–100; 0 when absent or unparseable
	Diagnosis string // relayed to the generator; empty on Match
}

// ParseCriticReply reads a critic reply. Returns ok=false when the reply does
// not follow the protocol at all (no verdict, or a mismatch without a
// diagnosis) — the loop then stops and keeps its best candidate rather than
// relaying nothing.
func ParseCriticReply(text string) (CriticReply, bool) {
	verdict := ""
	for _, line := range strings.Split(text, "\n") {
		line = strings.TrimSpace(line)
		if v, found := strings.CutPrefix(line, verdictPrefix); found {
			verdict = strings.ToUpper(strings.TrimSpace(v))
			break
		}
	}

	switch verdict {
	case "MATCH":
		return CriticReply{Match: true}, true
	case "MISMATCH":
		// fall through to the detailed parse below
	default:
		return CriticReply{}, false
	}

	var r CriticReply
	rest := text
	// The diagnosis runs from its marker to the end of the message, so it may
	// span multiple lines.
	if i := strings.Index(rest, diagnosisPrefix); i >= 0 {
		r.Diagnosis = strings.TrimSpace(rest[i+len(diagnosisPrefix):])
		rest = rest[:i]
	}
	for _, line := range strings.Split(rest, "\n") {
		line = strings.TrimSpace(line)
		if v, found := strings.CutPrefix(line, scorePrefix); found {
			if n, err := strconv.Atoi(strings.TrimSpace(v)); err == nil && n >= 0 && n <= 100 {
				r.Score = n
			}
		}
	}
	if r.Diagnosis == "" {
		return CriticReply{}, false
	}
	return r, true
}
