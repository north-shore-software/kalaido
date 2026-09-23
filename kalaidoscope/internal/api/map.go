package api

type MapStatus struct {
	State             string   `json:"state"`
	Version           int      `json:"version"`
	Annotated         int      `json:"annotated"`
	PendingAnnotation int      `json:"pendingAnnotation"`
	Unconsolidated    int      `json:"unconsolidated"`
	LastRun           *RunInfo `json:"lastRun,omitempty"`
	LastDrainError    string   `json:"lastDrainError,omitempty"`
	WantSettle        bool     `json:"wantSettle"`
	ThingsCount       int      `json:"thingsCount"`
}

const (
	MapStateEmpty         = "empty"
	MapStateUnannotated   = "unannotated"
	MapStateAnnotating    = "annotating"
	MapStateConsolidating = "consolidating"
	MapStateFolding       = "folding"
	MapStateSettled       = "settled"
)
