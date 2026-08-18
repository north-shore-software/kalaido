package llmcontext

import (
	"strings"
	"testing"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/api"
)

func TestExpandMentions(t *testing.T) {
	cases := []struct {
		name, in, want string
	}{
		{
			"fragment joins by id",
			"based on the entries in @[Fragment:abc123def456ghi|standup notes], do x",
			`based on the entries in @"standup notes" (Fragment ID: abc123def456ghi), do x`,
		},
		{
			"projection joins by name, id is provenance",
			"@[Projection:p1p1p1p1p1p1p1p|Weekly Digest]",
			`@"Weekly Digest" (Projection: p1p1p1p1p1p1p1p)`,
		},
		{
			"reflection",
			"@[Reflection:r1r1r1r1r1r1r1r|Mood]",
			`@"Mood" (Reflection: r1r1r1r1r1r1r1r)`,
		},
		{
			"colour is a group reference",
			"@[Colour:c1c1c1c1c1c1c1c|Work]",
			`@"Work" (Colour — its tagged fragments are in the context)`,
		},
		{
			"type uses the enum string",
			"summarise @[Type:email|Email]",
			`summarise @"email" (fragment type — those fragments are in the context)`,
		},
		{
			"empty label falls back to id",
			"@[Fragment:abc123def456ghi|]",
			`@"abc123def456ghi" (Fragment ID: abc123def456ghi)`,
		},
		{
			"multiple mentions in one message",
			"compare @[Colour:c1c1c1c1c1c1c1c|Work] with @[Colour:c2c2c2c2c2c2c2c|Home]",
			`compare @"Work" (Colour — its tagged fragments are in the context) with @"Home" (Colour — its tagged fragments are in the context)`,
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := ExpandMentions(tc.in); got != tc.want {
				t.Errorf("ExpandMentions(%q)\n got: %q\nwant: %q", tc.in, got, tc.want)
			}
		})
	}
}

func TestExpandMentionsPassesThroughNonMentions(t *testing.T) {
	for _, in := range []string{
		"",
		"no mentions here",
		"email me at louis@example.com",
		"a bare @ sign",
		"@[Unknown:abc|label]",
		"@[Fragment:abc",
		"@[Fragment:has space|label]",
		"@[Fragment:abc|label\nwith newline]",
		"@[Fragment:|no id]",
	} {
		if got := ExpandMentions(in); got != in {
			t.Errorf("ExpandMentions(%q) = %q, want unchanged", in, got)
		}
	}
}

func TestFlattenExpandsMentions(t *testing.T) {
	msgs := Flatten([]api.UIMessage{{
		Role: "user",
		Parts: []api.UIMessagePart{{
			Type: "text",
			Text: "what changed in @[Fragment:abc123def456ghi|standup notes]?",
		}},
	}})
	if len(msgs) != 1 {
		t.Fatalf("Flatten returned %d messages, want 1", len(msgs))
	}
	if strings.Contains(msgs[0].Content, "@[") {
		t.Errorf("Flatten left raw mention markup: %q", msgs[0].Content)
	}
	if !strings.Contains(msgs[0].Content, `@"standup notes" (Fragment ID: abc123def456ghi)`) {
		t.Errorf("Flatten did not expand mention: %q", msgs[0].Content)
	}
}
