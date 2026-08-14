package api

// ValidateProviderRequest tests a candidate provider configuration without
// storing it. The create flow needs this because the first config write fixes
// the provider permanently — the user has to be able to try a key first.
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
