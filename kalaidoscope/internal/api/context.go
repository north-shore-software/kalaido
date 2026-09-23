package api

import (
	"errors"
	"time"
)

type WholeScopeMode string

const (
	WholeScopeFull      WholeScopeMode = "full"
	WholeScopeSummaries WholeScopeMode = "summaries"
)

type ContextSpec struct {
	WholeScope WholeScopeMode `json:"wholeScope,omitempty"`

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

// Validate rejects a schedule the grid could not evaluate. An empty
// spec (unscheduled) is valid.
func (spec WindowSpec) Validate() error {
	if spec.Period == "" && spec.Duration == "" && spec.StartTime == "" {
		return nil
	}
	if p, err := time.ParseDuration(spec.Period); err != nil || p <= 0 {
		return errors.New("windowSpec.period must be a positive duration such as \"168h\"")
	}
	if spec.Duration != "" {
		if d, err := time.ParseDuration(spec.Duration); err != nil || d <= 0 {
			return errors.New("windowSpec.duration must be a positive duration such as \"168h\"")
		}
	}
	if spec.StartTime != "" {
		if _, err := time.Parse(time.RFC3339, spec.StartTime); err != nil {
			return errors.New("windowSpec.startTime must be RFC3339")
		}
	}
	return nil
}

type WindowSpecVersion struct {
	VersionNumber int        `json:"versionNumber"`
	EffectiveFrom string     `json:"effectiveFrom"`
	Spec          WindowSpec `json:"spec"`
}

type TokenResolutionResponse struct {
	TotalTokens int `json:"totalTokens"`
	// Per-item under the spec form ("WholeScope", "Fragment:<id>", …); under
	// the conversation form the prompt's three parts: "System", "Context",
	// "Transcript".
	Breakdown map[string]int `json:"breakdown"`
	// Model is the chat role's default model the estimate was checked against;
	// Limit its prompt budget (0 when the provider reports no window) and Fits
	// whether TotalTokens is within it. The chat guard remains authoritative —
	// a conversation may override the model.
	Model string `json:"model"`
	Limit int    `json:"limit"`
	Fits  bool   `json:"fits"`
}

// TokenResolutionRequest is the body of POST /api/llm/count-tokens: the spec's
// own fields plus an optional window (a reflection's context bar counts only
// what falls inside its target window). With a ConversationID the estimate
// is that chat's whole next turn instead.
type TokenResolutionRequest struct {
	ContextSpec
	Window         *Window `json:"window,omitempty"`
	ConversationID string  `json:"conversationId,omitempty"`
}
