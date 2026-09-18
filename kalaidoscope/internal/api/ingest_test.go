package api

import (
	"encoding/json"
	"testing"
)

func TestIngestMessageAcceptsBothSpellings(t *testing.T) {
	t.Parallel()
	for name, body := range map[string]string{
		"camel": `{"content":"c","ingestedVia":"app","occurredAt":"2026-01-02T03:04:05Z","fragmentLimit":3,"skipDuplicates":true}`,
		"snake": `{"content":"c","ingested_via":"app","occurred_at":"2026-01-02T03:04:05Z","fragment_limit":3,"skip_duplicates":true}`,
	} {
		var m IngestMessage
		if err := json.Unmarshal([]byte(body), &m); err != nil {
			t.Fatalf("%s: %v", name, err)
		}
		if m.Content != "c" || m.IngestedVia != "app" || m.OccurredAt != "2026-01-02T03:04:05Z" || m.Limit != 3 || !m.SkipDuplicates {
			t.Errorf("%s: decoded %+v", name, m)
		}
	}
}

func TestIngestMessageCamelWinsOverSnake(t *testing.T) {
	t.Parallel()
	var m IngestMessage
	if err := json.Unmarshal([]byte(`{"ingestedVia":"new","ingested_via":"old"}`), &m); err != nil {
		t.Fatal(err)
	}
	if m.IngestedVia != "new" {
		t.Errorf("IngestedVia = %q, want the lowerCamelCase value", m.IngestedVia)
	}
}

func TestIngestMessageMarshalsCamel(t *testing.T) {
	t.Parallel()
	out, err := json.Marshal(IngestMessage{IngestedVia: "app", SkipDuplicates: true})
	if err != nil {
		t.Fatal(err)
	}
	if string(out) != `{"ingestedVia":"app","skipDuplicates":true}` {
		t.Errorf("marshalled %s", out)
	}
}
