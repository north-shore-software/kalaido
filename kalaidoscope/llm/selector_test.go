package llm

import (
	"net/http"
	"testing"
)

// withWorkspaceConfig sets the process-global workspace config for one test and
// restores it afterwards.
func withWorkspaceConfig(t *testing.T, cfg WorkspaceConfig) {
	t.Helper()
	prev := ActiveWorkspaceConfig()
	SetWorkspaceConfig(cfg)
	t.Cleanup(func() { SetWorkspaceConfig(prev) })
}

func TestResolveRoleFallsBackToModelSetWhenUnconfigured(t *testing.T) {
	withWorkspaceConfig(t, WorkspaceConfig{})

	got, err := ResolveRole(RoleChat)
	if err != nil {
		t.Fatalf("ResolveRole: %v", err)
	}
	want, err := ModelFor(ActiveModelSet(), RoleChat)
	if err != nil {
		t.Fatalf("ModelFor: %v", err)
	}
	if got != want {
		t.Errorf("unconfigured workspace resolved %q, want the model-set value %q", got, want)
	}
}

func TestResolveRolePrefersWorkspaceConfig(t *testing.T) {
	withWorkspaceConfig(t, WorkspaceConfig{
		Provider:     ProviderGemini,
		DefaultModel: "some-free-text-model",
		RoleModels:   map[Role]string{RoleColour: "cheaper-model"},
	})

	// A per-role override wins.
	if got, err := ResolveRole(RoleColour); err != nil || got != "cheaper-model" {
		t.Errorf("RoleColour = (%q, %v), want (\"cheaper-model\", nil)", got, err)
	}
	// Any role without one falls back to the default, including model names the
	// static provider table has never heard of.
	if got, err := ResolveRole(RoleChat); err != nil || got != "some-free-text-model" {
		t.Errorf("RoleChat = (%q, %v), want (\"some-free-text-model\", nil)", got, err)
	}
}

func TestResolveRoleErrorsWhenConfiguredWithNoModel(t *testing.T) {
	withWorkspaceConfig(t, WorkspaceConfig{Provider: ProviderGemini})

	if _, err := ResolveRole(RoleChat); err == nil {
		t.Error("expected an error when a provider is set but no model is")
	}
}

func TestSetWorkspaceConfigCopiesRoleModels(t *testing.T) {
	models := map[Role]string{RoleChat: "original"}
	withWorkspaceConfig(t, WorkspaceConfig{Provider: ProviderGemini, RoleModels: models})

	// Mutating the caller's map must not reach into the stored config.
	models[RoleChat] = "mutated"

	if got := ActiveWorkspaceConfig().ModelForRole(RoleChat); got != "original" {
		t.Errorf("stored config saw caller's mutation: got %q, want %q", got, "original")
	}
}

func TestModelsDedupesAndOrdersDefaultFirst(t *testing.T) {
	cfg := WorkspaceConfig{
		DefaultModel: "default",
		RoleModels: map[Role]string{
			RoleChat:    "default", // duplicate of the default
			RoleColour:  "colour",
			RoleDistill: "", // empty overrides are ignored
		},
	}

	got := cfg.Models()
	want := []string{"default", "colour"}
	if len(got) != len(want) {
		t.Fatalf("Models() = %v, want %v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("Models() = %v, want %v", got, want)
		}
	}
}

func TestClassifyStatus(t *testing.T) {
	cases := map[int]ErrorKind{
		http.StatusUnauthorized:        ErrKindAuth,
		http.StatusForbidden:           ErrKindAuth,
		http.StatusTooManyRequests:     ErrKindQuota,
		http.StatusInternalServerError: ErrKindTransient,
		http.StatusBadGateway:          ErrKindTransient,
		http.StatusBadRequest:          ErrKindOther,
		http.StatusNotFound:            ErrKindOther,
	}
	for status, want := range cases {
		if got := ClassifyStatus(status); got != want {
			t.Errorf("ClassifyStatus(%d) = %q, want %q", status, got, want)
		}
	}
}

func TestRequiresCredential(t *testing.T) {
	if !RequiresCredential(ProviderGemini) {
		t.Error("gemini should require a credential")
	}
	if RequiresCredential(ProviderOllama) {
		t.Error("ollama should not require a credential")
	}
}
