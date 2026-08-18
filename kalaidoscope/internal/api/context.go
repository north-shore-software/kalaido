package api

type ContextSpec struct {
	WholeScope bool `json:"wholeScope,omitempty"`

	// Ignored if WholeScope is true

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
}
