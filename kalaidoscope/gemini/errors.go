package gemini

import (
	"encoding/json"

	"github.com/north-shore-software/kalaido/kalaidoscope/llm"
)

// errorBody is the envelope the API returns on failure.
type errorBody struct {
	Error struct {
		Code    int    `json:"code"`
		Message string `json:"message"`
		Status  string `json:"status"`
		Details []struct {
			Reason string `json:"reason"`
		} `json:"details"`
	} `json:"error"`
}

// classify maps a failed response onto a shared error kind.
//
// The status line alone is not enough: Gemini reports an invalid or revoked API
// key as HTTP 400 INVALID_ARGUMENT with an API_KEY_INVALID reason, not as a 401,
// so classifying on status would file a dead credential under "other" and lose
// the one distinction the user actually needs. The body decides where it can,
// and status is the fallback.
func classify(status int, body []byte) llm.ErrorKind {
	var parsed errorBody
	if err := json.Unmarshal(body, &parsed); err == nil {
		for _, d := range parsed.Error.Details {
			switch d.Reason {
			case "API_KEY_INVALID", "API_KEY_SERVICE_BLOCKED", "ACCOUNT_STATE_INVALID", "SERVICE_DISABLED":
				return llm.ErrKindAuth
			}
		}
		switch parsed.Error.Status {
		case "UNAUTHENTICATED", "PERMISSION_DENIED":
			return llm.ErrKindAuth
		case "RESOURCE_EXHAUSTED":
			return llm.ErrKindQuota
		case "UNAVAILABLE", "DEADLINE_EXCEEDED", "INTERNAL":
			return llm.ErrKindTransient
		}
	}
	return llm.ClassifyStatus(status)
}
