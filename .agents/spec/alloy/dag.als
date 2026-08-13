module dag

/*
 * Kalaido domain model — Projection→Projection composition and cascading staleness
 * (see ../model.md).
 *
 * In scope:    §Dependency Graph & Cascading Updates
 *              §Composition Rule
 *              §Snapshot-Level Isolation
 *              §Cascading Interaction (Manual Projection over Auto Reflection)
 *              §Deletion & Retention → Projection / Reflection deletion
 *
 * Out of scope: Context Spec fragment resolution (context.als), Last N (reflection.als).
 *
 * Liveness is deliberately absent. "Cascading staleness terminates" is a liveness
 * property, and with a bounded Snapshot scope every trace ends in a lasso where nothing
 * can publish again — so the property is unstatable here rather than false. This is the
 * known weak spot of bounded model finding, and belongs in the TLA+ draft. Everything
 * below is safety.
 */

open projection

--------------------------------------------------------------------------------
-- The dependency graph
--------------------------------------------------------------------------------

-- §Source Projections: "Projections can include output Snapshots from existing
-- Projections as inputs." `p -> q` means q is a source of p, i.e. p consumes q.
-- Mutable, because §Context Tweaking lets users edit a Context Spec over time.
one sig Deps { var srcOf: Projection -> Projection }

-- §Dependency Graph: "Circular references are strictly prohibited... the only cycles
-- structurally possible are Projection → Projection, and these are rejected at
-- spec-edit time." Encoded as a fact because the system enforces it at edit time; what
-- the rejection *buys* is checked below, and its necessity by experiment.
fact acyclic {
  always no p: Projection | p in p.^(Deps.srcOf)
}

-- §Reflection Input Restriction: Reflections are leaf-only, so they never appear as a
-- consumer. In this module Target = Projection, so this holds structurally; it is
-- restated because the claim "the only cycles possible are Projection → Projection"
-- depends on it.

--------------------------------------------------------------------------------
-- Cascading staleness
--------------------------------------------------------------------------------

one sig Stale { var flagged: set Projection }

fact noneStaleInitially { no Stale.flagged }

-- §Cascading Staleness: "When an upstream entity publishes a new Approved Snapshot,
-- staleness propagates downstream... Propagation continues transitively as each
-- affected downstream entity publishes in turn."
--
-- §Snapshot-Level Isolation: "An upstream entity becoming stale does not affect
-- downstream entities until that upstream entity publishes a new Approved Snapshot."
--
-- So propagation is one hop per publication, not a transitive sweep: a consumer is
-- flagged when one of its *direct* sources publishes, and stays flagged until it
-- publishes in turn.
fact cascadeRule {
  always all p: Projection |
    p in Stale.flagged' iff (
      (some q: p.(Deps.srcOf) | q.history' != q.history)
      or (p in Stale.flagged and p.history' = p.history)
    )
}

--------------------------------------------------------------------------------
-- Consistency gates
--------------------------------------------------------------------------------

run graphExists {
  some Deps.srcOf
  eventually some Stale.flagged
} for 3 but 1..6 steps

-- A two-hop chain must be buildable, or every claim about transitivity is vacuous.
run chainOfThree {
  some disj a, b, c: Projection |
    b in a.(Deps.srcOf) and c in b.(Deps.srcOf)
} for 3 but 1..6 steps

-- Staleness must actually be able to reach a second hop.
run twoHopPropagation {
  some disj a, b, c: Projection |
    b in a.(Deps.srcOf) and c in b.(Deps.srcOf)
    and eventually (b in Stale.flagged)
    and eventually (a in Stale.flagged)
} for 3 but 1..6 steps

--------------------------------------------------------------------------------
-- Invariants
--------------------------------------------------------------------------------

-- §Dependency Graph: no synthesis depends on itself, directly or transitively.
assert noCycles {
  always no p: Projection | p in p.^(Deps.srcOf)
}

-- §Cascading Staleness: a publication flags every direct consumer.
assert publicationFlagsConsumers {
  always all p, q: Projection |
    (q in p.(Deps.srcOf) and q.history' != q.history) implies p in Stale.flagged'
}

-- §Snapshot-Level Isolation: "An upstream entity becoming stale does not affect
-- downstream entities until that upstream entity publishes a new Approved Snapshot."
--
-- The load-bearing one. A Manual-Approval Projection in the middle of a chain is a
-- human gate: while it holds a candidate unapproved, nothing downstream of it may be
-- flagged on its account. If this failed, an unapproved intermediate would leak
-- staleness past the gate.
--
-- Note the quantifier. This originally named a single source q and asserted p stayed
-- unflagged if *that* one had not published — which is simply wrong, since a Projection
-- may have several sources and any of the others publishing legitimately flags it. The
-- failure was my assertion, not the spec. Stated correctly: staleness enters only when
-- *some* source publishes.
assert isolationHoldsAtUnpublishedIntermediate {
  always all p: Projection |
    ((no q: p.(Deps.srcOf) | q.history' != q.history) and p not in Stale.flagged)
      implies p not in Stale.flagged'
}

-- §Composition Rule: bindings are to published Approved Snapshots only — never a
-- Preview, an unapproved Candidate, or a retired one. `active` is defined over
-- `history` in core.als, so this confirms the definition rather than discovering
-- anything; it is cheap and it pins the intent to a check.
assert compositionBindsApprovedOnly {
  always all p: Projection |
    no (active[p] & (p.pending + p.log))
}

-- §Cascading Interaction: "The user always sees a single review item representing the
-- latest proposed state, eliminating candidate backlog clutter." Restated over a
-- consumer in a dependency chain, which is the scenario the spec describes.
assert singleReviewItemPerConsumer {
  always all p: Projection | some p.(Deps.srcOf) implies lone p.pending
}

check noCycles                            for 3 but 1..6 steps
check publicationFlagsConsumers           for 3 but 1..6 steps
check isolationHoldsAtUnpublishedIntermediate for 3 but 1..6 steps
check compositionBindsApprovedOnly        for 3 but 1..6 steps
check singleReviewItemPerConsumer         for 3 but 1..6 steps
