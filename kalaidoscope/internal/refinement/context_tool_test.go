package refinement_test

import (
	"encoding/json"
	"reflect"
	"testing"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/api"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/prompts"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/refinement"
	"github.com/north-shore-software/kalaido/kalaidoscope/llm"
)

func TestUpdateContextToolSchemaIsValidJSON(t *testing.T) {
	if !json.Valid(refinement.UpdateContextTool.Parameters) {
		t.Fatalf("UpdateContextTool.Parameters is not valid JSON: %s", refinement.UpdateContextTool.Parameters)
	}
	if refinement.UpdateContextTool.Name != prompts.UpdateContextToolName {
		t.Fatalf("tool name %q", refinement.UpdateContextTool.Name)
	}
}

func TestApplyContextOps(t *testing.T) {
	current := api.ContextSpec{
		WholeScope:          api.WholeScopeFull,
		FragmentIDs:         []string{"f1", "f2"},
		FragmentTypes:       []string{"email"},
		ColourIDs:           []string{"c1"},
		SourceProjectionIDs: []string{"p1"},
	}

	t.Run("pins and unpins are set operations", func(t *testing.T) {
		got := refinement.ApplyContextOps(current, prompts.UpdateContextArgs{
			PinFragmentIDs:     []string{"f2", "f3", "f3"},
			UnpinFragmentIDs:   []string{"f1", "missing"},
			PinFragmentTypes:   []string{"note"},
			UnpinFragmentTypes: []string{"email"},
		})
		if !reflect.DeepEqual(got.FragmentIDs, []string{"f2", "f3"}) {
			t.Errorf("FragmentIDs = %v", got.FragmentIDs)
		}
		if !reflect.DeepEqual(got.FragmentTypes, []string{"note"}) {
			t.Errorf("FragmentTypes = %v", got.FragmentTypes)
		}
		if got.WholeScope != api.WholeScopeFull {
			t.Errorf("WholeScope changed to %q", got.WholeScope)
		}
		if !reflect.DeepEqual(got.ColourIDs, []string{"c1"}) || !reflect.DeepEqual(got.SourceProjectionIDs, []string{"p1"}) {
			t.Errorf("out-of-reach pins changed: %+v", got)
		}
	})

	t.Run("an item pinned and unpinned at once ends up unpinned", func(t *testing.T) {
		got := refinement.ApplyContextOps(current, prompts.UpdateContextArgs{
			PinFragmentIDs:   []string{"f9"},
			UnpinFragmentIDs: []string{"f9"},
		})
		if !reflect.DeepEqual(got.FragmentIDs, []string{"f1", "f2"}) {
			t.Errorf("FragmentIDs = %v", got.FragmentIDs)
		}
	})

	t.Run("whole scope switches", func(t *testing.T) {
		if got := refinement.ApplyContextOps(current, prompts.UpdateContextArgs{WholeScope: "pins"}); got.WholeScope != "" {
			t.Errorf("pins: WholeScope = %q", got.WholeScope)
		}
		narrow := api.ContextSpec{FragmentIDs: []string{"f1"}}
		if got := refinement.ApplyContextOps(narrow, prompts.UpdateContextArgs{WholeScope: "full"}); got.WholeScope != api.WholeScopeFull {
			t.Errorf("full: WholeScope = %q", got.WholeScope)
		}
		if got := refinement.ApplyContextOps(narrow, prompts.UpdateContextArgs{WholeScope: "bogus"}); got.WholeScope != "" {
			t.Errorf("unknown mode should be ignored, got %q", got.WholeScope)
		}
	})

	t.Run("does not alias the input slices", func(t *testing.T) {
		before := append([]string{}, current.FragmentIDs...)
		_ = refinement.ApplyContextOps(current, prompts.UpdateContextArgs{PinFragmentIDs: []string{"f3"}})
		if !reflect.DeepEqual(current.FragmentIDs, before) {
			t.Errorf("input mutated: %v", current.FragmentIDs)
		}
	})
}

func TestLatestUpdateContextArg(t *testing.T) {
	calls := []llm.ToolCall{
		{Name: prompts.UpdateLensToolName, Args: json.RawMessage(`{"directive":"x"}`)},
		{Name: prompts.UpdateContextToolName, Args: json.RawMessage(`{"reason":"first","pin_fragment_ids":["a"]}`)},
		{Name: prompts.UpdateContextToolName, Args: json.RawMessage(`{"reason":"second","whole_scope":"pins"}`)},
	}
	got := refinement.LatestUpdateContextArg(calls)
	if got == nil || got.Reason != "second" || got.WholeScope != "pins" {
		t.Fatalf("got %+v", got)
	}
	if refinement.LatestUpdateContextArg(calls[:1]) != nil {
		t.Fatal("expected nil without an update_context call")
	}
}

func TestContextConfirmAndCancelSends(t *testing.T) {
	confirm := []api.UIMessage{{Role: "system", Parts: []api.UIMessagePart{
		{Type: "context_spec", Data: json.RawMessage(`{"wholeScope":"full"}`)},
		{Type: prompts.ContextConfirmPartType},
	}}}
	if !refinement.IsContextConfirmed(confirm) || refinement.IsContextCancelled(confirm) {
		t.Fatal("confirm send misread")
	}
	cancel := []api.UIMessage{{Role: "system", Parts: []api.UIMessagePart{{Type: prompts.ContextCancelPartType}}}}
	if refinement.IsContextConfirmed(cancel) || !refinement.IsContextCancelled(cancel) {
		t.Fatal("cancel send misread")
	}
	// A user message on the same send makes it an ordinary turn.
	withUser := append(append([]api.UIMessage{}, confirm...), api.UIMessage{Role: "user", Parts: []api.UIMessagePart{{Type: "text", Text: "hi"}}})
	if refinement.IsContextConfirmed(withUser) {
		t.Fatal("a send with user text is not a confirm")
	}
}
