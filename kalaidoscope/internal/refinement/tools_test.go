package refinement_test

import (
	"encoding/json"
	"testing"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/refinement"
)

func TestRefinementToolSchemasAreValidJSON(t *testing.T) {
	if !json.Valid(refinement.UpdateLensTool.Parameters) {
		t.Fatalf("UpdateLensTool.Parameters is not valid JSON: %s", refinement.UpdateLensTool.Parameters)
	}
	if !json.Valid(refinement.SuggestNameTool.Parameters) {
		t.Fatalf("SuggestNameTool.Parameters is not valid JSON: %s", refinement.SuggestNameTool.Parameters)
	}
}

func TestJSONStringChunk(t *testing.T) {
	escaped := refinement.JSONStringChunk("hello \"world\"\nline 2")
	expected := `hello \"world\"\nline 2`
	if escaped != expected {
		t.Errorf("expected %q, got %q", expected, escaped)
	}
}
