---- MODULE Grid ----
(***************************************************************************)
(* Kalaido domain model — the relative-mode window grid.                    *)
(*                                                                          *)
(* In scope:    model.md §Window Modes (Relative)                           *)
(*              §Boundary Semantics                                         *)
(*              §Duration vs. Period Relationship                           *)
(*              §Resolved Window → Evaluation Rules (Relative Mode)         *)
(*                                                                          *)
(* Out of scope: versioning and Effective From (slice 3), the clock,        *)
(* materialisation and Window Backfill (slice 4), Absolute mode (one window *)
(* per version, so it has no coverage behaviour to check).                  *)
(*                                                                          *)
(* WHY THIS IS TLA+ AND NOT ALLOY                                           *)
(*                                                                          *)
(* This is the one part of the spec Alloy structurally cannot reach.        *)
(* window.als models grid points as an abstract util/ordering, so it can    *)
(* say "window A ends before window B" but has no arithmetic and therefore  *)
(* nothing to say about coverage. Yet model.md makes four *quantitative*    *)
(* claims about coverage — a partition under Duration = Period, a bound of  *)
(* ceil(Duration/Period) open windows under Duration > Period, gaps under   *)
(* Duration < Period, and first-window truncation — and until now not one   *)
(* of them was checked anywhere. The previous TLA+ draft defined the same   *)
(* arithmetic operators correctly and then asserted nothing about them.     *)
(*                                                                          *)
(* This module has no lifecycle and no behaviour. It is a pure function of  *)
(* its parameters, exercised by a trivial one-step machine (MC_grid.tla)    *)
(* whose Init enumerates the parameter space and whose Next does nothing.   *)
(* That is the ordinary way to use TLC as a bounded checker for arithmetic. *)
(***************************************************************************)
EXTENDS Integers, FiniteSets

CONSTANTS
    StartTimes,   \* candidate grid origins
    Periods,      \* candidate evaluation cadences
    Durations,    \* candidate lookback lengths
    MaxK,         \* highest grid point evaluated
    MaxTime       \* highest fragment Event Date considered

(***************************************************************************)
(* The parameter space must contain all three coverage regimes, or the      *)
(* implications below hold for want of a subject. TLC checks ASSUMEs at     *)
(* startup, which makes this the cheapest possible vacuity gate.            *)
(***************************************************************************)
ASSUME \E p \in Periods, d \in Durations : d > p    \* Overlapping Windows
ASSUME \E p \in Periods, d \in Durations : d = p    \* Contiguous Tumbling Windows
ASSUME \E p \in Periods, d \in Durations : d < p    \* Gapped Windows
ASSUME \A p \in Periods   : p >= 1
ASSUME \A d \in Durations : d >= 1

Specs == [startTime: StartTimes, period: Periods, duration: Durations]
Times == 0..MaxTime

(***************************************************************************)
(* §Grid Evaluation: "Grid points at or before Start Time are not evaluated *)
(* (preventing zero-length windows)." Grid point k sits at                  *)
(* StartTime + k * Period, so k >= 1 is exactly that rule.                  *)
(***************************************************************************)
GridPoints == 1..MaxK

(* §Window Modes: "Grid point k falls at Start Time + k x Period and marks  *)
(* the **end** of window k; the window covers a lookback frame of Duration  *)
(* ending at that grid point."                                              *)
WindowEnd(s, k) == s.startTime + k * s.period

WindowStartRaw(s, k) == WindowEnd(s, k) - s.duration

(* §Boundary Semantics: "First-window truncation: where a relative window's *)
(* computed start would fall before Start Time, the window is truncated to  *)
(* begin at Start Time."                                                    *)
WindowStart(s, k) ==
    IF WindowStartRaw(s, k) < s.startTime THEN s.startTime
                                          ELSE WindowStartRaw(s, k)

(* §Boundary Semantics: "Window boundaries are half-open: a fragment        *)
(* belongs to window w if and only if w.start <= eventDate < w.end."        *)
InWindow(s, k, t) == WindowStart(s, k) <= t /\ t < WindowEnd(s, k)

(* §Evaluation Timestamp & Backdated Fragments: the set of windows a        *)
(* fragment's Event Date falls into. Under Duration > Period this may hold  *)
(* several; under Duration < Period it may be empty.                        *)
CoveringWindows(s, t) == { k \in GridPoints : InWindow(s, k, t) }

CeilDiv(a, b) == (a + b - 1) \div b

(* The span in which every window covering t has an index within GridPoints *)
(* and is untruncated, so a claim about t is about the grid rather than     *)
(* about where this model stopped counting.                                 *)
Interior(s, t) ==
    /\ t - s.startTime >= s.duration
    /\ (t - s.startTime) + s.duration < MaxK * s.period

(* The span the grid actually evaluates: from the origin to the last grid   *)
(* point in scope.                                                          *)
OnGrid(s, t) == t >= s.startTime /\ t < WindowEnd(s, MaxK)

--------------------------------------------------------------------------------
(* PROPERTIES                                                               *)
(*                                                                          *)
(* Each is a claim model.md makes in prose, restated as arithmetic. They    *)
(* are written over a single Window Spec version; §Version Boundaries is    *)
(* explicit that they hold "within a Window Spec version" and that a        *)
(* boundary overlap breaks them, which is slice 3's subject.                *)
(*                                                                          *)
(* All of these passed on the first run, which on its own says nothing —    *)
(* an invariant that cannot fail also passes. So each was mutation-tested:  *)
(* one rule was broken at a time and the run repeated, to establish that    *)
(* the property is load-bearing and to record which error it catches.       *)
(*                                                                          *)
(*   mutation                                    caught by                  *)
(*   ------------------------------------------  ------------------------  *)
(*   boundaries closed instead of half-open      TumblingPartitions         *)
(*   first-window truncation removed             WindowsAreWellFormed       *)
(*   grid point off by one (k-1 for k)           WindowsAreWellFormed       *)
(*   ceil(D/P) weakened to floor(D/P)            OverlapIsBounded           *)
(*   lookback collapsed to length 1              OverlapIsTight             *)
(*   gap boundary off by one (< to <=)           GapsAreExactlyTheStatedOnes*)
(*   first window always anchored at Start Time  OriginIsInAGapWhenGapped   *)
(*                                                                          *)
(* Two properties are not in that table and are labelled GUARD below: they  *)
(* are construction-true here and kept as tripwires, not as findings.       *)
--------------------------------------------------------------------------------

(* CONTENT. §Grid Evaluation: no evaluated grid point yields a zero-length   *)
(* window,                                                                  *)
(* and §Boundary Semantics: truncation never lets a window begin before the *)
(* origin.                                                                  *)
WindowsAreWellFormed(s) ==
    \A k \in GridPoints :
        /\ WindowStart(s, k) >= s.startTime
        /\ WindowStart(s, k) < WindowEnd(s, k)

(* CONTENT. §Duration vs. Period: "Contiguous Tumbling Windows              *)
(* (Duration == Period):                                                    *)
(* Each window covers the exact elapsed interval since the last evaluation  *)
(* ... with no gaps or overlaps", and §Boundary Semantics: half-open        *)
(* boundaries "ensure contiguous tumbling windows never double-count".      *)
(*                                                                          *)
(* Exactly one, not at most one: "no gaps" and "no overlaps" together are a *)
(* partition of the evaluated span, which is the strongest of the three     *)
(* regime claims and the one a boundary error would break first.            *)
TumblingPartitions(s) ==
    s.duration = s.period =>
        \A t \in Times : OnGrid(s, t) => Cardinality(CoveringWindows(s, t)) = 1

(* CONTENT. §Version Boundaries: "up to one Duration under overlapping      *)
(* windows                                                                  *)
(* (Duration > Period), where ceil(Duration / Period) windows are open at   *)
(* once". That expression appears once in model.md and has never been       *)
(* checked. Stated as the bound it claims to be.                            *)
OverlapIsBounded(s) ==
    s.duration > s.period =>
        \A t \in Times :
            OnGrid(s, t) => Cardinality(CoveringWindows(s, t)) <= CeilDiv(s.duration, s.period)

(* CONTENT. The bound above is worthless if nothing attains it — a bound of *)
(* 3 is                                                                     *)
(* also satisfied by a grid that never covers anything twice. Away from the *)
(* ends, the count is pinned between floor and ceil, so the ceiling really  *)
(* is the number of windows open at once rather than a safe over-estimate.  *)
OverlapIsTight(s) ==
    s.duration > s.period =>
        \A t \in Times :
            Interior(s, t) =>
                /\ Cardinality(CoveringWindows(s, t)) >= s.duration \div s.period
                /\ Cardinality(CoveringWindows(s, t)) <= CeilDiv(s.duration, s.period)

(* CONTENT. §Duration vs. Period: "Gapped Windows (Duration < Period):      *)
(* Windows                                                                  *)
(* sample discrete time slices ... leaving un-evaluated gaps between        *)
(* snapshots", and §Staleness Triggers: a fragment landing "in an           *)
(* un-evaluated gap between windows under Duration < Period ... flags        *)
(* nothing".                                                                *)
(*                                                                          *)
(* Not just "some gap exists" but exactly which instants are uncovered: t   *)
(* is missed precisely when it sits in the first (Period - Duration) of its *)
(* cycle. Pinning the set rather than its non-emptiness is what makes this  *)
(* a test of the half-open rule and the truncation rule together.           *)
GapsAreExactlyTheStatedOnes(s) ==
    s.duration < s.period =>
        \A t \in Times :
            OnGrid(s, t) =>
                (CoveringWindows(s, t) = {}
                   <=> (t - s.startTime) % s.period < s.period - s.duration)

(* CONTENT. A consequence worth naming, because it is easy to assume the    *)
(* opposite:                                                                *)
(* first-window truncation never applies under Duration < Period, so the    *)
(* span immediately after Start Time is itself a gap. A fragment whose      *)
(* Event Date is the Reflection's own origin belongs to no window at all.   *)
OriginIsInAGapWhenGapped(s) ==
    s.duration < s.period => CoveringWindows(s, s.startTime) = {}

(* GUARD. §Resolved Window: "re-evaluating any historical window always ... *)
(* yields                                                                   *)
(* the same boundaries." Within a version that reduces to the grid being a  *)
(* function of (spec, k) alone — no dependence on when it is evaluated —    *)
(* which holds by construction here and is restated so slice 3 has          *)
(* something to extend when Effective From makes it substantive.            *)
BoundariesDependOnlyOnK(s) ==
    \A k1, k2 \in GridPoints :
        k1 = k2 => (WindowStart(s, k1) = WindowStart(s, k2)
                    /\ WindowEnd(s, k1) = WindowEnd(s, k2))

(* GUARD. Windows advance monotonically, which is what lets `Last N` order  *)
(* them by                                                                  *)
(* Resolved Window time (§Downstream Last N Resolution).                    *)
GridIsMonotonic(s) ==
    \A k \in 1..(MaxK - 1) : WindowEnd(s, k) < WindowEnd(s, k + 1)

====
