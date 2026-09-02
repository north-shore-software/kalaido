package engine

import (
	"errors"
	"fmt"

	"github.com/north-shore-software/kalaido/kalaidoscope/llm"
)

// ErrContextTooLarge marks a generation refused before the model call because
// its prompt cannot fit the model's context window. Surfaced to the user as
// actionable text rather than the provider's 400.
var ErrContextTooLarge = errors.New("context too large for the model")

type ContextTooLargeError struct {
	Model     string
	Estimated int
	Limit     int
}

func (e *ContextTooLargeError) Error() string {
	return fmt.Sprintf("the context is about %s tokens but %s accepts about %s — narrow the window or the context",
		humanTokens(e.Estimated), e.Model, humanTokens(e.Limit))
}

func (e *ContextTooLargeError) Unwrap() error { return ErrContextTooLarge }

func humanTokens(n int) string {
	switch {
	case n >= 1_000_000:
		return fmt.Sprintf("%.1fM", float64(n)/1_000_000)
	case n >= 1_000:
		return fmt.Sprintf("%dk", n/1_000)
	}
	return fmt.Sprintf("%d", n)
}

// EstimateTokens is the same rough chars/4 estimate the context bar's token
// endpoint uses. Deliberately approximate: it decides whether to attempt a
// call, not what to bill.
func EstimateTokens(chars int) int { return chars / 4 }

// CheckPromptFits refuses a prompt of `chars` characters when the estimate
// exceeds the model's context window less a reserve for the output. A provider
// that reports no window (0) is not checked.
func CheckPromptFits(model string, chars int) error {
	limit := llm.SelectedProvider(model).ContextWindow()
	if limit <= 0 {
		return nil
	}
	budget := limit - limit/8
	if est := EstimateTokens(chars); est > budget {
		return &ContextTooLargeError{Model: model, Estimated: est, Limit: limit}
	}
	return nil
}

// MessagesChars totals the characters of a transcript for CheckPromptFits.
func MessagesChars(msgs []llm.Message) int {
	n := 0
	for _, m := range msgs {
		n += len(m.Content)
	}
	return n
}
