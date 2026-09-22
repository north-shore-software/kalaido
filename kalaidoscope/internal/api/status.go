// UNREVIEWED
package api

type KalaidoscopeStatus struct {
	Fragments int            `json:"fragments"`
	Imports   ImportsStatus  `json:"imports"`
	Map       MapStatus      `json:"map"`
	Discover  DiscoverStatus `json:"discover"`

	Reconcile ReconcileStatus `json:"reconcile"`
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
