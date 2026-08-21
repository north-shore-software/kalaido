package organize

import (
	"strings"
	"testing"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/prompts"
)

func TestRunRegistryRejectsOnlyIdenticalSets(t *testing.T) {
	r := &runRegistry{}
	family := NodeRef{"relationships", "family"}
	legal := NodeRef{"activity", "legal"}
	finance := NodeRef{"activity", "finance"}

	if ok, _ := r.tryRegisterFork("estate dispute", []NodeRef{family, legal, finance}); !ok {
		t.Fatal("first fork should register")
	}
	// Heavy overlap is fine: a different story through mostly the same ground.
	if ok, _ := r.tryRegisterFork("house sale", []NodeRef{family, finance}); !ok {
		t.Fatal("subset fork should be accepted — overlap is not a rejection reason any more")
	}
	// Identical set (order/duplicates ignored) is the only mechanical rejection.
	ok, with := r.tryRegisterFork("estate dispute again", []NodeRef{finance, legal, family, family})
	if ok {
		t.Fatal("identical set should be rejected")
	}
	if with == nil || with.brief != "estate dispute" {
		t.Fatalf("collision should name the original fork, got %+v", with)
	}
	// A created entity with the same set does not block a fork.
	r.registerCreated("projection", "Estate", "the estate story", []NodeRef{family})
	if ok, _ := r.tryRegisterFork("family follow-up", []NodeRef{family}); !ok {
		t.Fatal("created claims are not fork collisions")
	}
}

func TestSharedBudgetReleaseAfterReject(t *testing.T) {
	b := &sharedBudget{used: 1, limit: 2}
	if !b.tryReserve() {
		t.Fatal("should reserve")
	}
	if b.remaining() {
		t.Fatal("should be exhausted")
	}
	b.release()
	if !b.remaining() {
		t.Fatal("release should restore the slot")
	}
}

func TestExistingPromptRendering(t *testing.T) {
	line := prompts.OrganizeExistingEntity("reflection", "Standups", "", "team standups", "recurring P1W from 2024-01-01", "human-created")
	for _, want := range []string{`reflection "Standups"`, "human-created", "no brief recorded", "[scope: team standups]", "[window: recurring P1W from 2024-01-01]"} {
		if !strings.Contains(line, want) {
			t.Errorf("missing %q in %q", want, line)
		}
	}
	prog := prompts.OrganizeExistingInProgress("the estate dispute", "relationships: family")
	if !strings.Contains(prog, "in progress") || !strings.Contains(prog, "the estate dispute") {
		t.Errorf("bad in-progress line: %q", prog)
	}
}
