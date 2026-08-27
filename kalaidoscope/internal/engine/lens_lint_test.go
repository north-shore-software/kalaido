package engine

import (
	"context"
	"strings"
	"sync"
	"testing"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/api"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/llmcontext"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/pbtest"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/pbutil"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/prompts"
	"github.com/north-shore-software/kalaido/kalaidoscope/llm"
)

func TestLensCountPin(t *testing.T) {
	positives := []string{
		"Ensure all distinct use cases (8 in total) are captured.",
		"Ensure eight in total are captured.",
		"The output must contain a total of 12 entries.",
		"Capture all 9 use cases from the sources.",
		"Produce 8 total sections.",
	}
	for _, lens := range positives {
		if got := lensCountPin(lens); got == "" {
			t.Errorf("lensCountPin(%q) = clean, want a match", lens)
		}
	}

	// Per-item structural counts and count-free selection rules are legitimate
	// and must never trip the lint (they appear in healthy lenses).
	negatives := []string{
		"Include exactly two bullet points under each section.",
		"The description must be between 2 and 4 words long.",
		"Capture every distinct use case found in the source documents.",
		"Provide three nested sub-bullets for rich, fully articulated primary use cases.",
		"Format each persona as a single bullet item.",
	}
	for _, lens := range negatives {
		if got := lensCountPin(lens); got != "" {
			t.Errorf("lensCountPin(%q) = %q, want clean", lens, got)
		}
	}
}

// lintScriptProvider plays a distillation where the generator's first lens
// pins an item count. The lint must send it back for a rewrite in the same
// conversation — without executing or critiquing it — and the rewritten,
// count-free lens then converges.
type lintScriptProvider struct{}

func (lintScriptProvider) ContextWindow() int { return 256_000 }

var (
	lintMu           sync.Mutex
	lintGenCalls     [][]llm.Message
	lintCriticCalls  int
	lintExecuteCalls int
)

const pinnedLens = "Capture all use cases (8 in total) as numbered sections."

func (lintScriptProvider) Stream(ctx context.Context, msgs []llm.Message, tools []llm.Tool, opts llm.GenOptions) (*llm.Completion, error) {
	var reply string
	switch {
	case msgs[0].Role == "system" && msgs[0].Content == prompts.DistillGenSystem:
		lintMu.Lock()
		lintGenCalls = append(lintGenCalls, msgs)
		n := len(lintGenCalls)
		lintMu.Unlock()
		if n == 1 {
			reply = pinnedLens
		} else {
			reply = "CLEAN LENS"
		}
	case msgs[0].Role == "system" && msgs[0].Content == prompts.DistillCriticSystem:
		lintMu.Lock()
		lintCriticCalls++
		lintMu.Unlock()
		reply = "VERDICT: MATCH"
	default: // stateless production apply
		lintMu.Lock()
		lintExecuteCalls++
		lintMu.Unlock()
		reply = "TARGET OUTPUT"
	}
	ch := make(chan llm.StreamEvent, 1)
	ch <- llm.StreamEvent{Kind: llm.EventText, Text: reply}
	close(ch)
	return &llm.Completion{Events: ch, Wait: func() *llm.Usage { return nil }}, nil
}

func TestDistillLintRejectsCountPinnedCandidate(t *testing.T) {
	app := pbtest.NewApp(t)
	lintMu.Lock()
	lintGenCalls, lintCriticCalls, lintExecuteCalls = nil, 0, 0
	lintMu.Unlock()
	llm.SetProviderFactory(func(model string, cfg llm.WorkspaceConfig) llm.Provider {
		return lintScriptProvider{}
	})
	t.Cleanup(func() {
		// Restore what this package's init() installed for the other tests.
		llm.SetProviderFactory(func(model string, cfg llm.WorkspaceConfig) llm.Provider {
			return scriptedProvider{}
		})
	})

	frag := pbtest.NewRecord(t, app, "fragment", map[string]any{"type": "note", "content": "raw notes"})
	spec := api.ContextSpec{WholeScope: true}
	proj := pbtest.NewRecord(t, app, "projection", map[string]any{
		"name":                 "P",
		"current_context_spec": pbutil.JSONObject(spec),
	})
	pbtest.NewRecord(t, app, "projection_snapshot", map[string]any{
		"projection_id":            proj.Id,
		"status":                   StatusApproved,
		"output":                   pbutil.JSONString("TARGET OUTPUT"),
		"context_spec":             pbutil.JSONObject(spec),
		"resolved_context":         pbutil.JSONObject(llmcontext.PinnedIDs{FragmentIDs: []string{frag.Id}}),
		"lens_distill_requested":   true,
		"approval_sequence_number": 1,
	})

	runDistillPass(app)

	proj, err := app.FindRecordById("projection", proj.Id)
	if err != nil {
		t.Fatal(err)
	}
	lens, err := app.FindRecordById("lens", proj.GetString("current_lens_id"))
	if err != nil {
		t.Fatal("projection has no lens after pass:", err)
	}
	if got := pbutil.DecodeJSONString(lens.GetString("prompt")); got != "CLEAN LENS" {
		t.Fatalf("lens prompt = %q, want the rewritten count-free lens", got)
	}
	if got := lens.GetInt("iterations"); got != 2 {
		t.Fatalf("iterations = %d, want 2 (linted candidate + rewrite)", got)
	}
	if !lens.GetBool("converged") {
		t.Fatal("converged = false, want true")
	}

	lintMu.Lock()
	genSeen := append([][]llm.Message(nil), lintGenCalls...)
	criticCalls, executeCalls := lintCriticCalls, lintExecuteCalls
	lintMu.Unlock()

	// The lint reply landed in the same generator conversation, quoting the
	// offending phrase — and the pinned candidate was never executed or
	// critiqued (only the clean rewrite ran, and it matched the target
	// byte-for-byte so the critic was never needed).
	if len(genSeen) != 2 {
		t.Fatalf("generator calls = %d, want 2", len(genSeen))
	}
	feedback := genSeen[1][len(genSeen[1])-1].Content
	if !strings.Contains(feedback, "8 in total") || !strings.Contains(feedback, "fixed item count") {
		t.Errorf("lint feedback turn missing the violation: %q", feedback)
	}
	if executeCalls != 1 {
		t.Errorf("execute calls = %d, want 1 (linted candidate must not run)", executeCalls)
	}
	if criticCalls != 0 {
		t.Errorf("critic calls = %d, want 0", criticCalls)
	}
}
