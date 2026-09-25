package prompts

import (
	"strings"
	"testing"
)

// Both refinement prompts advertise update_context and carry the shared
// rules; the tool is a proposal the app puts to the user, and the prompts
// must say so.
func TestUpdateContextToolInstructions(t *testing.T) {
	for name, prompt := range map[string]string{
		"RefinementCreationPrompt": RefinementCreationPrompt,
		"RefinementRevisionPrompt": RefinementRevisionPrompt,
	} {
		if !strings.Contains(prompt, `"`+UpdateContextToolName+`"`) {
			t.Errorf("%s does not quote tool %q", name, UpdateContextToolName)
		}
		for _, marker := range []string{
			"nothing changes until they do", // the confirmation gate
			"on its own",                    // never alongside another tool
			"Do not invent IDs",             // the model cannot see outside the context
		} {
			if !strings.Contains(prompt, marker) {
				t.Errorf("%s lost the %q rule", name, marker)
			}
		}
	}
}

// Length is an essential the interview must settle explicitly and the lens
// must carry, so the applying model never chooses it.
func TestLengthIsSettledAndCarried(t *testing.T) {
	if !strings.Contains(RefinementCreationPrompt, "never assume a length") {
		t.Error("RefinementCreationPrompt no longer asks for the target length")
	}
	for name, prompt := range map[string]string{
		"RefinementCreationPrompt": RefinementCreationPrompt,
		"RefinementRevisionPrompt": RefinementRevisionPrompt,
		"LensCompilerSystemPrompt": LensCompilerSystemPrompt,
	} {
		if !strings.Contains(prompt, "target length") {
			t.Errorf("%s does not require the lens to state the target length", name)
		}
	}
}

func TestRegenerateSupersededNotice(t *testing.T) {
	cases := []struct {
		superseded, kept []int
		want             string
	}{
		{[]int{3}, nil, "Regeneration superseded edit #3."},
		{[]int{2, 4, 7}, nil, "Regeneration superseded edits #2, #4 and #7."},
		{nil, []int{1}, "Accepted edit #1 still stands: the regenerated text kept the passage."},
		{[]int{2}, []int{1, 3}, "Regeneration superseded edit #2. Accepted edits #1 and #3 still stand: the regenerated text kept the passage."},
	}
	for _, c := range cases {
		if got := RegenerateSupersededNotice(c.superseded, c.kept); got != c.want {
			t.Errorf("RegenerateSupersededNotice(%v, %v)\n got %q\nwant %q", c.superseded, c.kept, got, c.want)
		}
	}
}

func TestContextProposalEcho(t *testing.T) {
	if got := ContextProposalEcho("  Add the kickoff notes.  "); !strings.HasSuffix(got, ": Add the kickoff notes.]") {
		t.Errorf("got %q", got)
	}
	if got := ContextProposalEcho(""); strings.Contains(got, ":") {
		t.Errorf("empty reason should have no colon: %q", got)
	}
}
