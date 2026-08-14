---- MODULE MC_grid ----
(***************************************************************************)
(* Checking model for Grid.tla.                                             *)
(*                                                                          *)
(* Grid.tla has no behaviour, so the "state machine" here exists only to    *)
(* give TLC something to enumerate: Init picks one Window Spec parameter    *)
(* triple, Next does nothing, and the properties are checked as invariants  *)
(* over every triple in the space. This is TLC used as a bounded checker    *)
(* for arithmetic rather than as a model checker.                           *)
(*                                                                          *)
(* The parameter space is deliberately awkward: periods and durations that  *)
(* do not divide each other (so ceil and floor differ), a non-zero grid     *)
(* origin (so anything that quietly assumes Start Time = 0 breaks), and     *)
(* durations several times the period (so more than two windows are open at *)
(* once). Grid.tla's ASSUMEs check that all three coverage regimes are      *)
(* present before any implication is read.                                  *)
(*                                                                          *)
(* Last run: 48 distinct states (all of Specs), depth 1, under a second.    *)
(***************************************************************************)
EXTENDS Grid

mc_StartTimes == {0, 3}
mc_Periods    == {1, 2, 3, 5}
mc_Durations  == {1, 2, 3, 4, 5, 7}
mc_MaxK       == 8
mc_MaxTime    == 45

VARIABLE spec

Init == spec \in Specs
Next == UNCHANGED spec

(* The properties of Grid.tla, applied to the spec this state holds. *)
Inv_WindowsAreWellFormed        == WindowsAreWellFormed(spec)
Inv_TumblingPartitions          == TumblingPartitions(spec)
Inv_OverlapIsBounded            == OverlapIsBounded(spec)
Inv_OverlapIsTight              == OverlapIsTight(spec)
Inv_GapsAreExactlyTheStatedOnes == GapsAreExactlyTheStatedOnes(spec)
Inv_OriginIsInAGapWhenGapped    == OriginIsInAGapWhenGapped(spec)
Inv_BoundariesDependOnlyOnK     == BoundariesDependOnlyOnK(spec)
Inv_GridIsMonotonic             == GridIsMonotonic(spec)

====
