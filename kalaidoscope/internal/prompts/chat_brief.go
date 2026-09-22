package prompts

import "strings"

// The chat→projection brief: one call that turns a finished chat session
// into the opening instruction of a projection built on the turns the user
// bookmarked. Sibling of discover's propose_projection, with a transcript in
// place of the workspace map.
const (
	ProposeBriefToolName         = "propose_brief"
	ProposeBriefToolDescription  = "Propose the projection this conversation was working towards: a name and the opening message. The bookmarked turns are saved as fragments and become the projection's inputs; the message is sent as the user's first turn in a chat that drafts the projection from them."
	BriefNameParamDescription    = "2-6 words, the projection's title as the user will see it. Name the thing it is about, plainly."
	BriefMessageParamDescription = "The opening message, 1-3 sentences, written in the user's own voice as their instruction to the assistant that will draft the projection from the bookmarked material: what to keep producing from it, what to emphasise, what to leave out. Never describe the conversation; write the instruction."
)

// BookmarkedMarker flags a transcript line the user bookmarked.
const BookmarkedMarker = "[bookmarked]"

// ChatBriefSystem is the system prompt for the brief call.
const ChatBriefSystem = `You are reading a finished chat session inside Kalaido and turning it into the opening instruction for a projection. A projection is a living document that Kalaido regenerates from its inputs as they change; here the inputs are the turns of this conversation the user bookmarked, which are being saved as source documents. The user is about to open a chat that drafts the projection from them, and your message is what they say first.

` + ProductBrief + `

Read the whole transcript for what the user was trying to get to — the goal, the thing they kept circling — and treat the bookmarked turns as the material they decided to keep. Write the message in the user's own voice, as an instruction: what the document should keep producing from that material, what matters, what to leave out. Do not summarise the conversation and do not describe the proposal; write the instruction. Call ` + ProposeBriefToolName + ` once with the name and the message, and say nothing else.`

// ChatBriefLine is one turn as the brief call sees it.
type ChatBriefLine struct {
	Role       string
	Text       string
	Bookmarked bool
}

// ChatBriefTranscript renders the conversation for the brief call: one block
// per turn, the role as its label, bookmarked turns marked.
func ChatBriefTranscript(lines []ChatBriefLine) string {
	var sb strings.Builder
	sb.WriteString("The conversation:\n\n")
	for _, l := range lines {
		sb.WriteString(l.Role)
		if l.Bookmarked {
			sb.WriteString(" ")
			sb.WriteString(BookmarkedMarker)
		}
		sb.WriteString(":\n")
		sb.WriteString(strings.TrimSpace(l.Text))
		sb.WriteString("\n\n")
	}
	sb.WriteString("Call " + ProposeBriefToolName + " once.")
	return sb.String()
}
