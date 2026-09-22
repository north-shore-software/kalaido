// UNREVIEWED
package api

// StartDiscoverRequest is the body of POST /api/discover: which discover flow
// to wake ("colours", "projections" or "reflections").
type StartDiscoverRequest struct {
	Kind string `json:"kind"`
}

type DiscoverStatus struct {
	State          string             `json:"state"`
	Running        string             `json:"running,omitempty"`
	Pending        []string           `json:"pending"`
	Due            []string           `json:"due"`
	Runs           map[string]RunInfo `json:"runs"`
	Proposals      ProposalCounts     `json:"proposals"`
	WaitingOnMap   bool               `json:"waitingOnMap"`
	CurrentStarted string             `json:"currentStarted,omitempty"`
}

type ProposalCounts struct {
	Projections int `json:"projections"`
	Reflections int `json:"reflections"`
}

const (
	DiscoverStateNeverRun = "never_run"
	DiscoverStatePending  = "pending"
	DiscoverStateRunning  = "running"
	DiscoverStateDue      = "due"
	DiscoverStateSettled  = "settled"
)
