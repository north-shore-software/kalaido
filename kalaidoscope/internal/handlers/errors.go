package handlers

import (
	"errors"
	"net/http"
	"strings"

	"github.com/pocketbase/pocketbase/core"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/engine"
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

// WriteGenerateError maps a failed snapshot generation for a targetType
// ("projection" or "reflection") to its response. err must be non-nil.
func WriteGenerateError(e *core.RequestEvent, app core.App, err error, targetType string) error {
	logger().Error("generate failed", "target_type", targetType, "error", err)
	if handled, herr := WriteLLMError(e, app, err); handled {
		return herr
	}
	switch {
	case errors.Is(err, engine.ErrLensNotReady):
		return e.Error(http.StatusConflict, "This "+targetType+"'s lens is still being prepared — try again in a moment.", err)
	case errors.Is(err, engine.ErrGenerationInFlight):
		return e.Error(http.StatusConflict, "A generation for this "+targetType+" is already running.", err)
	case strings.Contains(err.Error(), "not found"):
		return e.NotFoundError(targetType+" not found", err)
	}
	return e.InternalServerError("generate "+targetType+" failed", err)
}
