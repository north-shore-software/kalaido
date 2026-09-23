package api

// ValidateProviderRequest tests a candidate provider configuration without
// storing it, so the setup flow can try a key and model before saving
// anything.
type ValidateProviderRequest struct {
	Provider     string            `json:"provider"`
	APIKey       string            `json:"apiKey"`
	DefaultModel string            `json:"defaultModel"`
	RoleModels   map[string]string `json:"roleModels,omitempty"`
}

// ValidateProviderResponse reports the outcome of that test. A failed check is
// still a successful request, so this comes back with 200 and OK false; Kind
// distinguishes a wrong key from a provider that is merely unreachable.
type ValidateProviderResponse struct {
	OK       bool   `json:"ok"`
	Kind     string `json:"kind,omitempty"`
	Provider string `json:"provider,omitempty"`
	Model    string `json:"model,omitempty"`
	Detail   string `json:"detail,omitempty"`
}

type ModelInfo struct {
	Name string `json:"name"`
	Size int64  `json:"size"`
}

type OllamaStatusResponse struct {
	Reachable bool        `json:"reachable"`
	Models    []ModelInfo `json:"models"`
	Error     string      `json:"error,omitempty"`
}

type OllamaPullRequest struct {
	Model string `json:"model"`
}

type ModelPreflightRole struct {
	Role     string `json:"role"`
	Model    string `json:"model,omitempty"`
	Provider string `json:"provider,omitempty"`
	OK       bool   `json:"ok"`
	Detail   string `json:"detail,omitempty"`
}

type ModelPreflightResponse struct {
	ModelSet string               `json:"modelSet"`
	OK       bool                 `json:"ok"`
	Roles    []ModelPreflightRole `json:"roles"`
}
