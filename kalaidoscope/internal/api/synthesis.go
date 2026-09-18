package api

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
type UpdateReflectionRequest = UpdateSynthesisRequest

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
type CreateReflectionRequest = CreateSynthesisRequest
