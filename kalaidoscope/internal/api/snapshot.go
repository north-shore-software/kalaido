// UNREVIEWED
package api

type GenerateSnapshotRequest struct {
	SourceID    string      `json:"sourceId"` // ProjectionID or ReflectionID
	ChatID      string      `json:"chatId"`
	FragmentIDs []string    `json:"fragmentIds"`
	ColourIDs   []string    `json:"colourIds"`
	Messages    []UIMessage `json:"messages"`
	Preview     bool        `json:"preview"`
	WindowID    string      `json:"windowId,omitempty"`
	All         bool        `json:"all,omitempty"`
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
