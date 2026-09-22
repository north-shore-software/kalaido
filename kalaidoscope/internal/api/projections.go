// UNREVIEWED
package api

type ProjectionSnapshotResponse struct {
	SnapshotID string `json:"snapshotId"`
}

type CreateProjectionResponse struct {
	ProjectionID string `json:"projectionId"`
}

// CreateProjectionRequest is the body of POST /api/projections.
type CreateProjectionRequest struct {
	Name string `json:"name"`
	// What this entity is for, when the creator has one to give — a chat's
	// brief. Discover writes its own; typed creates leave it empty.
	Description string `json:"description,omitempty"`
}

// UpdateProjectionRequest is the body of PATCH /api/projections/{id}.
// Every field is optional; absent fields are left untouched.
type UpdateProjectionRequest struct {
	Name *string `json:"name,omitempty"`
	// Pin or unpin the entity for the calling user.
	Pinned *bool `json:"pinned,omitempty"`
	// Per-entity model override for future generations; empty clears it.
	GenerateWithModel *string `json:"generateWithModel,omitempty"`
}

// CreateProjectionRefinementRequest opens a refinement session over a projection.
type CreateProjectionRefinementRequest struct {
	ClientID string `json:"clientId"`
	// Scopes the session to an existing snapshot, whose context seeds the conversation.
	SnapshotID string `json:"snapshotId,omitempty"`
	// ContextSpec seeds the conversation's context directly. Takes precedence
	// over the snapshot's own, so a session can start from a context that no
	// snapshot has ever been generated against.
	ContextSpec *ContextSpec `json:"contextSpec,omitempty"`
}

type CreateProjectionRefinementResponse struct {
	RefinementID string `json:"refinementId"`
	// The messages seeded onto the new conversation, with the ids they were
	// persisted under. Callers must display these rather than reconstructing
	// their own copies, or the next turn will persist duplicates.
	Messages []UIMessage `json:"messages,omitempty"`
}

// ProjectionStatus is one projection's freshness. StaleDependencies and BlockedBy
// both name upstream entities, but they mean opposite things for the caller:
// StaleDependencies is work that can be done now, BlockedBy is work that can't.
type ProjectionStatus struct {
	ID                 string   `json:"id"`
	Type               string   `json:"type"` // "projection"
	UpToDateSnapshotID string   `json:"upToDateSnapshotId,omitempty"`
	NewFragmentIDs     []string `json:"newFragmentIds,omitempty"`
	// Upstreams that have published a newer approved snapshot than the one the
	// live snapshot consumed. Regenerating now would pick up their new output.
	StaleDependencies []string `json:"staleDependencies,omitempty"`
	// Upstreams that are not themselves up to date. Regenerating now would
	// consume output that is about to be superseded, so this entity should wait.
	BlockedBy []string `json:"blockedBy,omitempty"`
}
