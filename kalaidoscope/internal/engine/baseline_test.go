package engine

import (
	"testing"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/api"
)

func TestResolveDraftBaseline(t *testing.T) {
	edits := []api.SnapshotEdit{
		{ID: "rep", ContentBefore: "old B", ContentAfter: "new B"},
		{ID: "ins", ContentBefore: "", ContentAfter: "inserted"},
		{ID: "multi", ContentBefore: "X\n\nY", ContentAfter: "Z"},
	}

	t.Run("a draft without markers is returned as is", func(t *testing.T) {
		draft := "A\n\n\nB\n\nC"
		if got := ResolveDraftBaseline(draft, edits); got != draft {
			t.Errorf("got %q", got)
		}
	})

	t.Run("a pending replacement shows its original passage", func(t *testing.T) {
		draft := "A\n\n" + FormatEditMarker("rep") + "\n\nC"
		if got := ResolveDraftBaseline(draft, edits); got != "A\n\nold B\n\nC" {
			t.Errorf("got %q", got)
		}
	})

	t.Run("a pending insertion shows nothing", func(t *testing.T) {
		draft := "A\n\n" + FormatEditMarker("ins") + "\n\nC"
		if got := ResolveDraftBaseline(draft, edits); got != "A\n\nC" {
			t.Errorf("got %q", got)
		}
	})

	t.Run("a multi-block original expands back into its blocks", func(t *testing.T) {
		draft := FormatEditMarker("multi") + "\n\nC"
		if got := ResolveDraftBaseline(draft, edits); got != "X\n\nY\n\nC" {
			t.Errorf("got %q", got)
		}
	})

	t.Run("an in-block marker resolves in place", func(t *testing.T) {
		draft := "Lead " + FormatEditMarker("rep") + " tail\n\nC"
		if got := ResolveDraftBaseline(draft, edits); got != "Lead old B tail\n\nC" {
			t.Errorf("got %q", got)
		}
	})

	t.Run("a marker with no matching edit is left alone", func(t *testing.T) {
		draft := "A\n\n" + FormatEditMarker("ghost")
		if got := ResolveDraftBaseline(draft, edits); got != draft {
			t.Errorf("got %q", got)
		}
	})
}

func TestBlockRunIndex(t *testing.T) {
	draft := "A\n\nB\n\nC\n\nD"
	cases := []struct {
		text string
		want int
	}{
		{"A", 0},
		{"C", 2},
		{"B\n\nC", 1},
		{"C\n\nD", 2},
		{"B\n\nD", -1},
		{"", -1},
		{"A\n\nB\n\nC\n\nD\n\nE", -1},
	}
	for _, c := range cases {
		if got := BlockRunIndex(draft, c.text); got != c.want {
			t.Errorf("BlockRunIndex(%q) = %d, want %d", c.text, got, c.want)
		}
	}
	if got := BlockRunIndex("Lead passage tail\n\nC", "passage"); got != 0 {
		t.Errorf("sub-block match = %d, want 0", got)
	}
}
