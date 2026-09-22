// UNREVIEWED
package api

// EntityStatus is one entity's freshness as served by GET /api/rotation.
// Projections populate the base fields; reflections additionally populate
// PendingWindows and StaleWindows.
type EntityStatus = ReflectionStatus

type StatusResponse struct {
	Statuses []EntityStatus `json:"statuses"`
}
