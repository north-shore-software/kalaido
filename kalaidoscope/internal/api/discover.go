// UNREVIEWED
package api

// DiscoverKickRequest is the body of POST /api/discover: which discover flow
// to wake ("colours", "projections" or "reflections").
type DiscoverKickRequest struct {
	Kind string `json:"kind"`
}
