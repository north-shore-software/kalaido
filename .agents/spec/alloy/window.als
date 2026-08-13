module window

/*
 * Kalaido domain model — versioned window grid and materialisation (see ../model.md).
 *
 * In scope:    §Window Spec Versions
 *              §Version Boundaries (completes-what-it-started, current-window precedence)
 *              §Materialized Windows
 *              §Resolved Window
 *              §Window Backfill
 *
 * Out of scope for this slice: Duration/Period arithmetic and the coverage modes that
 * depend on it, Last N (reflection.als), Context Spec, fragments.
 *
 * Deliberate abstractions:
 *
 * 1. Time is an ordered set of `GridPoint` atoms, not integers. What materialisation
 *    and precedence depend on is the *order* of boundaries and where "now" sits among
 *    them, which the ordering captures exactly; the arithmetic of
 *    `Start Time + k x Period` would need bounded ints and buy nothing here.
 *
 * 2. A Window carries `startsAt` and `endsAt` — the pair that *is* its Resolved Window
 *    (§Resolved Window: "the exact... start and end timestamps"). Both are static, not
 *    `var`: that immutability is the whole point of versioning, and modelling it as a
 *    structural fact rather than a checked property is honest, because §Window Spec
 *    Edits & Versioning makes it true by construction rather than by rule.
 *
 * 3. Duration and Period are not modelled, so this file cannot check coverage claims
 *    (gaps, tumbling, double-counting). It checks identity, precedence, and
 *    materialisation. The boundary overlap is exhibited by a `run`, not asserted.
 */

open core
open util/ordering[GridPoint] as grid
open util/ordering[Version]   as vers

--------------------------------------------------------------------------------
-- Window Spec versions
--------------------------------------------------------------------------------

sig GridPoint {}

abstract sig Mode {}
one sig Relative, Absolute extends Mode {}

-- §Window Spec Versions: "an append-only, ordered list of Window Spec versions, each
-- carrying an Effective From". `vers` is that append order.
sig Version {
  mode:          one Mode,
  effectiveFrom: one GridPoint
}

-- §Key Parameters: Effective From is "never backdated". Successive versions are
-- therefore appended at non-decreasing times.
--
-- Non-decreasing rather than strictly increasing on purpose: model.md does not
-- forbid two versions sharing an Effective From, and assuming it away would repeat
-- the slice-1 mistake. Precedence below uses append order, which is total regardless.
fact effectiveFromIsNonDecreasing {
  all v: Version | some vers/next[v] implies
    grid/lte[v.effectiveFrom, (vers/next[v]).effectiveFrom]
}

--------------------------------------------------------------------------------
-- Windows
--------------------------------------------------------------------------------

-- §Resolved Window: the (start, end) pair, fixed at generation and never recomputed.
sig Window extends Target {
  version:  one Version,
  startsAt: one GridPoint,
  endsAt:   one GridPoint
}

fact windowsWellFormed {
  all w: Window {
    grid/lt[w.startsAt, w.endsAt]                        -- no zero-length windows
    -- a version starts no window before it is effective
    grid/gte[w.startsAt, w.version.effectiveFrom]
    -- §Version Boundaries: "the outgoing version completes every window it has already
    -- started, and starts no new ones". A window may *end* after its successor takes
    -- effect — that is the overlap — but may not *start* then.
    some vers/next[w.version] implies
      grid/lt[w.startsAt, (vers/next[w.version]).effectiveFrom]
  }
}

-- §Time Series Output: snapshots are "uniquely keyed by Resolved Window", so no two
-- windows may share a (start, end) pair.
fact windowsUniquelyKeyed {
  all disj w1, w2: Window |
    w1.startsAt != w2.startsAt or w1.endsAt != w2.endsAt
}

-- Within a single version, a grid point determines the window: grid point k is the end
-- of window k, whose start is Duration before it (§Window Modes). Two windows of the
-- same version therefore cannot share an end.
--
-- This was missing at first, and `oneCurrentWindow` failed because of it — two
-- same-version windows sharing an end, neither dominating the other. That was an
-- under-constraint here, not a defect in model.md. Across *different* versions windows
-- may still share an end, which is what the precedence rule below exists to resolve.
fact oneWindowPerEndPerVersion {
  all disj w1, w2: Window | w1.version = w2.version implies w1.endsAt != w2.endsAt
}

-- §Window Backfill, unchanged from the pre-versioning model: append-only.
one sig Backfilled { var windows: set Window }

fact backfillIsAppendOnly {
  no Backfilled.windows
  always Backfilled.windows in Backfilled.windows'
}

--------------------------------------------------------------------------------
-- Clock
--------------------------------------------------------------------------------

one sig Clock { var at: one GridPoint }

fact clockOnlyMovesForward {
  always (Clock.at' = Clock.at or grid/gt[Clock.at', Clock.at])
}

-- §Materialized Windows: the bound rests on the first version's Effective From. The
-- Reflection begins observing the grid then; earlier grid points were never current.
fact clockStartsAtFirstVersion {
  Clock.at = vers/first.effectiveFrom
}

--------------------------------------------------------------------------------
-- Derived state
--------------------------------------------------------------------------------

-- Versions whose Effective From has passed.
fun liveVersions: set Version {
  { v: Version | grid/lte[v.effectiveFrom, Clock.at] }
}

fun completedWindows: set Window {
  { w: Window | grid/lte[w.endsAt, Clock.at] and w.version in liveVersions }
}

-- §Materialized Windows + §Version Boundaries → Current-window precedence.
--
-- The most recently completed window across all live versions, with ties on end
-- timestamp resolved to the newer version. Maximum under the lexicographic order
-- (endsAt, version), which is total — so this yields at most one window even while
-- two versions overlap.
fun currentWindow: lone Window {
  { w: completedWindows |
      no u: completedWindows |
        grid/gt[u.endsAt, w.endsAt]
        or (u.endsAt = w.endsAt and vers/gt[u.version, w.version]) }
}

-- §Materialized Windows, with permanence and no exceptions.
pred materialized [w: Window] {
  some w.history
  or w.version.mode = Absolute
  or once (w = currentWindow)
  or w in Backfilled.windows
}

-- §Materialized Windows: "Only materialized windows can be flagged stale...";
-- §Resolution & Engine Behavior: Pending Windows are materialized windows needing
-- snapshot creation.
fact generationRequiresMaterialisation {
  always all w: Window | w.history' != w.history implies materialized[w]
}

--------------------------------------------------------------------------------
-- Consistency gates
--------------------------------------------------------------------------------

run gridAdvances {
  #Window > 1
  eventually grid/gt[Clock.at, grid/first]
  eventually some w: Window | some w.history
} for 3 but 4 GridPoint, 2 Version, 4 Snapshot, 3 Stamp, 1..8 steps

-- Two versions must be able to be live at once, or every precedence claim below is
-- vacuous — this is the situation the whole slice exists for.
run twoVersionsLive {
  #Version = 2
  eventually #liveVersions = 2
} for 3 but 4 GridPoint, 2 Version, 4 Snapshot, 3 Stamp, 1..8 steps

-- §Version Boundaries: the overlap is real. Two windows from different versions
-- covering a common instant. Exhibited rather than asserted — it is a permitted
-- behaviour, not an invariant.
run boundaryOverlapOccurs {
  some disj w1, w2: Window |
    w1.version != w2.version
    and grid/lt[w1.startsAt, w2.endsAt]
    and grid/lt[w2.startsAt, w1.endsAt]
} for 3 but 4 GridPoint, 2 Version, 4 Snapshot, 3 Stamp, 1..8 steps

--------------------------------------------------------------------------------
-- Invariants
--------------------------------------------------------------------------------

-- §Version Boundaries: "the current window is ... where two windows share an end
-- timestamp, the newer version's wins". The spec says "the current window", singular,
-- and it is both the default refinement target and the driver of materialisation.
assert oneCurrentWindow {
  always lone currentWindow
}

-- §Materialized Windows: "Materialisation is permanent, without exception."
assert materializationIsMonotonic {
  always all w: Window | materialized[w] implies always materialized[w]
}

-- §Window Spec Edits & Versioning: an edit never removes a window from the series.
-- With versioning there is no orphaning, so every window that has ever been
-- materialized stays available to the time series for good.
assert noWindowLeavesTheSeries {
  always all w: Window | once materialized[w] implies materialized[w]
}

-- §Materialized Windows: the historical bound, now keyed on the first version.
assert historicalMaterialisationIsBounded {
  always lone { w: Window |
    grid/lte[w.endsAt, vers/first.effectiveFrom]
    and materialized[w]
    and w not in Backfilled.windows }
}

check oneCurrentWindow                   for 3 but 4 GridPoint, 2 Version, 4 Snapshot, 3 Stamp, 1..8 steps
check materializationIsMonotonic         for 3 but 4 GridPoint, 2 Version, 4 Snapshot, 3 Stamp, 1..8 steps
check noWindowLeavesTheSeries            for 3 but 4 GridPoint, 2 Version, 4 Snapshot, 3 Stamp, 1..8 steps
check historicalMaterialisationIsBounded for 3 but 4 GridPoint, 2 Version, 4 Snapshot, 3 Stamp, 1..8 steps
