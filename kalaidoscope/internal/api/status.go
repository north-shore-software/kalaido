package api

type EntityStatus struct {
	ID                 string   `json:"id"`
	Type               string   `json:"type"` // "projection" or "reflection"
	UpToDateSnapshotID string   `json:"upToDateSnapshotId,omitempty"`
	NewFragmentIDs     []string `json:"newFragmentIds,omitempty"`
	StaleDependencies  []string `json:"staleDependencies,omitempty"`
	PendingWindows     []Window `json:"pendingWindows,omitempty"`
}

type Window struct {
	ID    string `json:"id"`
	Start string `json:"start"`
	End   string `json:"end"`
}

type StatusResponse struct {
	Statuses []EntityStatus `json:"statuses"`
}
