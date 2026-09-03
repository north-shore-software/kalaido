package api

type ContextSpec struct {
	WholeScope bool `json:"wholeScope,omitempty"`

	// Summaries renders the whole-scope fragments as their annotation rows
	// (title, summary, cited map things) instead of their full bodies, and
	// gives the chat read tools to pull full text on demand. Pinned fragments
	// and colours (below) stay in full. Server-side the flag applies to
	// whatever the spec resolves; the UI only offers it with WholeScope.
	Summaries bool `json:"summaries,omitempty"`

	// The pins. Without WholeScope they are the context. With WholeScope the
	// fragment-level pins (FragmentIDs, FragmentTypes, ColourIDs) add nothing
	// to the scope — every fragment is already in it — but mark what renders
	// in full under Summaries; the snapshot pins add their upstream's latest
	// snapshot, which whole scope never includes.
	//
	// Explicit Fragments: individual fragments pinned by id, included whatever
	// their type or colours. Unlike the criteria below this set is static — it
	// never grows as new fragments arrive — so it supplements the rules rather
	// than replacing them. A pinned fragment that has since been deleted drops
	// out of resolution like any other.
	FragmentIDs         []string `json:"fragmentIds,omitempty"`
	FragmentTypes       []string `json:"fragmentTypes,omitempty"`
	ColourIDs           []string `json:"colourIds,omitempty"`
	SourceProjectionIDs []string `json:"sourceProjectionIds,omitempty"`
	SourceReflectionIDs []string `json:"sourceReflectionIds,omitempty"`
}

type WindowSpec struct {
	Mode      string `json:"mode,omitempty"`
	StartTime string `json:"startTime"`
	EndTime   string `json:"endTime,omitempty"`
	Period    string `json:"period"`
	Duration  string `json:"duration"`
}

type WindowSpecVersion struct {
	VersionNumber int        `json:"versionNumber"`
	EffectiveFrom string     `json:"effectiveFrom"`
	Spec          WindowSpec `json:"spec"`
}

type TokenResolutionResponse struct {
	TotalTokens int            `json:"totalTokens"`
	Breakdown   map[string]int `json:"breakdown"`
	// Model is the chat role's default model the estimate was checked against;
	// Limit its prompt budget (0 when the provider reports no window) and Fits
	// whether TotalTokens is within it. The chat guard remains authoritative —
	// a conversation may override the model.
	Model string `json:"model"`
	Limit int    `json:"limit"`
	Fits  bool   `json:"fits"`
}
