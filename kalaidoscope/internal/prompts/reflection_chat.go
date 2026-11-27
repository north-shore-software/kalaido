package prompts

import (
	"fmt"
	"strings"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/api"
)

// Reflection standing-lens authoring tool name and args.
const (
	SetLensToolName = "set_lens"

	SetLensToolDescription   = "Writes or updates the reflection's complete standing lens instruction in one step. The server immediately runs this instruction in isolation against the active sample window's fragments (with zero chat history) and shows the preview to the user."
	SetLensPromptDescription = "The complete, standalone, data-agnostic standing instruction that will be applied independently to each time window's fragments."
)

type SetLensArgs struct {
	Prompt string `json:"prompt"`
}

// ReflectionChatSystemPrompt builds the system prompt for authoring and
// iterating on a reflection's standing lens. Unlike projections, reflections
// generate each time window independently from scratch using only the standing
// lens and that window's fragments.
//
// The current standing lens and the single latest sample-window preview (with
// its window bounds) are injected freshly here on every turn so the assistant
// can see what the lens produced without stale previews piling up in history.
func ReflectionChatSystemPrompt(hasLens, isUnnamed bool, currentLens, latestPreview string, previewWin *api.Window) string {
	var sb strings.Builder

	sb.WriteString("You are an assistant inside Kalaido helping the user author a standing lens for a Reflection — a recurring or bounded time-window summary over their workspace fragments (fragments and colours only, never other projections or reflections).\n\n")
	sb.WriteString(ProductBrief + "\n\n" + ContextLegend + "\n\n" + MentionLegend + "\n\n" + GroundingRules + "\n\n")

	sb.WriteString(`Your tools:
1. "set_lens": Writes or replaces the reflection's complete standing lens prompt directly in one step. Every time you call "set_lens", the server immediately runs that lens strictly in isolation against the active sample window's fragments (zero chat history — identical to scheduled runs) and shows the preview to the user.
2. "update_context": Proposes adding or removing fragment/colour sources in the active context (reflections use fragments and colours only). Call it on its own and wait for user confirmation.
`)
	if isUnnamed {
		sb.WriteString("3. \"suggest_name\": Proposes a concise display name (at most 6 words, plain text) while the reflection is unnamed.\n")
	}

	sb.WriteString(`
How reflection authoring works — internalize this:
- You are authoring a STANDING LENS (reusable instruction), NOT editing a single document.
- Each time window in the reflection's series will be generated independently from scratch using ONLY the standing lens and the fragments that occurred inside that window — never this conversation.
- You CANNOT edit preview text directly. The preview shown below is strictly read-only output produced by running the standing lens against the sample window in isolation. The ONLY way to change what the preview looks like is to revise the standing lens by calling "set_lens" with an updated complete prompt.
- When the user gives feedback on the preview (for example "too long", "lead with blockers", "group by project", "drop small talk"), diagnose why the standing lens produced that output and call "set_lens" with an improved complete standing lens. Include a brief 1–2 sentence reply explaining how you adjusted the lens.
`)

	if !hasLens {
		sb.WriteString(`
Workflow — Initial standing lens:
- If the user's request already makes the goal, focus, shape, and rough length clear, call "set_lens" right away so they can react to a real preview.
- If the request is genuinely ambiguous on major choices (what to surface, structure, or target length), ask at most two concise clarifying questions with concrete proposals drawn from the fragments.
`)
	}

	sb.WriteString(`
Hard rules for every standing lens:
- Data-agnostic: describe HOW to summarize any time window's fragments, NEVER copy specific facts, names, dates, numbers, or verbatim sentences from the sample window into the lens.
- Standalone: the model running scheduled windows sees ONLY the standing lens and that window's fragments, never this chat.
- No fixed item counts: write "list the key blockers" or "capture each distinct theme", never "list 5 blockers".
- Specify output shape, tone, inclusion/exclusion rules, and target length/density clearly so scheduled runs stay consistent across windows.

` + UpdateContextRules)

	if strings.TrimSpace(currentLens) != "" {
		sb.WriteString("\n\nCurrent standing lens:\n<<<\n")
		sb.WriteString(strings.TrimSpace(currentLens))
		sb.WriteString("\n>>>")
	}

	if strings.TrimSpace(latestPreview) != "" {
		header := "Latest sample-window preview (read-only"
		if previewWin != nil && previewWin.Start != "" && previewWin.End != "" {
			header += fmt.Sprintf(" — window %s to %s", previewWin.Start, previewWin.End)
		}
		header += "):"
		sb.WriteString("\n\n" + header + "\n<<<\n")
		sb.WriteString(strings.TrimSpace(latestPreview))
		sb.WriteString("\n>>>\nRemember: this preview is read-only. You cannot edit preview text directly; call \"set_lens\" with a revised standing lens prompt to change future previews and scheduled windows.")
	}

	return sb.String()
}
