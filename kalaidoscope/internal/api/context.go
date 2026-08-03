package api

type ContextSpec struct {
	WholeScope bool `json:"wholeScope,omitempty"`

	// Ignored if WholeScope is true
	FragmentTypes       []string `json:"fragmentTypes,omitempty"`
	ColourIDs           []string `json:"colourIds,omitempty"`
	SourceProjectionIDs []string `json:"sourceProjectionIds,omitempty"`
	SourceReflectionIDs []string `json:"sourceReflectionIds,omitempty"`
}

type WindowSpec struct {
	StartTime string `json:"startTime"` // e.g., RFC3339 string "2023-01-01T00:00:00Z"
	Period    string `json:"period"`    // e.g., "168h", "24h"
	Duration  string `json:"duration"`  // e.g., "168h", "24h"
}

type TokenResolutionResponse struct {
	TotalTokens int            `json:"totalTokens"`
	Breakdown   map[string]int `json:"breakdown"`
}
