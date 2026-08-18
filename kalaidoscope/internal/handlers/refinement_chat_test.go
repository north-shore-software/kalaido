package handlers

import (
	"encoding/json"
	"testing"
)

// The parameter schema is assembled by concatenation so the description can
// live in the prompts package; a wording change there must not break the JSON.
func TestUpdateDraftToolParametersAreValidJSON(t *testing.T) {
	if !json.Valid(updateDraftTool.Parameters) {
		t.Fatalf("updateDraftTool.Parameters is not valid JSON: %s", updateDraftTool.Parameters)
	}
}
