package gemini

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"log"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"github.com/north-shore-software/kalaido/kalaidoscope/llm"
)

// A rejected call must leave enough in the log to diagnose it without a
// reproduction: the status, the call's shape, the wire-level facts Gemini
// validates, and the response body — and the error the caller gets carries
// the same body.
func TestRejectedCallIsLoggedWithShapeAndBody(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusBadRequest)
		_, _ = w.Write([]byte(`{"error":{"code":400,"message":"Request contains an invalid argument.","status":"INVALID_ARGUMENT"}}`))
	}))
	defer srv.Close()
	prev := geminiBase
	geminiBase = srv.URL
	t.Cleanup(func() { geminiBase = prev })

	var buf bytes.Buffer
	log.SetOutput(&buf)
	t.Cleanup(func() { log.SetOutput(os.Stderr) })

	p := &Provider{Model: "gemini-test", APIKey: "k"}
	temp := 0.2
	_, err := p.Stream(context.Background(),
		[]llm.Message{
			{Role: "system", Content: "SYSTEM PROMPT"},
			{Role: "system", Content: "CONTEXT"},
			{Role: "user", Content: ""},
		},
		[]llm.Tool{{Name: "update_lens", Parameters: []byte(`{"type":"object"}`)}},
		llm.GenOptions{Temperature: &temp})

	var perr *llm.ProviderError
	if !errors.As(err, &perr) || perr.StatusCode != 400 || perr.Kind != llm.ErrKindOther {
		t.Fatalf("err = %v, want a 400 ProviderError of kind other", err)
	}
	if !strings.Contains(perr.Body, "INVALID_ARGUMENT") {
		t.Errorf("error body lost the provider's message: %q", perr.Body)
	}

	out := buf.String()
	for _, want := range []string{
		"gemini: request failed (HTTP 400) model=gemini-test",
		"messages=3 (system:2/20ch, user:1/0ch) empty=1",
		"tools=[update_lens]",
		"temp=0.2",
		"tier=priority",
		"system_instruction=13ch",
		"contents=1 parts=2",
		"response body: {\"error\"",
	} {
		if !strings.Contains(out, want) {
			t.Errorf("log lacks %q:\n%s", want, out)
		}
	}
}

// The leading system message is the instruction; later system messages are
// the hydrator's context deltas and must travel as user parts in order, so a
// document set the size of a workspace never lands in systemInstruction and a
// mid-conversation notice stays where it happened.
func TestContextDeltasRideAsUserPartsNotSystemInstruction(t *testing.T) {
	var got geminiRequest
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		raw, _ := io.ReadAll(r.Body)
		if err := json.Unmarshal(raw, &got); err != nil {
			t.Errorf("request is not a geminiRequest: %v", err)
		}
		w.Header().Set("Content-Type", "text/event-stream")
		_, _ = w.Write([]byte("data: {\"candidates\":[{\"content\":{\"parts\":[{\"text\":\"ok\"}]}}]}\n\n"))
	}))
	defer srv.Close()
	prev := geminiBase
	geminiBase = srv.URL
	t.Cleanup(func() { geminiBase = prev })

	p := &Provider{Model: "gemini-test", APIKey: "k"}
	comp, err := p.Stream(context.Background(), []llm.Message{
		{Role: "system", Content: "PROMPT"},
		{Role: "system", Content: "DOCS ADDED"},
		{Role: "user", Content: "hi"},
		{Role: "assistant", Content: "hello"},
		{Role: "system", Content: "DOCS REMOVED"},
		{Role: "user", Content: "again"},
	}, nil, llm.GenOptions{})
	if err != nil {
		t.Fatal(err)
	}
	for range comp.Events {
	}
	comp.Wait()

	if got.SystemInstruction == nil || len(got.SystemInstruction.Parts) != 1 || got.SystemInstruction.Parts[0].Text != "PROMPT" {
		t.Fatalf("systemInstruction = %+v, want only the leading system message", got.SystemInstruction)
	}
	var seen []string
	for _, c := range got.Contents {
		var texts []string
		for _, part := range c.Parts {
			texts = append(texts, part.Text)
		}
		seen = append(seen, c.Role+":"+strings.Join(texts, "|"))
	}
	want := []string{"user:DOCS ADDED|hi", "model:hello", "user:DOCS REMOVED|again"}
	if strings.Join(seen, " ") != strings.Join(want, " ") {
		t.Errorf("contents = %v, want %v", seen, want)
	}
}

// A stream that ends without a single content part is otherwise silent: the
// caller sees an empty completion and the log shows only the traffic tier.
// The finish reason is the one fact that explains it (a model reaching for a
// tool that was not advertised finishes with MALFORMED_FUNCTION_CALL), so it
// must be logged with what was emitted, what was spent, and the call's shape.
func TestAbnormalFinishIsLoggedWithReasonAndShape(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		_, _ = w.Write([]byte("data: {\"candidates\":[{\"content\":{\"parts\":[],\"role\":\"model\"},\"finishReason\":\"MALFORMED_FUNCTION_CALL\",\"index\":0}]," +
			"\"usageMetadata\":{\"promptTokenCount\":100,\"candidatesTokenCount\":249,\"totalTokenCount\":349}}\n\n"))
	}))
	defer srv.Close()
	prev := geminiBase
	geminiBase = srv.URL
	t.Cleanup(func() { geminiBase = prev })

	var buf bytes.Buffer
	log.SetOutput(&buf)
	t.Cleanup(func() { log.SetOutput(os.Stderr) })

	p := &Provider{Model: "gemini-test", APIKey: "k"}
	comp, err := p.Stream(context.Background(), []llm.Message{
		{Role: "system", Content: "PROMPT"},
		{Role: "user", Content: "hi"},
	}, nil, llm.GenOptions{})
	if err != nil {
		t.Fatal(err)
	}
	var events int
	for range comp.Events {
		events++
	}
	usage := comp.Wait()
	if events != 0 {
		t.Errorf("got %d events from a part-less stream, want 0", events)
	}
	if usage == nil || usage.CompletionTokens != 249 {
		t.Errorf("usage = %+v, want completion_tokens=249", usage)
	}

	out := buf.String()
	for _, want := range []string{
		"gemini: completion ended finish_reason=MALFORMED_FUNCTION_CALL",
		"block_reason=none",
		"text_parts=0 tool_calls=0 completion_tokens=249",
		"model=gemini-test",
		"tools=[]",
		"contents=1 parts=1",
	} {
		if !strings.Contains(out, want) {
			t.Errorf("log lacks %q:\n%s", want, out)
		}
	}
}

// A normal turn must not add a line: STOP with text delivered is the common
// case and the log should stay as quiet as before.
func TestNormalFinishIsNotLogged(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		_, _ = w.Write([]byte("data: {\"candidates\":[{\"content\":{\"parts\":[{\"text\":\"ok\"}]},\"finishReason\":\"STOP\"}]," +
			"\"usageMetadata\":{\"promptTokenCount\":1,\"candidatesTokenCount\":1,\"totalTokenCount\":2}}\n\n"))
	}))
	defer srv.Close()
	prev := geminiBase
	geminiBase = srv.URL
	t.Cleanup(func() { geminiBase = prev })

	var buf bytes.Buffer
	log.SetOutput(&buf)
	t.Cleanup(func() { log.SetOutput(os.Stderr) })

	p := &Provider{Model: "gemini-test", APIKey: "k"}
	comp, err := p.Stream(context.Background(), []llm.Message{{Role: "user", Content: "hi"}}, nil, llm.GenOptions{})
	if err != nil {
		t.Fatal(err)
	}
	for range comp.Events {
	}
	comp.Wait()
	if strings.Contains(buf.String(), "completion ended") {
		t.Errorf("normal STOP finish was logged:\n%s", buf.String())
	}
}
