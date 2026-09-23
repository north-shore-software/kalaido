package gemini

import "encoding/json"

type geminiContent struct {
	Role  string       `json:"role,omitempty"`
	Parts []geminiPart `json:"parts"`
}

type geminiFunctionCall struct {
	Name string          `json:"name"`
	Args json.RawMessage `json:"args"`
}

type geminiPart struct {
	Text         string              `json:"text,omitempty"`
	FunctionCall *geminiFunctionCall `json:"functionCall,omitempty"`
}

type geminiFunctionDeclaration struct {
	Name        string          `json:"name"`
	Description string          `json:"description"`
	Parameters  json.RawMessage `json:"parameters"`
}

type geminiTool struct {
	FunctionDeclarations []geminiFunctionDeclaration `json:"functionDeclarations"`
}

type geminiGenerationConfig struct {
	Temperature *float64 `json:"temperature,omitempty"`
}

type geminiRequest struct {
	Contents          []geminiContent         `json:"contents"`
	SystemInstruction *geminiContent          `json:"systemInstruction,omitempty"`
	Tools             []geminiTool            `json:"tools,omitempty"`
	GenerationConfig  *geminiGenerationConfig `json:"generationConfig,omitempty"`
	ServiceTier       string                  `json:"service_tier,omitempty"`
}

type geminiCandidate struct {
	Content struct {
		Parts []geminiPart `json:"parts"`
	} `json:"content"`
	// FinishReason arrives on the last chunk of a candidate. Anything but
	// STOP (MALFORMED_FUNCTION_CALL, SAFETY, MAX_TOKENS, RECITATION, ...)
	// is the only explanation an otherwise empty stream carries.
	FinishReason  string `json:"finishReason"`
	FinishMessage string `json:"finishMessage"`
}

// PromptFeedback is set instead of candidates when the prompt itself was
// blocked; the stream then ends without a single content part.
type geminiPromptFeedback struct {
	BlockReason        string `json:"blockReason"`
	BlockReasonMessage string `json:"blockReasonMessage"`
}

type geminiUsageMetadata struct {
	PromptTokenCount        int    `json:"promptTokenCount"`
	CandidatesTokenCount    int    `json:"candidatesTokenCount"`
	TotalTokenCount         int    `json:"totalTokenCount"`
	CachedContentTokenCount int    `json:"cachedContentTokenCount"`
	TrafficType             string `json:"trafficType"`
}

type geminiStreamChunk struct {
	Candidates     []geminiCandidate     `json:"candidates"`
	PromptFeedback *geminiPromptFeedback `json:"promptFeedback"`
	UsageMetadata  *geminiUsageMetadata  `json:"usageMetadata"`
}
