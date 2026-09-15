package api

type OrganizeStatus struct {
	Fragments int             `json:"fragments"`
	Imports   ImportsStatus   `json:"imports"`
	Map       MapStatus       `json:"map"`
	Discover  DiscoverStatus  `json:"discover"`
	Policy    OrganizePolicy  `json:"policy"`
	Reconcile ReconcileStatus `json:"reconcile"`
}

type ImportsStatus struct {
	Pending   int    `json:"pending"`
	LastError string `json:"lastError,omitempty"`
}

type MapStatus struct {
	State             string   `json:"state"`
	Version           int      `json:"version"`
	Annotated         int      `json:"annotated"`
	PendingAnnotation int      `json:"pendingAnnotation"`
	Unconsolidated    int      `json:"unconsolidated"`
	LastRun           *RunInfo `json:"lastRun,omitempty"`
	LastDrainError    string   `json:"lastDrainError,omitempty"`
}

type DiscoverStatus struct {
	State     string             `json:"state"`
	Running   string             `json:"running,omitempty"`
	Pending   []string           `json:"pending"`
	Due       []string           `json:"due"`
	Runs      map[string]RunInfo `json:"runs"`
	Proposals ProposalCounts     `json:"proposals"`
}

type ProposalCounts struct {
	Projections int `json:"projections"`
	Reflections int `json:"reflections"`
}

type OrganizePolicy struct {
	Wave bool `json:"wave"`
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

type RunInfo struct {
	ID          string `json:"id"`
	Status      string `json:"status"`
	Error       string `json:"error,omitempty"`
	Model       string `json:"model,omitempty"`
	Rounds      int    `json:"rounds,omitempty"`
	MapVersion  int    `json:"mapVersion,omitempty"`
	Finished    string `json:"finished"`
	Interrupted bool   `json:"interrupted,omitempty"`
}

const (
	MapStateEmpty         = "empty"
	MapStateUnannotated   = "unannotated"
	MapStateAnnotating    = "annotating"
	MapStateConsolidating = "consolidating"
	MapStateFolding       = "folding"
	MapStateSettled       = "settled"

	DiscoverStateNeverRun = "never_run"
	DiscoverStatePending  = "pending"
	DiscoverStateRunning  = "running"
	DiscoverStateDue      = "due"
	DiscoverStateSettled  = "settled"
)
