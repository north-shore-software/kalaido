module core

/*
 * Kalaido domain model — shared core (see ../model.md).
 *
 * Holds the vocabulary and the snapshot lifecycle that both synthesized view types
 * share, stated once over the abstract `Target`:
 *              §Core Concept: Staleness Target
 *              §Snapshot States
 *              §Approval Policies
 *              §Active Snapshot Resolution Rule
 *              §Candidate Queue Replacement (Context Updates)
 *
 * model.md defines the Staleness Target as "for a Projection, the entity itself; for
 * a Reflection, an individual window (t)". `Target` is that abstraction, so every
 * lifecycle invariant below is proven once and inherited by both view types.
 *
 * Module note: `open` does not import commands — only the main file's run/check
 * execute. Each module therefore carries its own commands and must be exec'd in turn.
 * Fields cannot be added to an imported sig, which is why all shared mutable state
 * lives on `Target` here rather than being bolted on downstream.
 *
 * Modelling note: fields that an invariant is *about* are declared permissively
 * (`set`, not `lone`) so the invariant is checked rather than assumed by the type.
 */

open util/ordering[Stamp] as stamps

--------------------------------------------------------------------------------
-- Entities
--------------------------------------------------------------------------------

-- Approval sequence numbers, totally ordered.
--
-- History: this was originally model.md's wall-clock "approval timestamp", with no
-- distinctness constraint, because the spec required none. `activeIsUnique` then
-- failed: two snapshots sharing the maximal timestamp are both active. model.md
-- §Approved Snapshot now specifies an approval sequence number, unique and
-- monotonically increasing per Staleness Target, and this sig models that.
sig Stamp {}

sig Snapshot {
  stamp: one Stamp          -- the approval sequence number it carries once approved
}

abstract sig Policy {}
one sig Manual, Automatic extends Policy {}

-- §Core Concept: Staleness Target.
--
-- `policy` sits here rather than on the owning entity purely so the transitions can
-- read it. model.md attaches the Approval Policy to the *entity*, so reflection.als
-- must constrain every Window of a Reflection to agree with its Reflection's policy.
abstract sig Target {
  policy:      one Policy,
  var pending: set Snapshot,   -- Pending Candidates queue
  var history: set Snapshot,   -- Snapshot History (Approved, append-only)
  var log:     set Snapshot    -- Candidate Execution Log (retired)
}

fun occupied: set Snapshot { Target.(pending + history + log) }

fact wellFormed {
  always {
    -- a snapshot belongs to one target and occupies one role at a time
    all disj t, u: Target | no ((t.pending + t.history + t.log)
                              & (u.pending + u.history + u.log))
    all t: Target {
      no t.pending & t.history
      no t.pending & t.log
      no t.history & t.log
    }
  }
}

--------------------------------------------------------------------------------
-- Transitions
--------------------------------------------------------------------------------

pred unchanged [t: Target] {
  t.pending' = t.pending
  t.history' = t.history
  t.log'     = t.log
}

-- The background engine generates a Candidate Snapshot for t.
-- §Candidate Queue Replacement: a new candidate replaces any unapproved candidate
-- already queued, retiring it to the Candidate Execution Log.
-- §Approval Policies: under Automatic Approval candidates are never held in the queue.
pred generate [t: Target, c: Snapshot] {
  c not in occupied                        -- guard: freshly generated
  t.log' = t.log + t.pending
  t.policy = Manual implies {
    t.pending' = c
    t.history' = t.history
  } else {
    no t.pending'
    t.history' = t.history + c
  }
  all u: Target - t | unchanged[u]
}

-- §Approval Policies (Manual Approval): a user promotes the queued candidate.
pred approve [t: Target, c: Snapshot] {
  t.policy = Manual
  c in t.pending
  t.history' = t.history + c
  no t.pending'
  t.log' = t.log
  all u: Target - t | unchanged[u]
}

-- A step in which no target changes. Traces may stutter forever, and that is faithful
-- rather than a modelling convenience: §Engine Execution & Liveness states that nothing
-- inside the system drives it forward, so an unpolled workspace genuinely does stutter
-- indefinitely. Progress must be assumed explicitly wherever a property needs it.
pred stutter { all t: Target | unchanged[t] }

pred init { no Target.(pending + history + log) }

fact traces {
  init
  always (stutter or some t: Target, c: Snapshot | generate[t, c] or approve[t, c])
}

-- §Approved Snapshot: the approval sequence number is "unique and monotonically
-- increasing per Staleness Target". Strict (gt), which also gives uniqueness within
-- a target's history for free.
--
-- This fact is *sourced from the spec*. It was originally gte, and was an assumption
-- introduced here rather than something model.md stated — which is precisely what
-- let the tie through.
fact approvalSequenceIsMonotonic {
  always all t: Target, s: t.history' - t.history, old: t.history |
    stamps/gt[s.stamp, old.stamp]
}

--------------------------------------------------------------------------------
-- Derived state
--------------------------------------------------------------------------------

-- §Active Snapshot Resolution Rule: "active" is derived at query time from the
-- highest approval sequence number, never stored as a mutable flag.
fun active [t: Target]: set Snapshot {
  { s: t.history | no other: t.history | stamps/gt[other.stamp, s.stamp] }
}

--------------------------------------------------------------------------------
-- Consistency gate: these must produce non-empty instances, or every check below
-- passes vacuously and this file is worthless.
--------------------------------------------------------------------------------

run manualFlow {
  some t: Target | t.policy = Manual
  eventually some t: Target | some t.history
  eventually some t: Target | some t.log
} for 4 but 3 Stamp

run automaticFlow {
  some t: Target | t.policy = Automatic
  eventually some t: Target | #t.history > 1
} for 4 but 3 Stamp

--------------------------------------------------------------------------------
-- Invariants
--------------------------------------------------------------------------------

-- 1. §Anatomy & State: "A queue holding at most one unapproved Candidate Snapshot".
assert queueHoldsAtMostOne {
  always all t: Target | lone t.pending
}

-- 1b. §Approval Policies: under Automatic "the queue is therefore always empty".
assert automaticQueueAlwaysEmpty {
  always all t: Target | t.policy = Automatic implies no t.pending
}

-- 2. §Retired Candidate Snapshot: "They cannot be promoted to Approved Snapshots."
assert retirementIsTerminal {
  always all t: Target, s: t.log | always s not in t.history
}

-- 3. §Active Snapshot Resolution Rule: exactly one snapshot is active per target.
--    Failed on the original wall-clock wording; holds against the approval-sequence
--    -number wording.
assert activeIsUnique {
  always all t: Target | some t.history implies one active[t]
}

-- 4. §Active Snapshot Resolution Rule: "snapshot history is an immutable,
--    append-only list of published Approved Snapshots."
assert historyAppendOnly {
  always all t: Target | t.history in t.history'
}

-- Scope note: Alloy ships no native SAT solver for Linux/aarch64, so these run on
-- pure-Java SAT4J. Scope 5 with the default 10 steps does not finish in reasonable
-- time; scope 3 with 8 steps does, and still admits every behaviour these assertions
-- are about (queue replacement needs 2 candidates, a stamp tie needs 2 snapshots
-- sharing 1 stamp). Raise the scope if you want more confidence.
check queueHoldsAtMostOne       for 3 but 1..8 steps
check automaticQueueAlwaysEmpty for 3 but 1..8 steps
check retirementIsTerminal      for 3 but 1..8 steps
check activeIsUnique            for 3 but 1..8 steps
check historyAppendOnly         for 3 but 1..8 steps

-- Regression witness, not verification: asks constructively whether a target can ever
-- have two simultaneously active snapshots. Under the original wall-clock wording
-- this was SAT and was the legible form of the defect (Alloy's CLI renders
-- counterexample field tables as empty markdown). Under the corrected wording it
-- should be UNSAT — i.e. no such state exists.
run tiedActive {
  eventually some t: Target | #active[t] > 1
} for 3 but 1..8 steps
