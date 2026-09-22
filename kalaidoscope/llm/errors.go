package llm

import (
	"fmt"
	"net/http"
)

// ErrorKind classifies a provider failure so callers can tell a credential
// problem the user has to fix apart from a transient one worth retrying.
type ErrorKind string

const (
	ErrKindAuth      ErrorKind = "auth"      // invalid/revoked key, or no access to the model
	ErrKindQuota     ErrorKind = "quota"     // rate limit or quota exhausted
	ErrKindTransient ErrorKind = "transient" // network failure, timeout, 5xx
	ErrKindOther     ErrorKind = "other"
)

// ProviderError is the classified failure every Provider returns, so the
// validation, hook and handler layers never need to know which concrete
// provider produced it. A new provider classifies into this same type rather
// than introducing its own error shape.
type ProviderError struct {
	Provider   ProviderID
	Kind       ErrorKind
	StatusCode int // 0 when the request never reached a response
	Model      string
	Body       string
}

func (e *ProviderError) Error() string {
	if e.StatusCode == 0 {
		return fmt.Sprintf("%s: %s (model %q): %s", e.Provider, e.Kind, e.Model, e.Body)
	}
	return fmt.Sprintf("%s: %s (HTTP %d, model %q): %s", e.Provider, e.Kind, e.StatusCode, e.Model, e.Body)
}

// ClassifyStatus maps an HTTP status onto a Kind. Shared by providers whose
// APIs use conventional REST status semantics; a provider that signals errors
// differently is free to classify its own way.
func ClassifyStatus(code int) ErrorKind {
	switch {
	case code == http.StatusUnauthorized, code == http.StatusForbidden:
		return ErrKindAuth
	case code == http.StatusTooManyRequests:
		return ErrKindQuota
	case code >= 500:
		return ErrKindTransient
	default:
		return ErrKindOther
	}
}
