// UNREVIEWED
package llm

import (
	"errors"
	"testing"
)

func TestEstimateTokens(t *testing.T) {
	cases := []struct {
		chars int
		want  int
	}{
		{0, 0},
		{4, 1},
		{10, 2},
		{100, 25},
	}
	for _, tc := range cases {
		if got := EstimateTokens(tc.chars); got != tc.want {
			t.Errorf("EstimateTokens(%d) = %d, want %d", tc.chars, got, tc.want)
		}
	}
}

func TestMessagesChars(t *testing.T) {
	msgs := []Message{
		{Role: "user", Content: "hello"},
		{Role: "assistant", Content: "world!"},
	}
	if got := MessagesChars(msgs); got != 11 {
		t.Errorf("MessagesChars = %d, want 11", got)
	}
}

func TestContextTooLargeError(t *testing.T) {
	err := &ContextTooLargeError{
		Model:     "test-model",
		Estimated: 2500,
		Limit:     2000,
	}
	if !errors.Is(err, ErrContextTooLarge) {
		t.Error("expected ContextTooLargeError to unwrap to ErrContextTooLarge")
	}
	msg := err.Error()
	if msg == "" {
		t.Error("expected non-empty error string")
	}
}
