package api

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
