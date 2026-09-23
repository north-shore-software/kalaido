package api

// EntityStatus is one entity's freshness as served by GET /api/reconcile.
// Projections populate the base fields; reflections additionally populate
// PendingWindows and StaleWindows.
type EntityStatus = ReflectionStatus

type CurrentEntityInfo struct {
	ID   string `json:"id"`
	Type string `json:"type"`
}

type WaveProgress struct {
	Completed int `json:"completed"`
	Total     int `json:"total"`
}

type ReconcileStatus struct {
	Running       bool               `json:"running"`
	LastStarted   string             `json:"lastStarted,omitempty"`
	LastError     string             `json:"lastError,omitempty"`
	LastCompleted string             `json:"lastCompleted,omitempty"`
	LastCancelled string             `json:"lastCancelled,omitempty"`
	CurrentEntity *CurrentEntityInfo `json:"currentEntity,omitempty"`
	Progress      *WaveProgress      `json:"progress,omitempty"`
}

// ReconcilePlanResponse is the body of GET /api/reconcile: the wave's state
// beside every entity's freshness, dependencies before dependents.
type ReconcilePlanResponse struct {
	ReconcileStatus
	Statuses []EntityStatus `json:"statuses"`
}
