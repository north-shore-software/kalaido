package discover

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/prompts"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/testutil"
	"github.com/north-shore-software/kalaido/kalaidoscope/llm"
)

// The read budget is per Reader: the chat builds one per turn, so its budget
// is per turn; discover's lives for the run. Past it, reads return the
// exhausted message rather than text.
func TestReaderBudget(t *testing.T) {
	app := testutil.NewApp(t)
	f1 := testutil.NewRecord(t, app, "fragment", map[string]any{"type": "note", "content": "FIRST BODY"})
	f2 := testutil.NewRecord(t, app, "fragment", map[string]any{"type": "note", "content": "SECOND BODY"})

	r, err := NewChatReader(app)
	if err != nil {
		t.Fatal(err)
	}
	r.budget = 1

	args, _ := json.Marshal(map[string][]string{"ids": {f1.Id, f2.Id}})
	out, ok := r.Dispatch(context.Background(), llm.ToolCall{Name: prompts.ReadFragmentToolName, Args: args})
	if !ok {
		t.Fatal("read_fragment was not dispatched")
	}
	if !strings.Contains(out, "FIRST BODY") || strings.Contains(out, "SECOND BODY") {
		t.Errorf("budget 1 should read only the first id: %q", out)
	}
	if !strings.Contains(out, prompts.ChatReadBudgetExhausted(1)) {
		t.Errorf("exhausted message missing: %q", out)
	}
	if r.Reads() != 1 {
		t.Errorf("reads = %d, want 1", r.Reads())
	}
	if _, ok := r.Dispatch(context.Background(), llm.ToolCall{Name: "propose_projection"}); ok {
		t.Error("Dispatch claimed a non-read tool")
	}
	for _, tool := range ChatReadTools() {
		if !json.Valid(tool.Parameters) {
			t.Errorf("%s parameters are not valid JSON: %s", tool.Name, tool.Parameters)
		}
	}
}
