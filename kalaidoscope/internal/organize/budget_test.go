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

	first, _ := r.tryRegisterFork("estate dispute", []NodeRef{family, legal, finance})
	if first == 0 {
		t.Fatal("first fork should register")
	}
	// Heavy overlap is fine: a different story through mostly the same ground.
	if id, _ := r.tryRegisterFork("house sale", []NodeRef{family, finance}); id == 0 {
		t.Fatal("subset fork should be accepted — overlap is not a rejection reason any more")
	}
	// Identical set (order/duplicates ignored) is the only mechanical rejection.
	id, with := r.tryRegisterFork("estate dispute again", []NodeRef{finance, legal, family, family})
	if id != 0 {
		t.Fatal("identical set should be rejected")
	}
	if with == nil || with.brief != "estate dispute" {
		t.Fatalf("collision should name the original fork, got %+v", with)
	}
	// A created entity with the same set does not block a fork.
	done := r.registerCreated(first, "projection", "p1", "Estate", "the estate story", []NodeRef{family})
	if id, _ := r.tryRegisterFork("family follow-up", []NodeRef{family}); id == 0 {
		t.Fatal("created claims are not fork collisions")
	}
	// Creations are attributed to their fork and findable by id.
	if got := r.createdBy(first); len(got) != 1 || got[0].id != "p1" {
		t.Fatalf("createdBy(first) = %+v", got)
	}
	if r.createdDone("p1") != done {
		t.Fatal("createdDone should return the creation's done channel")
	}
	if r.createdDone("nope") != nil {
		t.Fatal("unknown id has no done channel")
	}
	// A finished fork is no longer an identical-set collision.
	r.finishFork(first)
	if id, _ := r.tryRegisterFork("estate dispute, take two", []NodeRef{family, legal, finance}); id == 0 {
		t.Fatal("finished forks should not collide")
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
	line := prompts.OrganizeExistingEntity("reflection", "r1", "Standups", "", "team standups", "recurring P1W from 2024-01-01", "human-created")
	for _, want := range []string{`reflection "Standups"`, "[id: r1]", "human-created", "no brief recorded", "[scope: team standups]", "[window: recurring P1W from 2024-01-01]"} {
		if !strings.Contains(line, want) {
			t.Errorf("missing %q in %q", want, line)
		}
	}
	prog := prompts.OrganizeExistingInProgress("the estate dispute", "relationships: family")
	if !strings.Contains(prog, "in progress") || !strings.Contains(prog, "the estate dispute") {
		t.Errorf("bad in-progress line: %q", prog)
	}
	res := prompts.OrganizeForkResult("pricing", []string{prompts.OrganizeForkCreatedLine("projection", "p9", "Pricing model", "State the decision.")})
	if !strings.Contains(res, "[id: p9]") || !strings.Contains(res, "created:") {
		t.Errorf("bad fork result: %q", res)
	}
	if !strings.Contains(prompts.OrganizeForkResult("x", nil), "created nothing") {
		t.Error("empty fork result should say so")
	}
}
