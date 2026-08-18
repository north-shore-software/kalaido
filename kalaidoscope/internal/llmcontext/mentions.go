package llmcontext

import (
	"regexp"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/prompts"
)

// mentionRe matches the wire form of a named-source mention, @[Kind:id|Label],
// inserted by the client's @-menu. The client resolves the mention to a concrete
// record at compose time and sanitizes the label (no "]", "|" or newlines), so
// there is no escaping grammar here: anything that doesn't match — a hand-typed
// broken token, an email address, a bare "@" — passes through as literal text.
// The TS side keeps a mirrored regex; change them together.
var mentionRe = regexp.MustCompile(`@\[(Fragment|Projection|Reflection|Colour|Type):([A-Za-z0-9_-]{1,32})\|([^\]\r\n]{0,80})\]`)

// ExpandMentions rewrites every mention token in text into the model-facing
// reference form defined in prompts. It is the single such rewrite: both the
// live chat flattening and the lens intent timeline must apply it, so the model
// (and later the lens generator) see the same joinable reference. The raw wire
// form is what persists; expansion happens only at prompt-assembly time.
func ExpandMentions(text string) string {
	return mentionRe.ReplaceAllStringFunc(text, func(tok string) string {
		m := mentionRe.FindStringSubmatch(tok)
		kind, id, label := m[1], m[2], m[3]
		if label == "" {
			label = id
		}
		switch kind {
		case "Fragment":
			return prompts.FragmentMention(label, id)
		case "Projection":
			return prompts.ProjectionMention(label, id)
		case "Reflection":
			return prompts.ReflectionMention(label, id)
		case "Colour":
			return prompts.ColourMention(label)
		default: // Type: the id is the fragment-type enum string itself.
			return prompts.TypeMention(id)
		}
	})
}
