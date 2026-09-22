// UNREVIEWED
package api

type ProjectionSnapshotResponse struct {
	SnapshotID string `json:"snapshotId"`
}

type CreateProjectionResponse struct {
	ProjectionID string `json:"projectionId"`
}

// UpdateSynthesisRequest is the body of PATCH /api/projections/{id} and
// PATCH /api/reflections/{id}. Every field is optional; absent fields are
// left untouched.
type UpdateSynthesisRequest struct {
	Name *string `json:"name,omitempty"`
	// Pin or unpin the entity for the calling user.
	Pinned *bool `json:"pinned,omitempty"`
	// Reflections only: append a new schedule version.
	WindowSpec *WindowSpec `json:"windowSpec,omitempty"`
	// Per-entity model override for future generations; empty clears it.
	GenerateWithModel *string `json:"generateWithModel,omitempty"`
}

type UpdateProjectionRequest = UpdateSynthesisRequest

// CreateSynthesisRequest is the body of POST /api/projections and
// POST /api/reflections.
type CreateSynthesisRequest struct {
	Name string `json:"name"`
	// What this entity is for, when the creator has one to give — a chat's
	// brief. Discover writes its own; typed creates leave it empty.
	Description string `json:"description,omitempty"`
	// Reflections only: the schedule. A Start Time in the past is "summarize
	// from then": the first version is effective from it, so every grid
	// window since is pending (the backfill).
	WindowSpec *WindowSpec `json:"windowSpec,omitempty"`
}

type CreateProjectionRequest = CreateSynthesisRequest

// EntityStatus is one entity's freshness. StaleDependencies and BlockedBy both
// name upstream entities, but they mean opposite things for the caller:
// StaleDependencies is work that can be done now, BlockedBy is work that can't.
type ProjectionStatus struct {
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
}

type Window struct {
	ID    string `json:"id"`
	Start string `json:"start"`
	End   string `json:"end"`
}

type StatusResponse struct {
	Statuses []EntityStatus `json:"statuses"`
}
