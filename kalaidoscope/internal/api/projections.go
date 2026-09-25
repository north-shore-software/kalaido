package api

type ProjectionSnapshotResponse struct {
	SnapshotID string `json:"snapshotId"`
}

type GenerateProjectionSnapshotRequest struct {
	SourceID       string      `json:"sourceId"` // ProjectionID
	ChatID         string      `json:"chatId"`
	FragmentIDs    []string    `json:"fragmentIds"`
	ColourIDs      []string    `json:"colourIds"`
	Messages       []UIMessage `json:"messages"`
	Preview        bool        `json:"preview"`
	DiscardEngaged bool        `json:"discardEngaged,omitempty"`
	// FoldIn marks an approve-then-regenerate: an unchanged result settles
	// the approved row in place, and the refinement that was open on the
	// approved candidate carries over to the new one.
	FoldIn bool `json:"foldIn,omitempty"`
}

type ReviewCandidateRequest struct {
	SnapshotID string `json:"snapshotId"`
}

// EditCandidateRequest is the body of
// POST /api/projections/{id}/candidates/{rid}/edit: replace the markdown
// block at BlockPosition (0-based, as segmented by the engine) of the pending
// candidate's draft with NewText. An empty NewText deletes the block.
type EditCandidateRequest struct {
	BlockPosition int    `json:"blockPosition"`
	NewText       string `json:"newText"`
}

type EditCandidateResponse struct {
	FragmentID string       `json:"fragmentId"`
	Edit       SnapshotEdit `json:"edit"`
}

type UpdateSnapshotEditStatusRequest struct {
	Status SnapshotEditStatus `json:"status"`
}

type UpdateSnapshotEditStatusResponse struct {
	Edit SnapshotEdit `json:"edit"`
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
