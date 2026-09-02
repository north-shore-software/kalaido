package engine

import "testing"

func TestLensCountPin(t *testing.T) {
	positives := []string{
		"Ensure all distinct use cases (8 in total) are captured.",
		"Ensure eight in total are captured.",
		"The output must contain a total of 12 entries.",
		"Capture all 9 use cases from the sources.",
		"Produce 8 total sections.",
	}
	for _, lens := range positives {
		if got := LensCountPin(lens); got == "" {
			t.Errorf("LensCountPin(%q) = clean, want a match", lens)
		}
	}

	// Per-item structural counts and count-free selection rules are legitimate
	// and must never trip the lint (they appear in healthy lenses).
	negatives := []string{
		"Include exactly two bullet points under each section.",
		"The description must be between 2 and 4 words long.",
		"Capture every distinct use case found in the source documents.",
		"Provide three nested sub-bullets for rich, fully articulated primary use cases.",
		"Format each persona as a single bullet item.",
	}
	for _, lens := range negatives {
		if got := LensCountPin(lens); got != "" {
			t.Errorf("LensCountPin(%q) = %q, want clean", lens, got)
		}
	}
}
