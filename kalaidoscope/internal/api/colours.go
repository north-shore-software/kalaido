package api

// PreviewColourRequest judges the most recent fragments against a draft
// prompt, with optional manual examples as the few-shot block.
type PreviewColourRequest struct {
	Prompt           string   `json:"prompt"`
	PositiveExamples []string `json:"positiveExamples,omitempty"`
	NegativeExamples []string `json:"negativeExamples,omitempty"`
}

// CreateColourRequest. FragmentIDs are the live-preview matches: they were
// judged by the same prompt, so they are recorded as prompt matches at once
// and the colour is not empty on arrival. Things are not on the wire — only
// discover writes them.
type CreateColourRequest struct {
	Name             string   `json:"name"`
	Prompt           string   `json:"prompt"`
	FragmentIDs      []string `json:"fragmentIds,omitempty"`
	PositiveExamples []string `json:"positiveExamples,omitempty"`
	NegativeExamples []string `json:"negativeExamples,omitempty"`
}

type CreateColourResponse struct {
	ColourID string `json:"colourId"`
}

// UpdateColourRequest. A changed prompt restarts prompt matching for the
// colour. ClearExamples removes manual rows and re-derives those pairs.
type UpdateColourRequest struct {
	Name             *string  `json:"name,omitempty"`
	Prompt           *string  `json:"prompt,omitempty"`
	PositiveExamples []string `json:"positiveExamples,omitempty"`
	NegativeExamples []string `json:"negativeExamples,omitempty"`
	ClearExamples    []string `json:"clearExamples,omitempty"`
}

type UpdateColourResponse struct {
	ColourID string `json:"colourId"`
	Name     string `json:"name"`
	Prompt   string `json:"prompt"`
}
