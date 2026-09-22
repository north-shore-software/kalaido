// UNREVIEWED
package handlers

import (
	"encoding/json"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/pocketbase/pocketbase/core"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/api"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/testutil"
)

func resolveTokens(t *testing.T, app core.App, body string) api.TokenResolutionResponse {
	t.Helper()
	rec := httptest.NewRecorder()
	e := &core.RequestEvent{App: app}
	e.Request = httptest.NewRequest("POST", "/api/context/tokens", strings.NewReader(body))
	e.Request.Header.Set("Content-Type", "application/json")
	e.Response = rec
	if err := HandleResolveTokens(app)(e); err != nil {
		t.Fatal(err)
	}
	var res api.TokenResolutionResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &res); err != nil {
		t.Fatal(err)
	}
	return res
}

// The pre-flight reports the chat model's budget and whether the estimate
// fits it: an oversized whole scope does not, a single pin does; under
// summaries the whole scope shrinks to rows while a pin still counts in full.
func TestResolveTokensReportsFit(t *testing.T) {
	app := testutil.NewApp(t)
	big := testutil.NewRecord(t, app, "fragment", map[string]any{"type": "note", "content": strings.Repeat("word ", 200)})
	testutil.NewRecord(t, app, "fragment", map[string]any{"type": "note", "content": strings.Repeat("more ", 200)})
	script := &chatScript{window: 400}
	script.install(t)

	whole := resolveTokens(t, app, `{"wholeScope":"full"}`)
	if whole.Limit != 350 || whole.Model == "" {
		t.Errorf("limit/model = %d/%q, want 350 and a model", whole.Limit, whole.Model)
	}
	if whole.Fits || whole.TotalTokens <= whole.Limit {
		t.Errorf("whole scope should not fit: %+v", whole)
	}

	pin := resolveTokens(t, app, `{"fragmentIds":["`+big.Id+`"]}`)
	if !pin.Fits || pin.TotalTokens <= 0 || pin.TotalTokens >= whole.TotalTokens {
		t.Errorf("single pin = %+v, want a smaller fitting estimate", pin)
	}

	summaries := resolveTokens(t, app, `{"wholeScope":"summaries","fragmentIds":["`+big.Id+`"]}`)
	if summaries.Breakdown["WholeScope"] >= whole.Breakdown["WholeScope"] {
		t.Errorf("summaries whole scope not smaller: %+v vs %+v", summaries, whole)
	}
	if summaries.Breakdown["Fragment:"+big.Id] != pin.TotalTokens {
		t.Errorf("pin under summaries counted as %d, want the full %d", summaries.Breakdown["Fragment:"+big.Id], pin.TotalTokens)
	}

	// Full mode with a fragment pin: the pin is inside the whole scope, not extra.
	fullPin := resolveTokens(t, app, `{"wholeScope":"full","fragmentIds":["`+big.Id+`"]}`)
	if fullPin.TotalTokens != whole.TotalTokens {
		t.Errorf("full + pin = %d, want %d", fullPin.TotalTokens, whole.TotalTokens)
	}
}

// The conversation form sizes the whole next turn — system prompt, context
// deltas and the transcript so far — against the model the conversation
// would use; an unknown conversation is an empty history plus the pending
// context, not an error.
func TestResolveTokensForConversation(t *testing.T) {
	app := testutil.NewApp(t)
	testutil.NewRecord(t, app, "fragment", map[string]any{"type": "note", "content": strings.Repeat("word ", 50)})
	script := &chatScript{window: 4000}
	script.install(t)

	fresh := resolveTokens(t, app, `{"conversationId":"conv-none","wholeScope":"full"}`)
	if fresh.Breakdown["Transcript"] != 0 || fresh.Breakdown["System"] <= 0 || fresh.Breakdown["Context"] <= 0 {
		t.Errorf("fresh conversation = %+v, want system + context and no transcript", fresh)
	}
	if fresh.Limit != 3500 || fresh.Model == "" {
		t.Errorf("limit/model = %d/%q, want 3500 and a model", fresh.Limit, fresh.Model)
	}

	if _, err := runChatTurn(t, app, "conv-est", &api.ContextSpec{WholeScope: api.WholeScopeFull}, "hello there"); err != nil {
		t.Fatal(err)
	}
	after := resolveTokens(t, app, `{"conversationId":"conv-est","wholeScope":"full"}`)
	if after.Breakdown["Transcript"] <= 0 || after.Breakdown["Context"] <= 0 {
		t.Errorf("after a turn = %+v, want transcript and context", after)
	}
	// The pending spec equals the one in effect: no extra context is counted.
	if after.Breakdown["Context"] != fresh.Breakdown["Context"] {
		t.Errorf("context re-counted: %d vs %d", after.Breakdown["Context"], fresh.Breakdown["Context"])
	}
	if after.TotalTokens != after.Breakdown["System"]+after.Breakdown["Context"]+after.Breakdown["Transcript"] {
		t.Errorf("total %d is not the sum of %+v", after.TotalTokens, after.Breakdown)
	}
	if !after.Fits {
		t.Errorf("should fit a 4000 window: %+v", after)
	}

	// Off mode (no whole scope, no pins) drops the context bodies.
	off := resolveTokens(t, app, `{"conversationId":"conv-est"}`)
	if off.Breakdown["Context"] >= after.Breakdown["Context"] {
		t.Errorf("off mode context %d not below full %d", off.Breakdown["Context"], after.Breakdown["Context"])
	}

	// The conversation's own model override is what gets reported.
	conv, err := app.FindFirstRecordByFilter("chat_conversation", "external_conversation_id = 'conv-est'")
	if err != nil {
		t.Fatal(err)
	}
	conv.Set("generate_with_model", "custom/model")
	if err := app.Save(conv); err != nil {
		t.Fatal(err)
	}
	custom := resolveTokens(t, app, `{"conversationId":"conv-est","wholeScope":"full"}`)
	if custom.Model != "custom/model" {
		t.Errorf("model = %q, want the conversation override", custom.Model)
	}
}
