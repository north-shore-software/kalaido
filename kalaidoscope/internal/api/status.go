package api

type KalaidoscopeStatus struct {
	Fragments int             `json:"fragments"`
	Imports   ImportsStatus   `json:"imports"`
	Map       MapStatus       `json:"map"`
	Discover  DiscoverStatus  `json:"discover"`
	Policy    StatusPolicy    `json:"policy"`
	Reconcile ReconcileStatus `json:"reconcile"`
	Colour    ColourStatus    `json:"colour"`
}

// StatusPolicy is how the background work is configured to run: Wave is
// whether reconcile waves start on their own (KALAIDO_AUTO_WAVE).
type StatusPolicy struct {
	Wave bool `json:"wave"`
}

type ColourStatus struct {
	Draining           bool   `json:"draining"`
	CurrentColourID    string `json:"currentColourId,omitempty"`
	LastStarted        string `json:"lastStarted,omitempty"`
	LastCompleted      string `json:"lastCompleted,omitempty"`
	LastError          string `json:"lastError,omitempty"`
	PromptColoursCount int    `json:"promptColoursCount"`
	TotalColoursCount  int    `json:"totalColoursCount"`
	UnjudgedFragments  int    `json:"unjudgedFragments"`
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
