package handlers

import (
	"encoding/json"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/pocketbase/pocketbase/core"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/api"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/engine"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/testutil"
)

func callJSON(t *testing.T, app core.App, h func(*core.RequestEvent) error, method, path, body string, params map[string]string) (*httptest.ResponseRecorder, error) {
	t.Helper()
	rec := httptest.NewRecorder()
	e := &core.RequestEvent{App: app}
	var r *strings.Reader
	if body != "" {
		r = strings.NewReader(body)
		e.Request = httptest.NewRequest(method, path, r)
		e.Request.Header.Set("Content-Type", "application/json")
	} else {
		e.Request = httptest.NewRequest(method, path, nil)
	}
	for k, v := range params {
		e.Request.SetPathValue(k, v)
	}
	e.Response = rec
	return rec, h(e)
}

// "Summarize from <date>": the schedule is persisted at creation and the
// first version is effective from the start date, so every grid window since
// is already in the series — pending, awaiting the lens.
func TestCreateReflectionWithStartInPastEnumeratesHistory(t *testing.T) {
	app := testutil.NewApp(t)
	day := 24 * time.Hour
	start := time.Now().Add(-22 * day).UTC().Truncate(time.Second)
	body := `{"name":"weekly","windowSpec":{"startTime":"` + start.Format(time.RFC3339) + `","period":"168h","duration":"168h"}}`

	rec, err := callJSON(t, app, HandleCreateReflection(app), "POST", "/api/reflections", body, nil)
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	var created api.CreateReflectionResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &created); err != nil {
		t.Fatal(err)
	}
	refl, err := app.FindRecordById("reflection", created.ReflectionID)
	if err != nil {
		t.Fatal(err)
	}
	versions := engine.LoadWindowSpecVersions(refl)
	if len(versions) != 1 || versions[0].EffectiveFrom != start.Format(time.RFC3339) || versions[0].Spec.Period != "168h" {
		t.Fatalf("versions = %+v, want one version effective from the start date", versions)
	}

	rec, err = callJSON(t, app, HandleListReflectionWindows(app), "GET", "/api/reflections/x/windows", "", map[string]string{"id": refl.Id})
	if err != nil {
		t.Fatalf("windows: %v", err)
	}
	var res api.ReflectionWindowsResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &res); err != nil {
		t.Fatal(err)
	}
	if len(res.Windows) != 3 {
		t.Fatalf("windows = %d, want 3 completed weeks: %+v", len(res.Windows), res.Windows)
	}
	if res.Windows[0].Start != start.Format(time.RFC3339) {
		t.Errorf("first window starts %s, want %s", res.Windows[0].Start, start.Format(time.RFC3339))
	}
	if res.CurrentWindowID != res.Windows[2].ID {
		t.Errorf("currentWindowId = %q, want the newest window %q", res.CurrentWindowID, res.Windows[2].ID)
	}
	for _, w := range res.Windows {
		if w.HasApproved || w.Generating || w.Backfilled {
			t.Errorf("fresh window carries state: %+v", w)
		}
	}
}

// A schedule edit appends a version effective now and keeps the grid origin.
func TestUpdateReflectionScheduleKeepsOrigin(t *testing.T) {
	app := testutil.NewApp(t)
	start := time.Now().Add(-48 * time.Hour).UTC().Truncate(time.Second).Format(time.RFC3339)
	rec, err := callJSON(t, app, HandleCreateReflection(app), "POST", "/api/reflections",
		`{"name":"r","windowSpec":{"startTime":"`+start+`","period":"168h","duration":"168h"}}`, nil)
	if err != nil {
		t.Fatal(err)
	}
	var created api.CreateReflectionResponse
	_ = json.Unmarshal(rec.Body.Bytes(), &created)

	if _, err := callJSON(t, app, HandleUpdateReflection(app), "PATCH", "/api/reflections/x",
		`{"windowSpec":{"period":"24h","duration":"24h"}}`, map[string]string{"id": created.ReflectionID}); err != nil {
		t.Fatalf("update: %v", err)
	}
	refl, _ := app.FindRecordById("reflection", created.ReflectionID)
	versions := engine.LoadWindowSpecVersions(refl)
	if len(versions) != 2 {
		t.Fatalf("versions = %d, want 2", len(versions))
	}
	if versions[1].Spec.StartTime != start || versions[1].Spec.Period != "24h" {
		t.Errorf("new version = %+v, want the new cadence with the original start time", versions[1].Spec)
	}
	if versions[1].EffectiveFrom == start {
		t.Errorf("new version is effective from the start time; it must be effective from the edit")
	}

	if _, err := callJSON(t, app, HandleUpdateReflection(app), "PATCH", "/api/reflections/x",
		`{"windowSpec":{"period":"soon","duration":"24h"}}`, map[string]string{"id": created.ReflectionID}); err == nil {
		t.Error("an unparseable period was accepted")
	}
}

// Backfill materializes windows before the grid and lists them as such; a
// start inside the covered range is refused.
func TestBackfillEndpointMaterializes(t *testing.T) {
	app := testutil.NewApp(t)
	day := 24 * time.Hour
	rec, err := callJSON(t, app, HandleCreateReflection(app), "POST", "/api/reflections",
		`{"name":"r","windowSpec":{"period":"168h","duration":"168h"}}`, nil)
	if err != nil {
		t.Fatal(err)
	}
	var created api.CreateReflectionResponse
	_ = json.Unmarshal(rec.Body.Bytes(), &created)

	from := time.Now().Add(-20 * day).UTC().Format(time.RFC3339)
	rec, err = callJSON(t, app, HandleBackfillReflection(app), "POST", "/api/reflections/x/backfill",
		`{"from":"`+from+`"}`, map[string]string{"id": created.ReflectionID})
	if err != nil {
		t.Fatalf("backfill: %v", err)
	}
	var res api.BackfillResponse
	_ = json.Unmarshal(rec.Body.Bytes(), &res)
	if len(res.Windows) != 3 {
		t.Fatalf("backfilled %d windows, want 3 weeks: %+v", len(res.Windows), res.Windows)
	}

	rec, _ = callJSON(t, app, HandleListReflectionWindows(app), "GET", "/api/reflections/x/windows", "", map[string]string{"id": created.ReflectionID})
	var series api.ReflectionWindowsResponse
	_ = json.Unmarshal(rec.Body.Bytes(), &series)
	if len(series.Windows) != 3 {
		t.Fatalf("series = %d, want the 3 backfilled windows (no grid window has completed yet)", len(series.Windows))
	}
	for _, w := range series.Windows {
		if !w.Backfilled {
			t.Errorf("window %s not marked backfilled", w.Key)
		}
	}

	if _, err := callJSON(t, app, HandleBackfillReflection(app), "POST", "/api/reflections/x/backfill",
		`{"from":"`+time.Now().Add(time.Hour).UTC().Format(time.RFC3339)+`"}`, map[string]string{"id": created.ReflectionID}); err == nil {
		t.Error("a backfill starting in the covered range was accepted")
	}
}
