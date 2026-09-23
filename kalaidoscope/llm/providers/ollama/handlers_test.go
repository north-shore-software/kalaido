package ollama

import (
	"testing"

	"github.com/north-shore-software/kalaido/kalaidoscope/llm"
)

func TestDescriptor(t *testing.T) {
	if Descriptor.ID != llm.ProviderOllama {
		t.Errorf("Descriptor.ID = %q, want %q", Descriptor.ID, llm.ProviderOllama)
	}
	if Descriptor.RequiresKey {
		t.Error("Descriptor.RequiresKey should be false")
	}
	if Descriptor.CredentialEnv != "" {
		t.Errorf("Descriptor.CredentialEnv = %q, want empty", Descriptor.CredentialEnv)
	}
	p := Descriptor.New("gemma4", "")
	op, ok := p.(*OllamaProvider)
	if !ok {
		t.Fatalf("Descriptor.New did not return *OllamaProvider: %T", p)
	}
	if op.Model != "gemma4" {
		t.Errorf("op.Model = %q, want gemma4", op.Model)
	}
}
