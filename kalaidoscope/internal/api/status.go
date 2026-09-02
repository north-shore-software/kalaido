package api

// EntityStatus is one entity's freshness. StaleDependencies and BlockedBy both
// name upstream entities, but they mean opposite things for the caller:
// StaleDependencies is work that can be done now, BlockedBy is work that can't.
type EntityStatus struct {
	ID                 string   `json:"id"`
	Type               string   `json:"type"` // "projection" or "reflection"
	UpToDateSnapshotID string   `json:"upToDateSnapshotId,omitempty"`
	NewFragmentIDs     []string `json:"newFragmentIds,omitempty"`
	// Upstreams that have published a newer approved snapshot than the one the
	// live snapshot consumed. Regenerating now would pick up their new output.
	StaleDependencies []string `json:"staleDependencies,omitempty"`
	// Upstreams that are not themselves up to date. Regenerating now would
	// consume output that is about to be superseded, so this entity should wait.
	BlockedBy []string `json:"blockedBy,omitempty"`
	// Reflections: materialized windows with no approved snapshot yet.
	PendingWindows []Window `json:"pendingWindows,omitempty"`
	// Reflections: windows whose approved snapshot predates fragments that
	// now fall inside them (a backdated import, a late-arriving email).
	StaleWindows []Window `json:"staleWindows,omitempty"`
}

type Window struct {
	ID    string `json:"id"`
	Start string `json:"start"`
	End   string `json:"end"`
}

type StatusResponse struct {
	Statuses []EntityStatus `json:"statuses"`
}
