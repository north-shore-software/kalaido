package prompts

import (
	"fmt"
	"strconv"
	"strings"

	"github.com/pocketbase/pocketbase/tools/types"
)

// The distillation loop is one growing conversation with the optimizer model:
// DistillLoopSystem sets the rules, DistillLoopInitial asks for the first lens,
// and after each candidate is executed (by a separate, stateless production
// apply call) DistillLoopFeedback shows the optimizer what its lens actually
// produced. ParseLoopReply reads the verdict back. The executor never sees this
// conversation, so every lens must stand alone.

const DistillLoopSystem = `You are an expert AI prompt engineer. Your job is to write a single, comprehensive instruction prompt — called a "lens". When the lens is applied to the source documents by another model, it must reliably reproduce the exact format, style, structure, and emphasis of the target output — and it must keep working when the source documents later change.

Hard rules for every lens you write:
- The lens must be data-agnostic: it describes HOW to transform source documents into an output. It must not contain facts, names, dates, numbers, or verbatim sentences copied from the source documents or from the target output.
- A lens that amounts to "output the following text" is forbidden, even partially: it would break the moment the source documents change.
- The lens must stand alone: the model applying it sees only the lens and the source documents, never this conversation.

You will first be shown the source documents, the user's refinement conversations about this document, and the target output, and asked to write the lens. Reply with the lens text only — no preamble, no commentary.

After that, each lens you write is executed against the source documents exactly as production will run it, and you are shown the output it produced. Compare that output with the target output and reply in exactly one of these two formats:

If the output is close enough to the target that the user would accept it as the same document:
VERDICT: MATCH

Otherwise:
VERDICT: MISMATCH
SCORE: <0-100, how close the output is to the target>
DIAGNOSIS: <what concretely differs, and which part of your lens caused it>
REVISED LENS:
<the full text of the improved lens>

The diagnosis is mandatory: name the concrete differences before rewriting. Never repeat a lens that already failed — use the full history of attempts in this conversation to avoid repeating mistakes. Check every revision against the hard rules: if an earlier lens quoted the target, the revision must generalize instead.`

// Section headings inside the initial optimizer message.
const (
	RefinementHistoryHeading = "Refinement Conversations — the user's own words about how the output should look. Earlier conversations are historical context; the most recent one produced the target output:\n\n"
	TargetOutputHeading      = "Target Output — the user approved exactly this:\n"

	HistoryCurrentLabel    = "current — this conversation produced the target output"
	HistoryHistoricalLabel = "historical — an earlier refinement of the same document"
)

// DistillLoopInitial opens the optimizer conversation. historyBlock may be
// empty (a first-ever creation, or only zero-message refinements).
func DistillLoopInitial(sourceBlock, historyBlock, target string) string {
	var sb strings.Builder
	sb.WriteString(BuildPrefix(sourceBlock, types.DateTime{}, types.DateTime{}))
	if historyBlock != "" {
		sb.WriteString(historyBlock)
	}
	sb.WriteString(TargetOutputHeading + target + "\n\n")
	sb.WriteString("Task: Write the lens. Reply with the lens text only.\nLens:")
	return sb.String()
}

// RefinementHistoryBlock renders one refinement conversation for the optimizer.
// label is HistoryCurrentLabel or HistoryHistoricalLabel; transcript is the
// already-rendered turns (see HistoryTurnLine).
func RefinementHistoryBlock(ordinal int, label, transcript string) string {
	return fmt.Sprintf("--- refinement conversation %d (%s) ---\n%s\n", ordinal, label, transcript)
}

func HistoryTurnLine(role, text string) string {
	return role + ": " + text + "\n"
}

// DistillLoopFeedback shows the optimizer what its latest lens produced.
func DistillLoopFeedback(candidate string) string {
	return "Your lens was executed against the source documents exactly as production will run it. It produced:\n\n" +
		"--- lens output ---\n" + candidate + "\n--- end lens output ---\n\n" +
		"Compare this output with the Target Output above and reply in the required format: either the single line \"VERDICT: MATCH\", or \"VERDICT: MISMATCH\" with SCORE, DIAGNOSIS and REVISED LENS."
}

// Reply-protocol markers, shared between the prompts above and ParseLoopReply.
const (
	verdictPrefix     = "VERDICT:"
	scorePrefix       = "SCORE:"
	diagnosisPrefix   = "DIAGNOSIS:"
	revisedLensMarker = "REVISED LENS:"
)

type LoopReply struct {
	Match     bool
	Score     int    // 0–100; 0 when absent or unparseable
	Diagnosis string // logging only
	Lens      string // the revised lens; empty on Match
}

// ParseLoopReply reads a feedback-turn reply. Returns ok=false when the reply
// does not follow the protocol at all (no verdict, or a mismatch without a
// revised lens) — the loop then stops and keeps its best candidate rather than
// trusting an unparseable rewrite.
func ParseLoopReply(text string) (LoopReply, bool) {
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
		return LoopReply{Match: true}, true
	case "MISMATCH":
		// fall through to the detailed parse below
	default:
		return LoopReply{}, false
	}

	var r LoopReply
	rest := text
	if i := strings.Index(rest, revisedLensMarker); i >= 0 {
		r.Lens = strings.TrimSpace(rest[i+len(revisedLensMarker):])
		rest = rest[:i]
	}
	for _, line := range strings.Split(rest, "\n") {
		line = strings.TrimSpace(line)
		if v, found := strings.CutPrefix(line, scorePrefix); found {
			if n, err := strconv.Atoi(strings.TrimSpace(v)); err == nil && n >= 0 && n <= 100 {
				r.Score = n
			}
		}
		if v, found := strings.CutPrefix(line, diagnosisPrefix); found {
			r.Diagnosis = strings.TrimSpace(v)
		}
	}
	if r.Lens == "" {
		return LoopReply{}, false
	}
	return r, true
}
