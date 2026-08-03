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
