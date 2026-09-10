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
