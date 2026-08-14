module reflection

/*
 * Kalaido domain model — Last N resolution and upstream staleness (see ../model.md).
 *
 * In scope:    §Source Reflections (`Last N` Rule)
 *              §Source Reflection Resolution (`Last N` Rule)
 *              §Downstream `Last N` Resolution
 *              §Staleness Triggers → Upstream Synthesis Approval
 *
 * Out of scope: Context Spec fragment resolution, the Projection→Projection DAG,
 * Window Spec versioning (window.als), Lens lineage.
 *
 * Inherits window.als: one Reflection, whose Window Spec may have several versions.
 * Nothing below depends on there being more than one Reflection, and generalising to
 * many would only add indexing noise to every expression.
 *
 * Module note: `Projection` gains no new field here — Alloy forbids adding fields to
 * an imported sig — so the consumption relation is its own sig instead. And `as`
 * aliases are file-local: window.als's `grid` alias does not arrive through `open`,
 * so the ordering is re-opened below under the same name.
 */

open projection
open window
open util/ordering[GridPoint] as grid

--------------------------------------------------------------------------------
-- Consumption
--------------------------------------------------------------------------------

-- §Source Reflections: a Projection consuming the Reflection with a count parameter N.
one sig SourceReflection {
  consumer: one Projection,
  n:        one Int
}

fact nIsPositive { SourceReflection.n >= 1 and SourceReflection.n <= 3 }

--------------------------------------------------------------------------------
-- Last N resolution
--------------------------------------------------------------------------------

fun materializedWindows: set Window { { w: Window | materialized[w] } }

-- §Downstream `Last N` Resolution: "up to the N most recent materialized windows...
-- ordered by Resolved Window time", with N clamped to the materialized window count.
-- A window is in the set when at most N materialized windows end at or after it,
-- which yields the clamping behaviour without a separate min().
fun lastNSet [k: Int]: set Window {
  { w: materializedWindows |
      #{ v: materializedWindows | grid/gte[v.endsAt, w.endsAt] } <= k }
}

-- The snapshots the consuming Projection actually resolves to: the *active* snapshot
-- of each window in the N-set (per-window max approval sequence, from core.als).
fun resolved [sr: SourceReflection]: set Snapshot {
  { s: Snapshot | some w: lastNSet[sr.n] | s in active[w] }
}

--------------------------------------------------------------------------------
-- The staleness trigger, transcribed as written
--------------------------------------------------------------------------------

-- §Staleness Triggers → Upstream Synthesis Approval: "For a Source Reflection, the
-- downstream Projection is flagged only if the new snapshot enters that Projection's
-- Last N set: i.e. it is published for a **newer** window, or it supersedes the
-- active snapshot of a window **already inside** the N-set."
--
-- History: clause 2 originally read "supersedes the active snapshot of a window
-- already inside the N-set", transcribed literally as requiring an active snapshot to
-- exist and be displaced (`... and some active[w]`). A window inside the N-set
-- receiving its *first* snapshot escaped it. model.md now says "published for a
-- window already inside the N-set — whether or not it displaces an existing active
-- snapshot", modelled below.
--
-- Evaluated against the pre-state: these are the conditions as they stand when the
-- upstream event happens.
pred triggerFires [sr: SourceReflection] {
  -- §Upstream Synthesis Approval
  (some w: Window | w.history' != w.history and (
    -- published for a newer window than anything currently in the N-set
    (no v: lastNSet[sr.n] | grid/gte[v.endsAt, w.endsAt])
    or
    -- published for a window already inside the N-set
    w in lastNSet[sr.n]
  ))
  or
  -- §Upstream Window Materialisation. The N-set is rolling, so a window materializing
  -- upstream (by temporal advancement or Window Backfill) displaces the oldest member
  -- and changes the downstream Resolved Context with no publication anywhere.
  --
  -- How load-bearing this clause is depends on the Reflection's Approval Policy, and
  -- the two checks at the foot of this file pin that down: under Automatic Approval
  -- with a live engine the approval clause alone eventually suffices, so this is only
  -- a tightening; under Manual Approval it is the only thing that flags the consumer.
  (lastNSet[sr.n] != (lastNSet[sr.n])')
}

--------------------------------------------------------------------------------
-- Consistency gates
--------------------------------------------------------------------------------

run consumptionWorks {
  some v: Version | v.mode = Relative
  eventually some resolved[SourceReflection]
} for 3 but 4 GridPoint, 4 Snapshot, 3 Stamp, 1..8 steps

-- The N-set must actually be able to change, or the assertion below is vacuous.
run nSetCanChange {
  some v: Version | v.mode = Relative
  eventually lastNSet[SourceReflection.n] != (lastNSet[SourceReflection.n])'
} for 3 but 4 GridPoint, 4 Snapshot, 3 Stamp, 1..8 steps

-- Backfill must be reachable, since it is the operation the defect turns on.
run backfillHappens {
  some v: Version | v.mode = Relative
  eventually some Backfilled.windows
} for 3 but 4 GridPoint, 4 Snapshot, 3 Stamp, 1..8 steps

--------------------------------------------------------------------------------
-- Invariants
--------------------------------------------------------------------------------

-- §Downstream `Last N` Resolution: N is "clamped to the materialized window count",
-- so the resolved set never exceeds N windows and never includes an un-materialized one.
assert lastNRespectsClamp {
  always (#lastNSet[SourceReflection.n] <= SourceReflection.n
          and lastNSet[SourceReflection.n] in materializedWindows)
}

-- The load-bearing question of this slice.
--
-- The consuming Projection's Resolved Context is built from `resolved`. If that set
-- can change without the Upstream Synthesis Approval trigger firing, the Projection
-- silently serves a stale synthesis: its inputs changed and nothing flagged it.
assert resolvedChangeAlwaysFlags {
  always all sr: SourceReflection |
    (resolved[sr])' != resolved[sr] implies triggerFires[sr]
}

check lastNRespectsClamp        for 3 but 4 GridPoint, 4 Snapshot, 3 Stamp, 1..8 steps
check resolvedChangeAlwaysFlags for 3 but 4 GridPoint, 4 Snapshot, 3 Stamp, 1..8 steps

--------------------------------------------------------------------------------
-- When is the Upstream Window Materialisation clause actually needed?
--------------------------------------------------------------------------------

-- The approval-conditioned clause on its own, without the materialisation clause.
pred approvalClauseOnly [sr: SourceReflection] {
  some w: Window | w.history' != w.history and (
    (no v: lastNSet[sr.n] | grid/gte[v.endsAt, w.endsAt]) or w in lastNSet[sr.n])
}

-- The engine eventually runs: any materialized window lacking a snapshot gets one.
--
-- §Engine Execution & Liveness is explicit that this is *not* guaranteed by the model
-- — nothing self-starts, and an unpolled workspace never progresses. Liveness comes
-- from an external driver, so it belongs here as an assumption to reason under, never
-- as a fact. core.als permits unbounded lag accordingly (`stutter` lets the clock
-- advance with nothing generated), which is faithful rather than a convenience.
--
-- Any liveness-flavoured property must therefore name this explicitly or it fails by
-- default, against a trace where the driver simply never runs.
pred engineIsLive {
  always (all w: Window | materialized[w] implies eventually some w.history)
}

-- Under Automatic Approval with a live engine, the approval clause alone eventually
-- covers every change of resolved context — so the materialisation clause is a
-- tightening (immediate rather than eventual flagging), not a correctness requirement.
assert approvalAloneSufficesUnderAutomatic {
  (engineIsLive and (all w: Window | w.policy = Automatic)) implies
    (always all sr: SourceReflection |
      (resolved[sr])' != resolved[sr] implies eventually approvalClauseOnly[sr])
}

-- Gate: that world must be reachable, or the assertion above holds for free.
run automaticAndLive {
  engineIsLive
  all w: Window | w.policy = Automatic
} for 3 but 4 GridPoint, 4 Snapshot, 3 Stamp, 1..8 steps

-- Under Manual Approval the candidate may never be approved, so no publication ever
-- occurs and the approval clause alone leaves the change unflagged. Expected SAT —
-- this is the witness that the materialisation clause earns its place.
run manualEscapesApprovalClause {
  all w: Window | w.policy = Manual
  eventually (some sr: SourceReflection |
    (resolved[sr])' != resolved[sr] and always not approvalClauseOnly[sr])
} for 3 but 4 GridPoint, 4 Snapshot, 3 Stamp, 1..8 steps

check approvalAloneSufficesUnderAutomatic for 3 but 4 GridPoint, 4 Snapshot, 3 Stamp, 1..8 steps

-- Constructive witness: the resolved context changing while no trigger clause fires.
run silentContextChange {
  some v: Version | v.mode = Relative
  eventually ((resolved[SourceReflection])' != resolved[SourceReflection]
              and not triggerFires[SourceReflection])
} for 3 but 4 GridPoint, 4 Snapshot, 3 Stamp, 1..8 steps
