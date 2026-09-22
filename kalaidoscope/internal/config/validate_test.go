package config

import (
	"testing"

	"github.com/north-shore-software/kalaido/kalaidoscope/llm"
)

func TestModelsNeedingValidation(t *testing.T) {
	base := llm.WorkspaceConfig{
		Provider:     llm.ProviderGemini,
		APIKey:       "key-1",
		DefaultModel: "model-a",
	}

	t.Run("no change needs no calls", func(t *testing.T) {
		if got := ModelsNeedingValidation(base, base); len(got) != 0 {
			t.Errorf("got %v, want none", got)
		}
	})

	t.Run("rotating the key revalidates everything", func(t *testing.T) {
		next := base
		next.APIKey = "key-2"
		next.RoleModels = map[llm.Role]string{llm.RoleColour: "model-b"}

		got := ModelsNeedingValidation(base, next)
		if len(got) != 2 {
			t.Fatalf("got %v, want both models revalidated", got)
		}
	})

	t.Run("changing the provider revalidates everything", func(t *testing.T) {
		next := base
		next.Provider = llm.ProviderOllama

		if got := ModelsNeedingValidation(base, next); len(got) != 1 {
			t.Errorf("got %v, want the model revalidated", got)
		}
	})

	t.Run("only newly referenced models are tested", func(t *testing.T) {
		next := base
		next.RoleModels = map[llm.Role]string{llm.RoleColour: "model-new"}

		got := ModelsNeedingValidation(base, next)
		if len(got) != 1 || got[0] != "model-new" {
			t.Errorf("got %v, want just [model-new] — the unchanged default costs nothing", got)
		}
	})
}
