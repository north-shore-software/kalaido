package api

type ColourFilter struct {
	Type   string `json:"type"`
	Prompt string `json:"prompt"`
}

type PreviewColourRequest struct {
	Filter           ColourFilter `json:"filter"`
	PositiveExamples []string     `json:"positiveExamples,omitempty"`
	NegativeExamples []string     `json:"negativeExamples,omitempty"`
}

type CreateColourRequest struct {
	Name               string   `json:"name"`
	Prompt             string   `json:"prompt"`
	ApplyRetroactively bool     `json:"applyRetroactively"`
	FragmentIDs        []string `json:"fragmentIds,omitempty"`
}

type CreateColourResponse struct {
	ColourID string `json:"colourId"`
}

type UpdateColourRequest struct {
	Prompt           *string  `json:"prompt,omitempty"`
	NegativeExamples []string `json:"negativeExamples,omitempty"`
	PositiveExamples []string `json:"positiveExamples,omitempty"`
}

type UpdateColourResponse struct {
	ColourID string `json:"colourId"`
	Prompt   string `json:"prompt"`
}
