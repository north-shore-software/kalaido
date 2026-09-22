package server_test

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"testing"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/api"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/config"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/testutil"
	"github.com/north-shore-software/kalaido/kalaidoscope/llm"
	"github.com/north-shore-software/kalaido/kalaidoscope/server"
	"github.com/pocketbase/pocketbase"
	"github.com/pocketbase/pocketbase/core"
)

func startTestServer(t *testing.T) (*pocketbase.PocketBase, *testutil.TestServer) {
	t.Helper()

	llm.SetActiveModelSet(llm.SetLocal)
	llm.SetProviderFactory(func(model string, cfg llm.WorkspaceConfig) llm.Provider {
		return testutil.MockProvider{}
	})

	a := server.New(pocketbase.Config{
		DefaultDataDir:  t.TempDir(),
		HideStartBanner: true,
	})

	if err := a.Bootstrap(); err != nil {
		t.Fatalf("bootstrap: %v", err)
	}
	t.Cleanup(func() { _ = a.ResetBootstrapState() })

	config.LoadAtBoot(a)
	server.EnsureReady()

	ts := testutil.NewTestServer(t, a)
	return a, ts
}

func TestIngestFragment_Integration(t *testing.T) {
	app, ts := startTestServer(t)

	reqBody := api.IngestMessage{
		Type:    "note",
		Content: "Test fragment content",
		Source:  "test.txt",
	}
	bodyBytes, err := json.Marshal(reqBody)
	if err != nil {
		t.Fatalf("marshal body: %v", err)
	}

	resp, err := ts.HTTPClient.Post(ts.BaseURL+"/api/ingest", "application/json", bytes.NewReader(bodyBytes))
	if err != nil {
		t.Fatalf("POST /api/ingest: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		respData, _ := io.ReadAll(resp.Body)
		t.Fatalf("status = %d, want %d; body = %s", resp.StatusCode, http.StatusOK, string(respData))
	}

	var ingestResp api.IngestResponse
	if err := json.NewDecoder(resp.Body).Decode(&ingestResp); err != nil {
		t.Fatalf("decode response: %v", err)
	}

	if ingestResp.Ingested != 1 {
		t.Errorf("ingested = %d, want 1", ingestResp.Ingested)
	}
	if ingestResp.FragmentID == "" {
		t.Fatal("fragmentId is empty")
	}

	record, err := app.FindRecordById("fragment", ingestResp.FragmentID)
	if err != nil {
		t.Fatalf("find fragment record %q: %v", ingestResp.FragmentID, err)
	}

	if got := record.GetString("content"); got != reqBody.Content {
		t.Errorf("content = %q, want %q", got, reqBody.Content)
	}
	if got := record.GetString("type"); got != reqBody.Type {
		t.Errorf("type = %q, want %q", got, reqBody.Type)
	}
	if got := record.GetString("source"); got != reqBody.Source {
		t.Errorf("source = %q, want %q", got, reqBody.Source)
	}

	// One server for every route check: each startTestServer registers
	// another set of package-level workers against a new app, and a worker
	// woken by one test's fragment can outlive that test's database.
	t.Run("legacy snake_case keys", func(t *testing.T) { checkIngestAcceptsLegacySnakeCase(t, app, ts) })
	t.Run("rejects file-only options", func(t *testing.T) { checkIngestRejectsFileOnlyOptions(t, ts) })
}

func postIngest(t *testing.T, ts *testutil.TestServer, body string) *http.Response {
	t.Helper()
	resp, err := ts.HTTPClient.Post(ts.BaseURL+"/api/ingest", "application/json", bytes.NewReader([]byte(body)))
	if err != nil {
		t.Fatalf("POST /api/ingest: %v", err)
	}
	t.Cleanup(func() { resp.Body.Close() })
	return resp
}

// The route shipped with snake_case keys; an older client still sending
// them must keep working.
func checkIngestAcceptsLegacySnakeCase(t *testing.T, app core.App, ts *testutil.TestServer) {
	resp := postIngest(t, ts, `{"content":"legacy body","ingested_via":"sync","occurred_at":"2026-01-02T03:04:05Z","skip_duplicates":true}`)
	if resp.StatusCode != http.StatusOK {
		b, _ := io.ReadAll(resp.Body)
		t.Fatalf("status = %d, body = %s", resp.StatusCode, b)
	}
	var out api.IngestResponse
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		t.Fatal(err)
	}
	rec, err := app.FindRecordById("fragment", out.FragmentID)
	if err != nil {
		t.Fatal(err)
	}
	if rec.GetString("ingested_via") != "sync" || !strings.HasPrefix(rec.GetString("occurred_at"), "2026-01-02 03:04:05") {
		t.Errorf("legacy keys not applied: ingested_via=%q occurred_at=%q", rec.GetString("ingested_via"), rec.GetString("occurred_at"))
	}
}

// File-ingest options have nothing to apply to on the inline route and are
// refused rather than silently dropped.
func checkIngestRejectsFileOnlyOptions(t *testing.T, ts *testutil.TestServer) {
	for _, body := range []string{
		`{"content":"x","format":"mbox"}`,
		`{"content":"x","fragmentLimit":5}`,
		`{"content":"x","fragment_limit":5}`,
		`{"content":"x","extensions":".txt"}`,
	} {
		if resp := postIngest(t, ts, body); resp.StatusCode != http.StatusBadRequest {
			t.Errorf("%s: status = %d, want 400", body, resp.StatusCode)
		}
	}
}
