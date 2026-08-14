---- MODULE MC_diag_refl ----
(***************************************************************************)
(* Diagram model: the lifecycle of one Reflection window.                   *)
(*                                                                          *)
(* The Staleness Target of a Reflection is an individual window t, not the  *)
(* entity (§Core Concept: Staleness Target), so this is the machine for     *)
(* <<"R1", 1>>. A second window would multiply the concrete state space     *)
(* without adding a node, since the VIEW only reads window 1.               *)
(*                                                                          *)
(* See MC_diag_proj.tla for why no VIEW is used.                            *)
(*                                                                          *)
(* Automatic Approval is used because it is the Reflection default          *)
(* (§Approval Policies). Expect the resulting machine to have **no Pending  *)
(* node**: under Automatic, candidates "are transient and are never held in *)
(* the pending queue". That absence is the diagram reporting a real fact    *)
(* about the spec, not a gap — and `AutomaticQueueAlwaysEmpty` in           *)
(* MC_lifecycle.cfg is the check that it is the policy causing it rather    *)
(* than a broken action. Flip this constant to "Manual" to see the          *)
(* Projection-shaped machine over a window instead.                         *)
(***************************************************************************)
EXTENDS Lifecycle

mc_Projections    == {}
mc_Reflections    == {"R1"}
mc_Windows        == {1}
mc_ApprovalPolicy == [e \in {"R1"} |-> "Automatic"]
mc_MaxSnaps       == 4
mc_MaxVers        == 1

\* No VIEW here. `tla.sh autodiagram` searches the full space and collapses
\* the dump by the `phase` variable afterwards, because TLC's VIEW expands only
\* one representative per class and so emits a subgraph of the true machine.

====
