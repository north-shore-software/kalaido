package engine

import "regexp"

// countPinPatterns match a number in totality phrasings — a lens that pins the
// output's overall item count ("(8 in total)", "all 9 use cases") silently
// drops content when the sources later grow past the pinned count. Per-item
// structural counts ("exactly two bullet points under each section") are
// deliberately not matched: they are legitimate formatting rules, and flagging
// them would burn effort rewriting correct lenses.
var countPinPatterns = func() []*regexp.Regexp {
	const num = `(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty)`
	return []*regexp.Regexp{
		regexp.MustCompile(`(?i)\b` + num + `\s+in\s+total\b`),
		regexp.MustCompile(`(?i)\btotal\s+of\s+` + num + `\b`),
		regexp.MustCompile(`(?i)\b` + num + `\s+total\b`),
		regexp.MustCompile(`(?i)\ball\s+` + num + `\b`),
	}
}()

// LensCountPin returns the first phrase pinning the lens's output to a fixed
// item count, or "" when the lens is clean.
func LensCountPin(lens string) string {
	for _, re := range countPinPatterns {
		if m := re.FindString(lens); m != "" {
			return m
		}
	}
	return ""
}
