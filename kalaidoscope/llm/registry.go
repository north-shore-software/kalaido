package llm

import "fmt"

type ModelSet string

const (
	SetLocal ModelSet = "local"
	SetCloud ModelSet = "cloud"
)

type ProviderID string

const (
	ProviderOllama ProviderID = "ollama"
	ProviderGemini ProviderID = "gemini"
)

var modelsBySetRole = map[ModelSet]map[Role]string{
	SetLocal: {
		RoleChat:       "gemma4",
		RoleRefinement: "gemma4",
		RoleColour:     "gemma4",
		RoleDistill:    "gemma4",
		RoleSnapshot:   "gemma4",
	},
	SetCloud: {
		RoleChat:       "gemini-3.6-flash",
		RoleRefinement: "gemini-3.1-pro-preview",
		RoleColour:     "gemini-3.5-flash-lite",
		RoleDistill:    "gemini-3.1-pro-preview",
		RoleSnapshot:   "gemini-3.1-pro-preview",
	},
}

var providerByModel = map[string]ProviderID{
	"gemma4":                 ProviderOllama,
	"gemini-3.5-flash":       ProviderGemini,
	"gemini-3.5-flash-lite":  ProviderGemini,
	"gemini-3.6-flash":       ProviderGemini,
	"gemini-3.1-pro-preview": ProviderGemini,
}

var credentialEnv = map[ProviderID]string{
	ProviderOllama: "",
	ProviderGemini: "GEMINI_API_KEY",
}

func ParseModelSet(s string) (ModelSet, error) {
	switch ModelSet(s) {
	case SetLocal:
		return SetLocal, nil
	case SetCloud:
		return SetCloud, nil
	default:
		return "", fmt.Errorf("llm: unknown model set %q (want %q or %q)", s, SetLocal, SetCloud)
	}
}

func ModelFor(s ModelSet, r Role) (string, error) {
	roles, ok := modelsBySetRole[s]
	if !ok {
		return "", fmt.Errorf("llm: unknown model set %q", s)
	}
	name, ok := roles[r]
	if !ok {
		return "", fmt.Errorf("llm: model set %q has no model for role %q", s, r)
	}
	return name, nil
}

func ProviderFor(model string) (ProviderID, error) {
	p, ok := providerByModel[model]
	if !ok {
		return "", fmt.Errorf("llm: no provider registered for model %q", model)
	}
	return p, nil
}

func CredentialEnv(p ProviderID) string {
	return credentialEnv[p]
}

// RequiresCredential reports whether a provider authenticates with a key the
// user supplies. Backed by the same table as CredentialEnv so registering a new
// provider stays a one-place change. Providers without one (Ollama, a local
// service) are never key-validated.
func RequiresCredential(p ProviderID) bool {
	return credentialEnv[p] != ""
}

func Roles() []Role {
	return []Role{RoleChat, RoleRefinement, RoleColour, RoleDistill, RoleSnapshot}
}
