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
// e.g. a fork that reserved budget but was then rejected by the context
// registry for overlap. Without this, a rejected fork would permanently
// shrink the run's exploration budget for no exploration ever performed.
func (b *sharedBudget) release() {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.used--
}

// contextRegistry tracks every fork's contextNodes set for the whole run (not
// just siblings under one parent), so a new fork can be rejected for
// overlapping too much with ground another fork — in progress or already
// finished — already claimed.
type contextRegistry struct {
	mu   sync.Mutex
	sets [][]NodeRef
}

// overlapThreshold: a candidate set sharing this fraction or more of its own
// nodes with an existing set is rejected as near-duplicate exploration.
const overlapThreshold = 0.5

// tryRegister atomically checks the candidate against every existing set and,
// if none collides, registers it. Check-and-register happen under the same
// lock so two concurrent recurse calls can't both slip past each other.
func (r *contextRegistry) tryRegister(candidate []NodeRef) (ok bool, collidesWith []NodeRef) {
	r.mu.Lock()
	defer r.mu.Unlock()
	for _, existing := range r.sets {
		if overlapRatio(candidate, existing) >= overlapThreshold {
			return false, existing
		}
	}
	r.sets = append(r.sets, candidate)
	return true, nil
}

// overlapRatio is the fraction of candidate's own nodes that already appear
// in existing.
func overlapRatio(candidate, existing []NodeRef) float64 {
	if len(candidate) == 0 {
		return 0
	}
	existingSet := make(map[NodeRef]bool, len(existing))
	for _, n := range existing {
		existingSet[n] = true
	}
	shared := 0
	for _, n := range candidate {
		if existingSet[n] {
			shared++
		}
	}
	return float64(shared) / float64(len(candidate))
}
