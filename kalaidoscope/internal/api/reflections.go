// UNREVIEWED
package api

type ReflectionSnapshotResponse struct {
	SnapshotIDs []string `json:"snapshotIds"`
}

type CreateReflectionResponse struct {
	ReflectionID string `json:"reflectionId"`
}

// WindowInfo is one window of a reflection's series as served by
// GET /api/reflections/{id}/windows.
type WindowInfo struct {
	Window
	// The key snapshots for this window are filed under (start_end).
	Key         string `json:"key"`
	HasApproved bool   `json:"hasApproved"`
	Generating  bool   `json:"generating"`
	// Materialized by an explicit backfill rather than by the grid.
	Backfilled bool `json:"backfilled"`
	// Filled by the status evaluator: an approved snapshot exists but the
	// window's context has changed since it was generated.
	Stale bool `json:"stale,omitempty"`
	// The approved snapshot was produced by a lens other than the
	// reflection's current one — a refinement was committed since.
	LensOutdated bool `json:"lensOutdated,omitempty"`
}

type ReflectionWindowsResponse struct {
	Windows []WindowInfo `json:"windows"`
	// The window a new refinement defaults to (the current one); empty for
	// an unscheduled reflection.
	CurrentWindowID string `json:"currentWindowId,omitempty"`
}

type BackfillRequest struct {
	// RFC3339. Windows between it and the first one the grid already covers
	// are materialized.
	From string `json:"from"`
}

type BackfillResponse struct {
	Windows []Window `json:"windows"`
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

type CreateReflectionRequest = CreateSynthesisRequest

// EntityStatus is one entity's freshness. StaleDependencies and BlockedBy both
// name upstream entities, but they mean opposite things for the caller:
// StaleDependencies is work that can be done now, BlockedBy is work that can't.
type ReflectionStatus struct {
	ID                 string   `json:"id"`
	Type               string   `json:"type"` // "projection" or "reflection"
	UpToDateSnapshotID string   `json:"upToDateSnapshotId,omitempty"`
	NewFragmentIDs     []string `json:"newFragmentIds,omitempty"`
}

type Window struct {
	ID    string `json:"id"`
	Start string `json:"start"`
	End   string `json:"end"`
}

type StatusResponse struct {
	Statuses []EntityStatus `json:"statuses"`
}
