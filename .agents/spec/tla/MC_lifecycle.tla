---- MODULE MC_lifecycle ----
(***************************************************************************)
(* Invariant model for Lifecycle.tla.                                       *)
(*                                                                          *)
(* Three entities, chosen so no invariant is vacuous:                       *)
(*   P1  Manual     — a Projection, its spec default. Exercises the pending *)
(*                    queue and the two-path approval.                      *)
(*   R1  Manual     — a Reflection with a queue *per window*, which is the  *)
(*                    only configuration in which §Obsolete Candidate       *)
(*                    Retirement has anything to retire on a Reflection.    *)
(*   R2  Automatic  — a Reflection on its spec default, so                  *)
(*                    AutomaticQueueAlwaysEmpty has a subject.              *)
(*                                                                          *)
(* Last run: 38,267,321 states generated, 5,989,776 distinct, depth 19,     *)
(* ~6 min. Raising MaxSnaps or MaxVers costs a lot; check the numbers       *)
(* here before assuming a scope increase is free.                          *)
(*                                                                          *)
(* Vacuity gate — `-coverage` confirms every action fires, so no invariant  *)
(* below passes because its subject never occurs:                           *)
(*     MakeStale 583,616   EditWindowSpec 3,878,383   EditContextSpec 552,746 *)
(*     ApprovePreview 443,220   StartRefinement 139,751   ApproveCandidate 102,386 *)
(*     BackgroundRun 90,746   DiscardPreview 42,330   PreviewTurn 9,685     *)
(* Re-run it with: ./tla.sh check lifecycle  (add -coverage 5 to the java   *)
(* line) whenever an action is added or a guard tightened.                  *)
(***************************************************************************)
EXTENDS Lifecycle

mc_Projections == {"P1"}
mc_Reflections == {"R1", "R2"}
mc_Windows     == {1, 2}

mc_ApprovalPolicy ==
    [e \in {"P1", "R1", "R2"} |->
        CASE e = "P1" -> "Manual"
          [] e = "R1" -> "Manual"
          [] OTHER    -> "Automatic"]

mc_MaxSnaps == 3
mc_MaxVers  == 1

====
