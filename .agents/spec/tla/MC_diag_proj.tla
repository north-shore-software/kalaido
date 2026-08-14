---- MODULE MC_diag_proj ----
(***************************************************************************)
(* Diagram model: the lifecycle of a Projection.                            *)
(*                                                                          *)
(* One Manual-Approval Projection — the spec default (§Approval Policies).  *)
(* No Reflections, so `Reflections \X Windows` is empty and P1 is the only  *)
(* Staleness Target.                                                        *)
(*                                                                          *)
(* The machine is derived, not drawn. `tla.sh autodiagram` searches the full *)
(* state space, then collapses the dump by the `phase` variable, so the      *)
(* result is the exact image of the reachable graph under that abstraction.  *)
(* Edge labels come from `-dump dot,actionlabels`.                           *)
(*                                                                           *)
(* Read it as a reachability report as well as a picture: a conceptual state *)
(* with no node cannot be reached by any action sequence, and an edge nobody *)
(* intended is a transition the rules permit.                                *)
(*                                                                           *)
(* Two things that look like the right tool here are both traps, and both    *)
(* produced clean, plausible, WRONG diagrams before being caught:            *)
(*                                                                           *)
(*  - TLC's `-view` flag truncates the search outright: when caught, 6 states *)
(*    explored where the same model without it explored 5619, losing the     *)
(*    entire Pending branch.                                                 *)
(*  - A cfg VIEW expands only one representative per equivalence class, so   *)
(*    its graph is a subgraph of the true abstract machine. It rendered      *)
(*    15 states and 60 transitions where there are 20 and 97, and asserted   *)
(*    "Preview (stale) --ApprovePreview--> Idle" — the exact opposite of     *)
(*    what §Resolution of Staleness requires.                                *)
(*                                                                           *)
(* Hence: no VIEW anywhere, and the abstraction applied afterwards.          *)
(***************************************************************************)
EXTENDS Lifecycle

mc_Projections    == {"P1"}
mc_Reflections    == {}
mc_Windows        == {}
mc_ApprovalPolicy == [e \in {"P1"} |-> "Manual"]
mc_MaxSnaps       == 4
mc_MaxVers        == 1

\* No VIEW here. `tla.sh autodiagram` searches the full space and collapses
\* the dump by the `phase` variable afterwards, because TLC's VIEW expands only
\* one representative per class and so emits a subgraph of the true machine.

====
