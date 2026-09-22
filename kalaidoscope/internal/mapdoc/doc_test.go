package mapdoc

import (
	"strings"
	"testing"
)

func TestMintID(t *testing.T) {
	id1 := MintID()
	id2 := MintID()
	if !strings.HasPrefix(id1, "t_") || len(id1) != 10 {
		t.Fatalf("unexpected format for id1: %q", id1)
	}
	if id1 == id2 {
		t.Fatalf("minted identical IDs: %q", id1)
	}
}

func TestNormalizeName(t *testing.T) {
	cases := []struct {
		input string
		want  string
	}{
		{"  Hello World  ", "hello world"},
		{"Acme, Inc.", "acme, inc"},
		{"  Bob... ", "bob"},
		{"Foo   Bar   Baz", "foo bar baz"},
	}
	for _, tc := range cases {
		if got := NormalizeName(tc.input); got != tc.want {
			t.Errorf("NormalizeName(%q) = %q, want %q", tc.input, got, tc.want)
		}
	}
}

func TestDocumentResolve(t *testing.T) {
	doc := &Document{
		Things: []Thing{
			{
				ID:      "t_abc12345",
				Name:    "Alice Smith",
				Aliases: []string{"Alice", "Ali"},
				Kind:    "person",
			},
		},
	}

	// Exact ID match
	if th := doc.Resolve("t_abc12345"); th == nil || th.Name != "Alice Smith" {
		t.Errorf("Resolve by ID failed, got %v", th)
	}
	// Name match
	if th := doc.Resolve("Alice Smith"); th == nil || th.ID != "t_abc12345" {
		t.Errorf("Resolve by name failed, got %v", th)
	}
	// Alias match
	if th := doc.Resolve("Ali"); th == nil || th.ID != "t_abc12345" {
		t.Errorf("Resolve by alias failed, got %v", th)
	}
	// Normalized match
	if th := doc.Resolve("  alice   "); th == nil || th.ID != "t_abc12345" {
		t.Errorf("Resolve by normalized alias failed, got %v", th)
	}
	// Miss
	if th := doc.Resolve("Unknown"); th != nil {
		t.Errorf("expected nil for unknown, got %v", th)
	}
}
