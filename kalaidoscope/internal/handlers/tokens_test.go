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

	whole := resolveTokens(t, app, `{"wholeScope":true}`)
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

	summaries := resolveTokens(t, app, `{"wholeScope":true,"summaries":true,"fragmentIds":["`+big.Id+`"]}`)
	if summaries.Breakdown["WholeScope"] >= whole.Breakdown["WholeScope"] {
		t.Errorf("summaries whole scope not smaller: %+v vs %+v", summaries, whole)
	}
	if summaries.Breakdown["Fragment:"+big.Id] != pin.TotalTokens {
		t.Errorf("pin under summaries counted as %d, want the full %d", summaries.Breakdown["Fragment:"+big.Id], pin.TotalTokens)
	}

	// Full mode with a fragment pin: the pin is inside the whole scope, not extra.
	fullPin := resolveTokens(t, app, `{"wholeScope":true,"fragmentIds":["`+big.Id+`"]}`)
	if fullPin.TotalTokens != whole.TotalTokens {
		t.Errorf("full + pin = %d, want %d", fullPin.TotalTokens, whole.TotalTokens)
	}
}
