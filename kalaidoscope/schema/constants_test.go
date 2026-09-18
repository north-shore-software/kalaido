package schema

import "testing"

// Every typed collection constant must name a canonical table, and every
// canonical table (views aside) must have a constant.
func TestCollectionConstantsMatchCanonical(t *testing.T) {
	consts := []Collection{
		ColFragment, ColIngest, ColColour, ColColourFragment, ColProjection,
		ColReflection, ColLens, ColProjectionSnapshot, ColReflectionSnapshot,
		ColReflectionWindow, ColProjectionRefinement, ColReflectionRefinement,
		ColChatConversation, ColChatMessage, ColUsage, ColMapRun, ColDiscoverRun,
		ColFragmentAnnotation, ColKalaidoscopeMap, ColLLMQueueStatus,
		ColKalaidoscopeConfig,
	}
	canonical := map[string]bool{}
	for _, def := range Canonical {
		if def.Type == "view" {
			continue
		}
		canonical[def.Name] = true
	}
	have := map[string]bool{}
	for _, c := range consts {
		if !canonical[string(c)] {
			t.Errorf("constant %q names no canonical table", c)
		}
		have[string(c)] = true
	}
	for name := range canonical {
		if !have[name] {
			t.Errorf("canonical table %q has no Collection constant", name)
		}
	}
}
