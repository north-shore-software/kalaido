// UNREVIEWED
package refinement_test

import (
	"encoding/json"
	"testing"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/refinement"
	"github.com/north-shore-software/kalaido/kalaidoscope/llm"
)

func TestRefinementToolSchemasAreValidJSON(t *testing.T) {
	if !json.Valid(refinement.UpdateLensTool.Parameters) {
		t.Fatalf("UpdateLensTool.Parameters is not valid JSON: %s", refinement.UpdateLensTool.Parameters)
	}
	if !json.Valid(refinement.SuggestNameTool.Parameters) {
		t.Fatalf("SuggestNameTool.Parameters is not valid JSON: %s", refinement.SuggestNameTool.Parameters)
	}
}

func TestLatestLensArg(t *testing.T) {
	calls := []llm.ToolCall{
		{Name: "suggest_name", Args: []byte(`{"name":"test"}`)},
		{Name: "update_lens", Args: []byte(`{"lens":"A concise summary."}`)},
	}
	lens := refinement.LatestLensArg(calls)
	if lens != "A concise summary." {
		t.Errorf("expected 'A concise summary.', got %q", lens)
	}

	none := refinement.LatestLensArg([]llm.ToolCall{
		{Name: "suggest_name", Args: []byte(`{"name":"test"}`)},
	})
	if none != "" {
		t.Errorf("expected empty lens, got %q", none)
	}
}

func TestJSONStringChunk(t *testing.T) {
	escaped := refinement.JSONStringChunk("hello \"world\"\nline 2")
	expected := `hello \"world\"\nline 2`
	if escaped != expected {
		t.Errorf("expected %q, got %q", expected, escaped)
	}
}
