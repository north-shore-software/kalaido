// UNREVIEWED
package api

import (
	"encoding/json"
	"errors"
)

type GenerateSnapshotRequest struct {
	SourceID    string      `json:"sourceId"` // ProjectionID or ReflectionID
	ChatID      string      `json:"chatId"`
	FragmentIDs []string    `json:"fragmentIds"`
	ColourIDs   []string    `json:"colourIds"`
	Messages    []UIMessage `json:"messages"`
	Preview     bool        `json:"preview"`
	WindowID    string      `json:"windowId,omitempty"`
	AllWindows  bool        `json:"allWindows,omitempty"`
}

func (r GenerateSnapshotRequest) Validate() error {
	if r.WindowID != "" && r.AllWindows {
		return errors.New("cannot specify both windowId and allWindows=true")
	}
	return nil
}

// UnmarshalJSON supports both "allWindows" and the legacy "all" JSON key.
func (r *GenerateSnapshotRequest) UnmarshalJSON(data []byte) error {
	type rawRequest GenerateSnapshotRequest
	var raw struct {
		rawRequest
		All bool `json:"all"`
	}
	if err := json.Unmarshal(data, &raw); err != nil {
		return err
	}
	*r = GenerateSnapshotRequest(raw.rawRequest)
	if raw.All {
		r.AllWindows = true
	}
	return nil
}

type GenerateSnapshotResponse struct {
	SourceID   string `json:"sourceId"`
	LensID     string `json:"lensId"`
	SnapshotID string `json:"snapshotId"`
	Content    string `json:"content,omitempty"`
}
type ReviewCandidateRequest struct {
	SnapshotID string `json:"snapshotId"`
}

// EditCandidateRequest is the body of
// POST /api/projections/{id}/candidates/{rid}/edit: replace the one exact
// occurrence of OldText in the pending candidate's output with NewText. The
// client sends the raw markdown slice it selected, so the match is verbatim.
type EditCandidateRequest struct {
	OldText string `json:"oldText"`
	NewText string `json:"newText"`
}

// EditCandidateResponse names the new pending snapshot carrying the edit and
// the "edit" fragment that records it.
type EditCandidateResponse struct {
	SnapshotID string `json:"snapshotId"`
	FragmentID string `json:"fragmentId"`
}
