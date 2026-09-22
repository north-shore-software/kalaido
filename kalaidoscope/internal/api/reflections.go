// UNREVIEWED
package api

type ReflectionSnapshotResponse struct {
	SnapshotIDs []string `json:"snapshotIds"`
}

type CreateReflectionResponse struct {
	ReflectionID string `json:"reflectionId"`
}

// CreateReflectionRequest is the body of POST /api/reflections.
type CreateReflectionRequest struct {
	Name string `json:"name"`
	// What this entity is for, when the creator has one to give — a chat's
	// brief. Discover writes its own; typed creates leave it empty.
	Description string `json:"description,omitempty"`
	// Reflections only: the schedule. A Start Time in the past is "summarize
	// from then": the first version is effective from it, so every grid
	// window since is pending (the backfill).
	WindowSpec *WindowSpec `json:"windowSpec,omitempty"`
}

// UpdateReflectionRequest is the body of PATCH /api/reflections/{id}.
// Every field is optional; absent fields are left untouched.
type UpdateReflectionRequest struct {
	Name *string `json:"name,omitempty"`
	// Pin or unpin the entity for the calling user.
	Pinned *bool `json:"pinned,omitempty"`
	// Reflections only: append a new schedule version.
	WindowSpec *WindowSpec `json:"windowSpec,omitempty"`
	// Per-entity model override for future generations; empty clears it.
	GenerateWithModel *string `json:"generateWithModel,omitempty"`
}

// CreateReflectionRefinementRequest opens a refinement session over a reflection.
type CreateReflectionRefinementRequest struct {
	ClientID string `json:"clientId"`
	// The window the preview is generated against to begin with.
	// Defaults to the reflection's current window.
	Window *Window `json:"window,omitempty"`
	// ContextSpec seeds the conversation's context directly.
	ContextSpec *ContextSpec `json:"contextSpec,omitempty"`
}

type CreateReflectionRefinementResponse struct {
	RefinementID string `json:"refinementId"`
	// The messages seeded onto the new conversation, with the ids they were
	// persisted under. Callers must display these rather than reconstructing
	// their own copies, or the next turn will persist duplicates.
	Messages []UIMessage `json:"messages,omitempty"`
}

type Window struct {
	ID    string `json:"id"`
	Start string `json:"start"`
	End   string `json:"end"`
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

// ReflectionStatus is one reflection's freshness, including window state.
type ReflectionStatus struct {
	ID                 string   `json:"id"`
	Type               string   `json:"type"` // "reflection" or "projection"
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
