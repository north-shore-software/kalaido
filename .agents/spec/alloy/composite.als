module composite

/*
 * Kalaido domain model — a Projection with all three input kinds at once
 * (see ../model.md §Source Composition & Nesting, §Scoping Modes).
 *
 * Every other module checks one input kind in isolation:
 *   context.als    fragment-level criteria
 *   dag.als        Source Projections
 *   reflection.als Source Reflections and Last N
 *
 * Nothing checks a Projection whose `Resolved Context` is built from all three at once,
 * which is the only configuration where two rules in model.md actually meet:
 *
 *  - §Scoping Modes carves out an exception: Whole Scope "suppresses all fragment-level
 *    Filter Criteria... but explicit Source Composition inputs may still be attached".
 *    That sentence is meaningless unless a Projection has both kinds of input.
 *  - §Upstream Synthesis Approval gives Source Projections and Source Reflections
 *    *different* trigger rules — unconditional for the former, conditional for the
 *    latter — and §Staleness Triggers gives fragments a third set. All three feed one
 *    Resolved Context, and nothing has checked that their union covers a change to the
 *    union.
 *
 * Cost note: this opens both halves of the model, so context.als's world meets core's
 * snapshot lifecycle in one state space. Scopes are deliberately tiny; on a box with no
 * native SAT solver anything larger does not finish.
 */

open context
open reflection
open util/ordering[GridPoint] as grid

--------------------------------------------------------------------------------
-- The composite consumer
--------------------------------------------------------------------------------

-- The consuming Projection is `SourceReflection.consumer`, inherited from
-- reflection.als. Here it also gains a fragment-level Context Spec and a Source
-- Projection.
one sig Composite {
  spec:    one ContextSpec,
  srcProj: one Projection
}

-- A Projection may not be its own source (§Dependency Graph). dag.als proves the
-- general acyclicity property; this is the one-edge instance of it.
fact sourceIsNotTheConsumer {
  Composite.srcProj != SourceReflection.consumer
}

--------------------------------------------------------------------------------
-- The combined Resolved Context
--------------------------------------------------------------------------------

-- §Resolution & Staleness Lifecycle: a Resolved Context is "a static, reproducible
-- list of resolved Fragment IDs and source Snapshot IDs" — two parts, modelled apart
-- because they are different types.

fun resolvedFragments: set Fragment { resolves[Composite.spec] }

-- §Source Projection Resolution: "locks to the single active (latest-approved)
-- Snapshot ID at generation time."
-- §Source Reflection Resolution: the Last N active snapshots (reflection.als).
--
-- Note what is absent: no dependence on `Composite.spec.mode`. That is §Scoping Modes'
-- carve-out encoded — Whole Scope suppresses fragment-level criteria and leaves source
-- composition untouched.
fun resolvedSnapshots: set Snapshot {
  active[Composite.srcProj] + resolved[SourceReflection]
}

--------------------------------------------------------------------------------
-- The combined trigger
--------------------------------------------------------------------------------

-- The union of the three rule sets, each transcribed in its own module:
--   contextTriggerFires  fragment-level (context.als)
--   triggerFires         Source Reflection (reflection.als)
--   plus §Upstream Synthesis Approval for a Source Projection: "any new Approved
--   Snapshot changes the active snapshot and therefore always flags the downstream
--   Projection" — unconditional, unlike the Reflection case.
pred compositeTriggerFires {
  contextTriggerFires[Composite.spec]
  or triggerFires[SourceReflection]
  or (Composite.srcProj.history' != Composite.srcProj.history)
}

--------------------------------------------------------------------------------
-- Consistency gates
--------------------------------------------------------------------------------

run compositeExists {
  eventually (some resolvedFragments and some resolvedSnapshots)
} for 2 but 2 Projection, 2 Window, 3 GridPoint, 2 Version, 4 Snapshot, 4 Stamp, 1..5 steps

-- Both parts must be able to change, or the coverage check below is half vacuous.
run fragmentsCanChange {
  eventually (resolvedFragments' != resolvedFragments)
} for 2 but 2 Projection, 2 Window, 3 GridPoint, 2 Version, 4 Snapshot, 4 Stamp, 1..5 steps

run snapshotsCanChange {
  eventually (resolvedSnapshots' != resolvedSnapshots)
} for 2 but 2 Projection, 2 Window, 3 GridPoint, 2 Version, 4 Snapshot, 4 Stamp, 1..5 steps

-- Gate specifically for the Source Reflection half, because it silently vanished once.
-- `Target` scope has to cover Projections *and* Windows; with two Projections and a
-- Target scope of 2 there were no Windows at all, so `resolved[SourceReflection]` was
-- permanently empty and every Reflection-related result here was vacuous — including a
-- "the Source Reflection trigger clause is redundant" result that was pure artifact.
-- Projection and Window are now scoped separately. If this goes UNSAT, that has undone
-- itself again.
run reflectionPartCanChange {
  some Window
  eventually ((resolved[SourceReflection])' != resolved[SourceReflection])
} for 2 but 2 Projection, 2 Window, 3 GridPoint, 2 Version, 4 Snapshot, 4 Stamp, 1..5 steps

-- The configuration §Scoping Modes' carve-out is about: Whole Scope *and* attached
-- source composition.
run wholeScopeWithSources {
  eventually (Composite.spec.mode = WholeScope and some resolvedSnapshots)
} for 2 but 2 Projection, 2 Window, 3 GridPoint, 2 Version, 4 Snapshot, 4 Stamp, 1..5 steps

--------------------------------------------------------------------------------
-- Invariants
--------------------------------------------------------------------------------

-- §Scoping Modes: Whole Scope suppresses fragment-level criteria but leaves Source
-- Composition attached.
--
-- Construction-true, and labelled as such: `resolvedSnapshots` is defined without
-- reference to the mode, so this confirms the encoding rather than discovering
-- anything. It earns its place as a regression guard — if someone later folds mode
-- handling into snapshot resolution, this catches it.
assert wholeScopeKeepsSourceComposition {
  always (Composite.spec.mode = WholeScope implies
            (active[Composite.srcProj] + resolved[SourceReflection]) in resolvedSnapshots)
}

-- §Composition Rule: bindings are to Approved Snapshots only, never a queued candidate
-- or a retired one — including when fragment-level inputs are present alongside.
assert compositeBindsApprovedOnly {
  always no (resolvedSnapshots
             & (Composite.srcProj.pending + Composite.srcProj.log))
}

-- The load-bearing one. Each of the three rule sets is checked in its own module over
-- its own slice of the context. This asks whether their union covers a change to the
-- union — the question that only exists once all three feed one Projection.
assert compositeChangeAlwaysFlags {
  always ((resolvedFragments' != resolvedFragments
           or resolvedSnapshots' != resolvedSnapshots)
          implies compositeTriggerFires)
}

check wholeScopeKeepsSourceComposition for 2 but 2 Projection, 2 Window, 3 GridPoint, 2 Version, 4 Snapshot, 4 Stamp, 1..5 steps
check compositeBindsApprovedOnly       for 2 but 2 Projection, 2 Window, 3 GridPoint, 2 Version, 4 Snapshot, 4 Stamp, 1..5 steps
check compositeChangeAlwaysFlags       for 2 but 2 Projection, 2 Window, 3 GridPoint, 2 Version, 4 Snapshot, 4 Stamp, 1..5 steps
