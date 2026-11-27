package api

// EntityStatus is one entity's freshness as served by GET /api/reconcile.
// Projections populate the base fields; reflections additionally populate
// PendingWindows and StaleWindows.
type EntityStatus = ReflectionStatus

// ReconcilePlanResponse is the body of GET /api/reconcile: every active
// entity's freshness.
type ReconcilePlanResponse struct {
	Statuses []EntityStatus `json:"statuses"`
}
