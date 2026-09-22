// UNREVIEWED
package handlers

import (
	"errors"
	"net/http"

	"github.com/pocketbase/pocketbase/core"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/usage"
	"github.com/north-shore-software/kalaido/kalaidoscope/llm"
)

// WriteLLMError translates LLM errors (quota exhaustion, provider errors, context size limits)
// into appropriate HTTP responses on e. It reports whether the error was recognized as an LLM
// error, and returns any error that the handler should return.
func WriteLLMError(e *core.RequestEvent, app core.App, err error) (bool, error) {
	if err == nil {
		return false, nil
	}
	if errors.Is(err, usage.ErrExhausted) {
		return true, usage.WriteExhausted(e, app)
	}
	if usage.WriteProviderError(e, err) {
		return true, nil
	}
	var tooLarge *llm.ContextTooLargeError
	if errors.As(err, &tooLarge) || errors.Is(err, llm.ErrContextTooLarge) {
		return true, e.Error(http.StatusUnprocessableEntity, err.Error(), err)
	}
	return false, nil
}
