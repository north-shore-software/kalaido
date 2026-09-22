// UNREVIEWED
package api

// EntityStatus is one entity's freshness as served by GET /api/rotation.
// Projections populate the base fields; reflections additionally populate
// PendingWindows and StaleWindows.
type EntityStatus = ReflectionStatus

type StatusResponse struct {
	Statuses []EntityStatus `json:"statuses"`
}

// ReconcileStatus is the speculative wave's state: whether one is running,
// when the latest one began, what ended the last one, and when one last ran
// clean. The dashboard's Start reads it to tell "still generating" from
// "the wave I started has ended" (LastStarted at or after the press, and not
// Running).
type ReconcileStatus struct {
	Running bool `json:"running"`
	// RFC3339; empty until a wave has started.
	LastStarted string `json:"lastStarted,omitempty"`
	LastError   string `json:"lastError,omitempty"`
	// RFC3339; empty until a wave has completed without error.
	LastCompleted string `json:"lastCompleted,omitempty"`
}
