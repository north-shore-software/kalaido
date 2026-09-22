package handlers

import (
	"errors"
	"net/http"

	"github.com/pocketbase/pocketbase/core"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/api"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/explore"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/usage"
)

// exploreTooLargeHint aliased for handler tests.
const exploreTooLargeHint = explore.ExploreTooLargeHint

// HandleExplore handles conversational workspace exploration turns under POST /api/explore.
func HandleExplore(app core.App) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		var req api.ExploreRequest
		if err := e.BindBody(&req); err != nil {
			return e.BadRequestError("invalid explore request body", err)
		}

		err := explore.StreamTurn(e.Request.Context(), app, req, e.Response)
		switch {
		case errors.Is(err, explore.ErrMessagesRequired):
			return e.BadRequestError("messages required", nil)
		case errors.Is(err, explore.ErrNoModel):
			return e.InternalServerError("no model configured for chat", err)
		case errors.Is(err, usage.ErrExhausted):
			return usage.WriteExhausted(e, app)
		case usage.WriteProviderError(e, err):
			return nil
		}

		var promptErr *explore.PromptTooLargeError
		if errors.As(err, &promptErr) {
			return e.Error(http.StatusUnprocessableEntity, promptErr.Text, promptErr.Err)
		}

		if err != nil {
			return e.InternalServerError("llm stream failed", err)
		}

		return nil
	}
}
