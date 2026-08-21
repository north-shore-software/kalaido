package main

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"testing"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/api"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/config"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/pbtest"
	"github.com/north-shore-software/kalaido/kalaidoscope/llm"
	"github.com/north-shore-software/kalaido/kalaidoscope/server"
	"github.com/pocketbase/pocketbase"
)

type mockProvider struct{}

func (mockProvider) Stream(ctx context.Context, msgs []llm.Message, tools []llm.Tool, opts llm.GenOptions) (*llm.Completion, error) {
	ch := make(chan llm.StreamEvent, 1)
	ch <- llm.StreamEvent{Kind: llm.EventText, Text: "mock response"}
	close(ch)
	return &llm.Completion{
		Events: ch,
		Wait: func() *llm.Usage {
			return &llm.Usage{Provider: "mock", Model: "mock"}
		},
	}, nil
}

func startTestServer(t *testing.T) (*pocketbase.PocketBase, *pbtest.TestServer) {
	t.Helper()

	llm.SetActiveModelSet(llm.SetLocal)
	llm.SetProviderFactory(func(model string, cfg llm.WorkspaceConfig) llm.Provider {
		return mockProvider{}
	})

	a := server.NewWithConfig(pocketbase.Config{
		DefaultDataDir:  t.TempDir(),
		HideStartBanner: true,
	})

	if err := a.Bootstrap(); err != nil {
		t.Fatalf("bootstrap: %v", err)
	}
	t.Cleanup(func() { _ = a.ResetBootstrapState() })

	if err := a.RunAppMigrations(); err != nil {
		t.Fatalf("migrate: %v", err)
	}

	resolveModelSet(a)
	config.LoadAtBoot(a)
	seedSidecarUser(a)
	reportPort(a)
	server.EnsureReady()

	ts := pbtest.NewTestServer(t, a)
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
}
