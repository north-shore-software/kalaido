module projection

/*
 * Kalaido domain model — Projections (see ../model.md §Projection).
 *
 * §Core Concept: Staleness Target — "For a Projection, the target is the entity
 * itself." So Projection *is* a Target, and inherits the whole snapshot lifecycle
 * from core.als rather than restating it.
 *
 * This slice adds no Projection-specific content yet (no Context Spec, no source
 * composition, no DAG). Its job is to confirm the module split preserves meaning:
 * the invariants proven over `Target` in core.als must still hold when specialised
 * to Projection, reached purely by inheritance.
 */

open core

sig Projection extends Target {}

--------------------------------------------------------------------------------
-- Consistency gate
--------------------------------------------------------------------------------

-- Projections must actually be populatable, and both policies reachable. Without
-- this every check below would pass for free.
run projectionsExist {
  some Projection
  eventually some p: Projection | some p.history
  eventually some p: Projection | some p.log
} for 4 but 3 Stamp

--------------------------------------------------------------------------------
-- Inherited invariants, specialised to Projection
--------------------------------------------------------------------------------

-- These restate core.als's assertions over Projection rather than Target. They are
-- not independent results: core.als proves them for every Target, and `extends`
-- carries the facts down. They exist to catch a module split that silently fails to
-- apply the parent's constraints to the subtype.

assert projQueueHoldsAtMostOne {
  always all p: Projection | lone p.pending
}

assert projAutomaticQueueAlwaysEmpty {
  always all p: Projection | p.policy = Automatic implies no p.pending
}

assert projRetirementIsTerminal {
  always all p: Projection, s: p.log | always s not in p.history
}

assert projActiveIsUnique {
  always all p: Projection | some p.history implies one active[p]
}

assert projHistoryAppendOnly {
  always all p: Projection | p.history in p.history'
}

check projQueueHoldsAtMostOne        for 3 but 1..8 steps
check projAutomaticQueueAlwaysEmpty  for 3 but 1..8 steps
check projRetirementIsTerminal       for 3 but 1..8 steps
check projActiveIsUnique             for 3 but 1..8 steps
check projHistoryAppendOnly          for 3 but 1..8 steps

run projTiedActive {
  eventually some p: Projection | #active[p] > 1
} for 3 but 1..8 steps
