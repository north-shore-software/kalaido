package organize

import "sync"

// sharedBudget bounds total explorations across one run (process-wide, not
// per-parent) so a wide/deep real map can't blow the "minutes not hours"
// latency budget. Root pre-counts as exploration 1 (see drain).
type sharedBudget struct {
	mu    sync.Mutex
	used  int
	limit int
}

// remaining reports whether at least one more exploration could be spawned
// right now — used to decide whether to offer the recurse tool at all.
func (b *sharedBudget) remaining() bool {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.used < b.limit
}

// tryReserve atomically claims one exploration slot, or reports false if the
// budget is exhausted. Called once per accepted recurse child.
func (b *sharedBudget) tryReserve() bool {
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.used >= b.limit {
		return false
	}
	b.used++
	return true
}

// release gives back a slot reserved by tryReserve but never actually used —
// e.g. a fork that reserved budget but was then rejected by the registry.
// Without this, a rejected fork would permanently shrink the run's
// exploration budget for no exploration ever performed.
func (b *sharedBudget) release() {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.used--
}

// claim is one story an exploration in this run has taken on: either a fork
// that is still exploring it, or an entity already created for it. Claims are
// what list_existing shows alongside persisted entities, so a sibling fork
// can see a story is spoken for before any entity for it exists.
type claim struct {
	brief  string
	nodes  []NodeRef
	status string // "exploring" | "created"
	kind   string // "" for a fork; "projection"/"reflection" once created
	name   string // entity name once created
	id     string // entity id once created
	forkID int    // the fork this claim belongs to (0 = root); creations record their creator
	// done is closed when the entity's first snapshot has been generated
	// (or generation gave up). A dependent entity that takes this one as a
	// source waits on it, because the context resolver only sees approved
	// snapshots — generating too early would silently drop the source.
	done chan struct{}
}

// runRegistry tracks every claim for the whole run (not just siblings under
// one parent). Dedup is semantic and done by the model via list_existing;
// the only mechanical rejection left is a fork whose contextNodes set is
// identical to one already registered — a runaway guard, not a boundary.
// Several forks reading the same map nodes is expected: cross-cutting
// stories share ground.
type runRegistry struct {
	mu     sync.Mutex
	claims []claim
	nextID int
}

// tryRegisterFork atomically checks the candidate set against every existing
// fork and, if none is identical, registers the fork as exploring. Check and
// register happen under the same lock so two concurrent recurse calls can't
// both slip past each other.
func (r *runRegistry) tryRegisterFork(brief string, nodes []NodeRef) (forkID int, collidesWith *claim) {
	r.mu.Lock()
	defer r.mu.Unlock()
	for i := range r.claims {
		c := &r.claims[i]
		if c.status == "exploring" && sameNodeSet(nodes, c.nodes) {
			return 0, c
		}
	}
	r.nextID++
	r.claims = append(r.claims, claim{brief: brief, nodes: nodes, status: "exploring", forkID: r.nextID})
	return r.nextID, nil
}

// finishFork marks a fork's exploration over, so list_existing stops
// reporting it as in progress (its creations stay listed on their own).
func (r *runRegistry) finishFork(forkID int) {
	r.mu.Lock()
	defer r.mu.Unlock()
	for i := range r.claims {
		if r.claims[i].status == "exploring" && r.claims[i].forkID == forkID {
			r.claims[i].status = "finished"
		}
	}
}

// createdBy lists the entities a given fork created, for the parent's
// recurse result.
func (r *runRegistry) createdBy(forkID int) []claim {
	r.mu.Lock()
	defer r.mu.Unlock()
	var out []claim
	for _, c := range r.claims {
		if c.status == "created" && c.forkID == forkID {
			out = append(out, c)
		}
	}
	return out
}

// registerCreated records an entity the run has created and returns the
// channel generateAndPublish must close when its snapshot exists.
func (r *runRegistry) registerCreated(forkID int, kind, id, name, brief string, nodes []NodeRef) chan struct{} {
	r.mu.Lock()
	defer r.mu.Unlock()
	done := make(chan struct{})
	r.claims = append(r.claims, claim{brief: brief, nodes: nodes, status: "created", kind: kind, name: name, id: id, forkID: forkID, done: done})
	return done
}

// createdDone returns the done channel for an entity this run created, or
// nil if the id is not one of this run's creations (e.g. an entity from an
// earlier run, which already has its snapshot and needs no waiting).
func (r *runRegistry) createdDone(id string) chan struct{} {
	r.mu.Lock()
	defer r.mu.Unlock()
	for i := range r.claims {
		if r.claims[i].status == "created" && r.claims[i].id == id {
			return r.claims[i].done
		}
	}
	return nil
}

// snapshot returns a copy of the claims for rendering outside the lock.
func (r *runRegistry) snapshot() []claim {
	r.mu.Lock()
	defer r.mu.Unlock()
	out := make([]claim, len(r.claims))
	copy(out, r.claims)
	return out
}

// sameNodeSet reports whether a and b contain exactly the same set of nodes,
// ignoring order and duplicates.
func sameNodeSet(a, b []NodeRef) bool {
	as := make(map[NodeRef]bool, len(a))
	for _, n := range a {
		as[n] = true
	}
	bs := make(map[NodeRef]bool, len(b))
	for _, n := range b {
		bs[n] = true
	}
	if len(as) != len(bs) {
		return false
	}
	for n := range as {
		if !bs[n] {
			return false
		}
	}
	return true
}
