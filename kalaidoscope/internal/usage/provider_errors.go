package usage

import (
	"errors"
	"net/http"

	"github.com/pocketbase/pocketbase/core"

	"github.com/north-shore-software/kalaido/kalaidoscope/llm"
)

// WriteProviderError responds with a classified provider failure and reports
// whether it handled the error. A false return means this wasn't a provider
// failure and the caller should fall through to its own handling.
//
// Note the deliberate absence of 401: on a PocketBase endpoint that reads as
// "your session expired", and the SDK and app-level interceptors treat it that
// way — which would log the user out over a bad Gemini key while their actual
// session is fine. The status only has to be distinguishable; the error code
// carries the meaning.
func WriteProviderError(e *core.RequestEvent, err error) bool {
	var perr *llm.ProviderError
	if !errors.As(err, &perr) {
		return false
	}

	status, code := http.StatusBadGateway, "provider_error"
	switch perr.Kind {
	case llm.ErrKindAuth:
		status, code = http.StatusConflict, "provider_auth_failed"
	case llm.ErrKindQuota:
		// Distinct from Kalaido's own quota exhaustion, which is 402.
		status, code = http.StatusTooManyRequests, "provider_quota_exceeded"
	case llm.ErrKindTransient:
		status, code = http.StatusBadGateway, "provider_transient"
	}

	_ = e.JSON(status, map[string]any{
		"error":    code,
		"kind":     string(perr.Kind),
		"provider": string(perr.Provider),
		"model":    perr.Model,
		"detail":   perr.Error(),
	})
	return true
}
