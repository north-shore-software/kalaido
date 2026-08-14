---- MODULE Lifecycle ----
(***************************************************************************)
(* Kalaido domain model — the Snapshot lifecycle of a Staleness Target.    *)
(*                                                                         *)
(* In scope:    model.md §Snapshot States                                  *)
(*              §Approval Policies                                         *)
(*              §Refinement Approval & Candidate Retirement Rules          *)
(*              §Projection / Reflection → Creation Workflow               *)
(*              §Context Tweaking, §Window Spec Edits & Versioning         *)
(*                                                                         *)
(* Out of scope: everything the Alloy model already checks — fragment and  *)
(* colour resolution (context.als), the Projection DAG (dag.als), Last N   *)
(* (reflection.als), the window grid (window.als, and Grid.tla in slice 2).*)
(* Also out of scope: *why* a target becomes stale. `MakeStale` is an      *)
(* abstract environment action standing in for fragment ingestion,         *)
(* upstream approval and temporal advancement alike.                       *)
(*                                                                         *)
(* WHY THIS MODULE EXISTS, AND WHAT IT CAN AND CANNOT ESTABLISH            *)
(*                                                                         *)
(* core.als models only `generate` and `approve`. Preview Snapshots, the   *)
(* interactive Refinement path, and obsolete-candidate retirement on a     *)
(* specification edit are absent from Alloy entirely, so over half of      *)
(* §Snapshot States has never been formalised anywhere. This module fills  *)
(* that gap and supplies the substrate for two derived state machine       *)
(* diagrams.                                                               *)
(*                                                                         *)
(* An honest limit, and the reason the invariant list below is short: a    *)
(* single hand-written module cannot produce many non-tautological         *)
(* invariants about its own actions. An invariant that merely restates     *)
(* what an action's update clause already says is construction-true and    *)
(* cannot fail — which is exactly the defect found in the previous draft's *)
(* five `Diagram_*` properties. Content arises only where two              *)
(* independently written rules of model.md must agree. Each invariant      *)
(* below is therefore labelled GUARD (construction-true, kept as a         *)
(* regression tripwire) or CONTENT (crosses two rules and can fail).       *)
(*                                                                         *)
(* The primary discovery mechanism here is not the invariants — it is the  *)
(* reachability of the state graph, read off the generated diagrams. A     *)
(* conceptual state with no node cannot be reached by any action sequence; *)
(* an edge nobody intended is a transition the rules permit.               *)
(***************************************************************************)
EXTENDS Integers, FiniteSets, Sequences, TLC

CONSTANTS
    Projections,   \* set of Projection ids
    Reflections,   \* set of Reflection ids
    Windows,       \* set of window keys t; a Reflection has one target per window
    ApprovalPolicy,\* [Projections \union Reflections -> {"Manual", "Automatic"}]
    MaxSnaps,      \* bound on total snapshots generated
    MaxVers        \* bound on Context Spec / Window Spec version counters

Entities == Projections \union Reflections

(***************************************************************************)
(* §Core Concept: Staleness Target — "For a Projection, the target is the   *)
(* entity itself. For a Reflection, the target is an individual window (t)."*)
(* A Reflection therefore holds a *set* of stale windows and queued         *)
(* candidates rather than a single entity-level state (line 205).           *)
(*                                                                          *)
(* Every target is a <<entity, window>> pair, a Projection using the        *)
(* sentinel window NoWindow. The uniform shape is not cosmetic: TLC refuses *)
(* to compare values of different types, so a `Targets` set mixing bare     *)
(* strings with pairs makes `tg \in Projections` a runtime error rather     *)
(* than a test. Windows are assumed to exclude the sentinel.                *)
(***************************************************************************)
NoWindow == 0

ASSUME Projections \cap Reflections = {}
ASSUME NoWindow \notin Windows

Targets == (Projections \X {NoWindow}) \union (Reflections \X Windows)

Proj(p)      == <<p, NoWindow>>
EntityOf(tg) == tg[1]
TargetsOf(e) == IF e \in Projections THEN {<<e, NoWindow>>} ELSE {e} \X Windows

(***************************************************************************)
(* Snapshots are records throughout, including the null. Mixing a string    *)
(* sentinel with record values — as the previous draft's [type |-> "NONE"]  *)
(* did — makes every field access a type hazard in TLC.                     *)
(*                                                                          *)
(* `gen` is §Generation Provenance: "refinement_chat" for a snapshot        *)
(* promoted from a Preview, "lens_execution" for one promoted from a        *)
(* background Candidate. `seq` is the approval sequence number, assigned    *)
(* only on approval — it is 0 while the snapshot is unapproved.             *)
(***************************************************************************)
NoSnap == [id |-> 0, gen |-> "none", lens |-> 0, spec |-> 0, seq |-> 0]

VARIABLES
    cand,     \* [Targets -> snapshot]  Pending Candidates queue (at most one)
    history,  \* [Targets -> SUBSET snapshot]  Snapshot History, append-only
    log,      \* [Targets -> SUBSET snapshot]  Candidate Execution Log
    preview,  \* [Targets -> snapshot]  the ephemeral Preview Snapshot, if any
    stale,    \* [Targets -> BOOLEAN]   Stale Flag
    lens,     \* [Entities -> Nat]      Current Lens version
    ctxVer,   \* [Entities -> Nat]      Context Spec version
    winVer,   \* [Entities -> Nat]      Window Spec version count
    seq,      \* [Targets -> Nat]       next approval sequence number
    nextId,
    phase,    \* [Targets -> STRING]    derived lifecycle label; see PhaseOf
    candFresh,\* [Targets -> BOOLEAN]   no trigger since cand[tg] was generated
    prevFresh \* [Targets -> BOOLEAN]   no trigger since preview[tg] was generated

vars == << cand, history, log, preview, stale, lens, ctxVer, winVer, seq, nextId,
           phase, candFresh, prevFresh >>

MkSnap(g, e) == [id |-> nextId, gen |-> g, lens |-> lens[e], spec |-> ctxVer[e], seq |-> 0]

(***************************************************************************)
(* The conceptual lifecycle state of a Staleness Target, as a function of   *)
(* that target's four lifecycle variables. Taking them as arguments rather  *)
(* than reading the globals lets `Next` compute the next-state value below  *)
(* without priming an operator application.                                 *)
(*                                                                          *)
(* §Active Snapshot Resolution Rule: "'Active' status (and conversely,      *)
(* supersession) is not stored as a mutable state flag on snapshot records". *)
(* So `phase` is not an authority on anything — it is a mirror, recomputed  *)
(* from the real variables on every step and checked by PhaseIsFaithful.    *)
(* It exists because TLC's dot export labels each node with a full state    *)
(* dump; carrying the label inside the state is what makes the generated    *)
(* diagram readable without hand-editing it afterwards.                     *)
(*                                                                          *)
(* Note what the hand-drawn @mermaid snapshot_lifecycle block conflates:    *)
(* `Retired` and `ApprovedSuperseded` are states of a *snapshot*, while     *)
(* `Pending` and `Preview` are states of a *target*. They cannot be nodes   *)
(* of one machine. This is the target machine, and it names the two         *)
(* dimensions separately: what the target is working on (Idle / Pending /   *)
(* Preview) and what it has published (no snapshot / 1 approved /           *)
(* superseded, the last meaning history holds more than one snapshot and    *)
(* all but the highest sequence number are superseded).                     *)
(*                                                                          *)
(* The stale flag is part of the label because it is what gates             *)
(* BackgroundRun; without it the Approved -> Pending edge would look        *)
(* unconditional in the diagram.                                            *)
(***************************************************************************)
(* The label carries the published history *independently* of the queue      *)
(* state, rather than only when the queue is empty. That is not decoration.  *)
(* An earlier version collapsed to a single "Preview" node regardless of     *)
(* history, which merged "drafting the first snapshot" with "drafting a      *)
(* replacement for an approved one" — and since those two differ in where    *)
(* approving the preview lands, the Projection diagram lost every path to    *)
(* supersession and simply had no Approved+Superseded node. A VIEW that      *)
(* abstracts away state the transitions depend on yields a diagram that      *)
(* silently omits real behaviour.                                            *)
(*                                                                           *)
(* With `queue` and `pub` both present the abstraction is sound: no action   *)
(* reads any other variable in a way that gates it, except the MaxSnaps and  *)
(* MaxVers bounds, which are model bounds rather than domain rules.          *)
PhaseOf(pv, cd, hs, st, cf, pf) ==
    LET queue  == IF      pv # NoSnap          THEN "Preview"
                  ELSE IF cd # NoSnap          THEN "Pending"
                  ELSE                              "Idle"
        \* whether the queued artefact predates a trigger, which decides where
        \* approving it lands (§Resolution of Staleness). Without this the
        \* abstraction merges a preview that saw everything with one that did
        \* not, and the diagram shows approval always clearing the flag.
        behind == IF      pv # NoSnap          THEN ~pf
                  ELSE IF cd # NoSnap          THEN ~cf
                  ELSE                              FALSE
        pub    == IF      hs = {}              THEN "no snapshot"
                  ELSE IF Cardinality(hs) = 1  THEN "1 approved"
                  ELSE                              "superseded"
    IN  queue \o (IF behind THEN " behind" ELSE "")
              \o " / " \o pub \o (IF st THEN " (stale)" ELSE "")

TargetState(tg) == PhaseOf(preview[tg], cand[tg], history[tg], stale[tg],
                          candFresh[tg], prevFresh[tg])
Label(tg)       == TargetState(tg)

Init ==
    /\ cand    = [tg \in Targets  |-> NoSnap]
    /\ history = [tg \in Targets  |-> {}]
    /\ log     = [tg \in Targets  |-> {}]
    /\ preview = [tg \in Targets  |-> NoSnap]
    /\ stale   = [tg \in Targets  |-> FALSE]
    /\ lens    = [e  \in Entities |-> 0]
    /\ ctxVer  = [e  \in Entities |-> 0]
    /\ winVer  = [e  \in Entities |-> 0]
    /\ seq     = [tg \in Targets  |-> 1]
    /\ nextId  = 1
    /\ phase   = [tg \in Targets  |-> PhaseOf(NoSnap, NoSnap, {}, FALSE, TRUE, TRUE)]
    /\ candFresh = [tg \in Targets |-> TRUE]
    /\ prevFresh = [tg \in Targets |-> TRUE]

(***************************************************************************)
(* ACTIONS                                                                  *)
(*                                                                          *)
(* Every action ends with UpdPhase, which recomputes the mirror from the    *)
(* next-state values the action has just assigned. It is a final conjunct   *)
(* of each action rather than a clause of `Next` for one concrete reason:   *)
(* `-dump dot,actionlabels` names each edge after the sub-action that       *)
(* produced it, so folding the update into `Next` would label every edge of *)
(* both diagrams "Next" and throw away the action names.                    *)
(***************************************************************************)

UpdPhase ==
    phase' = [tg \in Targets |->
                 PhaseOf(preview'[tg], cand'[tg], history'[tg], stale'[tg],
                         candFresh'[tg], prevFresh'[tg])]

(***************************************************************************)
(* §Resolution of Staleness: "A snapshot only clears triggers it could have  *)
(* seen ... A trigger that fires afterwards survives approval: the snapshot  *)
(* is published and becomes active as normal, but the target remains stale   *)
(* and the engine regenerates."                                             *)
(*                                                                          *)
(* Tracked as one boolean per queued artefact rather than with a clock.      *)
(* candFresh[tg] means no trigger has fired for tg since cand[tg] was        *)
(* generated. A clock would order triggers against generations exactly, but  *)
(* every tick would make a distinct state; the boolean carries the only fact *)
(* approval actually needs.                                                  *)
(*                                                                          *)
(* Normalised to TRUE whenever the artefact is absent, so an empty queue has *)
(* a single representation. FreshnessIsNormalised below checks that.         *)
(***************************************************************************)
TaintIn(f, art, S) ==
    [tg \in Targets |-> IF tg \in S THEN (art[tg] = NoSnap) ELSE f[tg]]

(* An abstract external staleness trigger. This module does not model which *)
(* of the §Staleness Triggers fired — only that staleness arrives.          *)
MakeStale(tg) ==
    /\ ~stale[tg]
    /\ stale' = [stale EXCEPT ![tg] = TRUE]
    /\ candFresh' = TaintIn(candFresh, cand,    {tg})
    /\ prevFresh' = TaintIn(prevFresh, preview, {tg})
    /\ UNCHANGED << cand, history, log, preview, lens, ctxVer, winVer, seq, nextId >>
    /\ UpdPhase

(* §Candidate Snapshot: generated by the background engine for a target     *)
(* that has become stale. §Candidate Queue Replacement: a new candidate     *)
(* replaces any unapproved candidate already queued, retiring it to the     *)
(* Candidate Execution Log. §Approval Policies: under Automatic Approval    *)
(* "candidates are transient and are never held in the pending queue".      *)
BackgroundRun(tg) ==
    LET e == EntityOf(tg)
        c == MkSnap("lens_execution", e)
    IN
    /\ stale[tg]
    /\ nextId <= MaxSnaps
    /\ nextId' = nextId + 1
    /\ log' = [log EXCEPT ![tg] = @ \union (IF cand[tg] = NoSnap THEN {} ELSE {cand[tg]})]
    /\ IF ApprovalPolicy[e] = "Automatic"
       THEN /\ cand'    = [cand    EXCEPT ![tg] = NoSnap]
            /\ history' = [history EXCEPT ![tg] = @ \union {[c EXCEPT !.seq = seq[tg]]}]
            /\ seq'     = [seq     EXCEPT ![tg] = @ + 1]
            /\ stale'   = [stale   EXCEPT ![tg] = FALSE]
       ELSE /\ cand'    = [cand    EXCEPT ![tg] = c]
            /\ UNCHANGED << history, seq, stale >>
    /\ candFresh' = [candFresh EXCEPT ![tg] = TRUE]
    /\ UNCHANGED << preview, lens, ctxVer, winVer, prevFresh >>
    /\ UpdPhase

(* §Approval Policies (Manual Approval) and §Latest Candidate Approval      *)
(* Restriction: only the candidate currently in the queue can be promoted.  *)
(*                                                                          *)
(* NOTE — an open question deliberately not checked in this slice. `stale`  *)
(* is cleared unconditionally, so a target flagged stale *after* this       *)
(* candidate was generated has that flag cleared by approving a snapshot    *)
(* that predates the trigger. model.md §Engine Execution & Liveness covers  *)
(* the regeneration case (line 287) but not this one, and dag.als's         *)
(* cascadeRule makes the identical assumption. The interleaving is          *)
(* representable in this module; it is checked in slice 5, where the clock  *)
(* makes the ordering legible.                                              *)
ApproveCandidate(tg) ==
    /\ ApprovalPolicy[EntityOf(tg)] = "Manual"
    /\ cand[tg] # NoSnap
    /\ history' = [history EXCEPT ![tg] = @ \union {[cand[tg] EXCEPT !.seq = seq[tg]]}]
    /\ seq'     = [seq     EXCEPT ![tg] = @ + 1]
    /\ cand'    = [cand    EXCEPT ![tg] = NoSnap]
    /\ stale'   = [stale   EXCEPT ![tg] = ~candFresh[tg]]
    /\ candFresh' = [candFresh EXCEPT ![tg] = TRUE]
    /\ UNCHANGED << log, preview, lens, ctxVer, winVer, nextId, prevFresh >>
    /\ UpdPhase

(* §Creation Workflow steps 2-3: the user opens a Refinement Chat and an    *)
(* ephemeral Preview Snapshot is generated from the context and chat        *)
(* history. For a Reflection the chat is bound to a target window (line 421)*)
(* which is why `preview` is indexed by Target rather than by Entity.       *)
StartRefinement(tg) ==
    /\ preview[tg] = NoSnap
    /\ nextId <= MaxSnaps
    /\ nextId' = nextId + 1
    /\ preview' = [preview EXCEPT ![tg] = MkSnap("refinement_chat", EntityOf(tg))]
    /\ prevFresh' = [prevFresh EXCEPT ![tg] = TRUE]
    /\ UNCHANGED << cand, history, log, stale, lens, ctxVer, winVer, seq, candFresh >>
    /\ UpdPhase

(* §Preview Snapshot: "a live draft preview for user critique and           *)
(* iteration" — a further chat turn replaces the draft.                     *)
PreviewTurn(tg) ==
    /\ preview[tg] # NoSnap
    /\ nextId <= MaxSnaps
    /\ nextId' = nextId + 1
    /\ preview' = [preview EXCEPT ![tg] = MkSnap("refinement_chat", EntityOf(tg))]
    /\ prevFresh' = [prevFresh EXCEPT ![tg] = TRUE]
    /\ UNCHANGED << cand, history, log, stale, lens, ctxVer, winVer, seq, candFresh >>
    /\ UpdPhase

(* §Refinement Approval Supercession: approving a Preview distills a new    *)
(* Lens and promotes the preview into a new Approved Snapshot for that      *)
(* target, superseding the previously active one.                           *)
(*                                                                          *)
(* §Obsolete Candidate Retirement: distilling an updated Lens obsoletes     *)
(* every unapproved candidate of the entity, since all were generated under *)
(* the previous Lens. The Lens is entity-wide, so this reaches every target *)
(* of the entity, not just the refinement's own.                            *)
(*                                                                          *)
(* §Specification Edits: "the refinement itself publishes a fresh Approved  *)
(* Snapshot for its target, so the target is by definition not stale ...    *)
(* for a Reflection it leaves any *other* already-stale windows stale".     *)
ApprovePreview(tg) ==
    LET e == EntityOf(tg) IN
    /\ preview[tg] # NoSnap
    /\ lens'    = [lens EXCEPT ![e] = @ + 1]
    /\ history' = [history EXCEPT ![tg] = @ \union {[preview[tg] EXCEPT !.seq = seq[tg]]}]
    /\ seq'     = [seq     EXCEPT ![tg] = @ + 1]
    /\ preview' = [preview EXCEPT ![tg] = NoSnap]
    /\ log'  = [u \in Targets |-> IF u \in TargetsOf(e) /\ cand[u] # NoSnap
                                  THEN log[u] \union {cand[u]} ELSE log[u]]
    /\ cand' = [u \in Targets |-> IF u \in TargetsOf(e) THEN NoSnap ELSE cand[u]]
    /\ stale' = [stale EXCEPT ![tg] = ~prevFresh[tg]]
    /\ prevFresh' = [prevFresh EXCEPT ![tg] = TRUE]
    /\ candFresh' = [u \in Targets |-> IF u \in TargetsOf(e) THEN TRUE ELSE candFresh[u]]
    /\ UNCHANGED << ctxVer, winVer, nextId >>
    /\ UpdPhase

(* §Preview Snapshot is ephemeral; the hand-drawn diagram's                 *)
(* "Preview --> [*] : Discarded (Implicit)". Nothing is recorded anywhere.  *)
DiscardPreview(tg) ==
    /\ preview[tg] # NoSnap
    /\ preview' = [preview EXCEPT ![tg] = NoSnap]
    /\ prevFresh' = [prevFresh EXCEPT ![tg] = TRUE]
    /\ UNCHANGED << cand, history, log, stale, lens, ctxVer, winVer, seq, nextId, candFresh >>
    /\ UpdPhase

(* §Context Tweaking: "This flags the Projection stale."                    *)
(* §Obsolete Candidate Retirement (Specification Edits): queued candidates  *)
(* were generated under the earlier specification and are retired.          *)
(*                                                                          *)
(* Transcription judgment: model.md says a Context Spec edit flags "the     *)
(* entity" stale without saying which windows of a Reflection. Since the    *)
(* Context Spec feeds every window's Resolved Context, all targets of the   *)
(* entity are flagged. Recorded here because it is an inference, not a      *)
(* quotation.                                                               *)
EditContextSpec(e) ==
    /\ ctxVer[e] < MaxVers
    /\ ctxVer' = [ctxVer EXCEPT ![e] = @ + 1]
    /\ log'   = [u \in Targets |-> IF u \in TargetsOf(e) /\ cand[u] # NoSnap
                                   THEN log[u] \union {cand[u]} ELSE log[u]]
    /\ cand'  = [u \in Targets |-> IF u \in TargetsOf(e) THEN NoSnap ELSE cand[u]]
    /\ stale' = [u \in Targets |-> IF u \in TargetsOf(e) THEN TRUE ELSE stale[u]]
    /\ candFresh' = [u \in Targets |-> IF u \in TargetsOf(e) THEN TRUE ELSE candFresh[u]]
    /\ prevFresh' = TaintIn(prevFresh, preview, TargetsOf(e))
    /\ UNCHANGED << history, preview, lens, winVer, seq, nextId >>
    /\ UpdPhase

(* §Window Spec Edits & Versioning — the deliberate negative case. An edit  *)
(* appends a version rather than altering any existing window, so a queued  *)
(* candidate "is still valid for the window it was generated against"       *)
(* (line 234) and the edit "is **not** a staleness trigger" (line 258).     *)
(* Present so that the contrast with EditContextSpec is exercised rather    *)
(* than merely asserted.                                                    *)
EditWindowSpec(e) ==
    /\ e \in Reflections
    /\ winVer[e] < MaxVers
    /\ winVer' = [winVer EXCEPT ![e] = @ + 1]
    /\ UNCHANGED << cand, history, log, preview, stale, lens, ctxVer, seq, nextId,
                    candFresh, prevFresh >>
    /\ UpdPhase

Step ==
    \/ \E tg \in Targets    : MakeStale(tg)
    \/ \E tg \in Targets    : BackgroundRun(tg)
    \/ \E tg \in Targets    : ApproveCandidate(tg)
    \/ \E tg \in Targets    : StartRefinement(tg)
    \/ \E tg \in Targets    : PreviewTurn(tg)
    \/ \E tg \in Targets    : ApprovePreview(tg)
    \/ \E tg \in Targets    : DiscardPreview(tg)
    \/ \E e  \in Entities   : EditContextSpec(e)
    \/ \E e  \in Reflections: EditWindowSpec(e)

Next == Step

(***************************************************************************)
(* No `\/ UNCHANGED vars` disjunct: it is redundant under [Next]_vars and   *)
(* would decorate every node of the generated diagrams with a self-loop.    *)
(* The configs set CHECK_DEADLOCK FALSE instead, since exhausting MaxSnaps  *)
(* is an intended terminal condition rather than a modelling error.         *)
(***************************************************************************)

(***************************************************************************)
(* INVARIANTS                                                               *)
(*                                                                          *)
(* GUARD   = construction-true; cannot fail as written, kept as a tripwire  *)
(*           against a later edit that breaks the shape.                    *)
(* CONTENT = crosses two independently written rules of model.md and can    *)
(*           genuinely fail.                                                *)
(***************************************************************************)

(* GUARD. Freshness is meaningless for an artefact that does not exist, so  *)
(* it is normalised to TRUE there. Without this an empty queue would have   *)
(* two representations and the state space would double for nothing.       *)
FreshnessIsNormalised ==
    \A tg \in Targets :
        /\ (cand[tg]    = NoSnap => candFresh[tg])
        /\ (preview[tg] = NoSnap => prevFresh[tg])

(* CONTENT. §Resolution of Staleness: "A snapshot only clears triggers it   *)
(* could have seen." The complement of the rule, stated as a safety         *)
(* property: a target may never come out of an approval clear when a        *)
(* trigger fired after the approved snapshot's context was resolved.        *)
(*                                                                          *)
(* This crosses §Resolution of Staleness against both approval paths, and   *)
(* is the one place model.md and this module previously disagreed — the     *)
(* module cleared `stale` unconditionally, which is what the Projection     *)
(* diagram exposed as `Preview (stale) --ApprovePreview--> Idle`.           *)
ApprovalNeverClearsAnUnseenTrigger ==
    [][ \A tg \in Targets :
          /\ (ApproveCandidate(tg) => (stale'[tg] = ~candFresh[tg]))
          /\ (ApprovePreview(tg)   => (stale'[tg] = ~prevFresh[tg]))
      ]_vars

(* GUARD. `phase` mirrors the real variables and is never an authority on   *)
(* anything. If a later edit adds an action that bypasses `Next`, or        *)
(* changes PhaseOf without changing both call sites, the diagrams would     *)
(* start lying about the machine. This catches that.                        *)
PhaseIsFaithful ==
    phase = [tg \in Targets |-> TargetState(tg)]

(* GUARD. §Anatomy & State: the queue holds "at most one unapproved         *)
(* Candidate Snapshot". Modelled as a single record, so this holds by       *)
(* representation. core.als checks the set-valued version.                  *)
TypeOK ==
    /\ \A tg \in Targets : cand[tg].gen    \in {"none", "lens_execution"}
    /\ \A tg \in Targets : preview[tg].gen \in {"none", "refinement_chat"}
    /\ \A tg \in Targets : \A s \in log[tg]     : s.gen = "lens_execution"
    /\ \A tg \in Targets : \A s \in history[tg] : s.gen \in {"lens_execution", "refinement_chat"}

(* GUARD. §Preview Snapshot is ephemeral and §Candidate Execution Log holds  *)
(* retired *candidates*: a preview must never appear in the log, and the     *)
(* four collections must stay disjoint.                                      *)
CollectionsAreDisjoint ==
    \A tg \in Targets :
        /\ history[tg] \cap log[tg] = {}
        /\ cand[tg] \notin history[tg]
        /\ cand[tg] \notin log[tg]
        /\ preview[tg] \notin history[tg]
        /\ preview[tg] \notin log[tg]

(* CONTENT. §Approval Policies: under Automatic Approval candidates "are     *)
(* never held in the pending queue; the queue is therefore always empty".    *)
(* Crosses the policy rule against BackgroundRun's generation clause. It is  *)
(* also the gate for reading the Reflection diagram: if that diagram has no  *)
(* Pending node, this invariant is why, rather than a broken action.         *)
AutomaticQueueAlwaysEmpty ==
    \A tg \in Targets :
        ApprovalPolicy[EntityOf(tg)] = "Automatic" => cand[tg] = NoSnap

(* CONTENT. §Retired Candidate Snapshot: "They cannot be promoted to        *)
(* Approved Snapshots", and §Latest Candidate Approval Restriction.         *)
(* Crosses queue replacement (which fills the log) against the two approval *)
(* paths (which fill history). Fails if any path can approve something the  *)
(* queue already retired.                                                   *)
RetiredNeverApproved ==
    \A tg \in Targets :
        \A r \in log[tg] : \A h \in history[tg] : r.id # h.id

(* CONTENT. §Approved Snapshot: the approval sequence number is "unique and *)
(* monotonically increasing per Staleness Target", and §Active Snapshot     *)
(* Resolution Rule derives exactly one active snapshot from it. Crosses     *)
(* three writers of `history` — BackgroundRun under Automatic,              *)
(* ApproveCandidate, and ApprovePreview — which must not be able to issue   *)
(* the same number twice for one target.                                    *)
ExactlyOneActive ==
    \A tg \in Targets :
        history[tg] # {} =>
            Cardinality({ s \in history[tg] :
                            \A o \in history[tg] : o.seq <= s.seq }) = 1

(***************************************************************************)
(* ACTION PROPERTIES                                                        *)
(***************************************************************************)

(* CONTENT. §Obsolete Candidate Retirement, both halves, checked against    *)
(* each other. A Context Spec edit or a Lens distillation must leave the    *)
(* entity with no queued candidate; a Window Spec edit must leave every     *)
(* queued candidate exactly where it was. The two clauses come from the     *)
(* same sentence of model.md and its parenthetical, and are the reason      *)
(* EditWindowSpec exists in this module at all.                            *)
ObsoleteRetirementIsExact ==
    [][ /\ \A e \in Entities :
              EditContextSpec(e) => \A u \in TargetsOf(e) : cand'[u] = NoSnap
        /\ \A e \in Reflections :
              EditWindowSpec(e)  => \A u \in TargetsOf(e) : cand'[u] = cand[u]
      ]_vars

(* CONTENT. §Specification Edits: approving a Refinement Chat "is likewise  *)
(* **not** a staleness trigger — the refinement itself publishes a fresh    *)
(* Approved Snapshot for its target, so the target is by definition not     *)
(* stale ... and for a Reflection it leaves any **other** already-stale     *)
(* windows stale". Both halves in one property: the target clears, and no   *)
(* sibling window's flag moves in either direction.                         *)
(* History: this originally asserted `stale'[tg] = FALSE` outright, and that *)
(* is what failed once §Resolution of Staleness gained the freshness rule —  *)
(* correctly, since a refinement no longer clears a trigger that arrived     *)
(* mid-chat. What survives is the part that was always the point: a          *)
(* refinement never *creates* staleness. Stated as two claims that between   *)
(* them still forbid the old bug, without restating the freshness rule       *)
(* checked just above.                                                       *)
(* A second, stronger version also failed, and the counterexample is the     *)
(* reason model.md now documents backwards-moving approvals. The claim was   *)
(* that a refinement never makes a not-stale target stale. It can:           *)
(*                                                                           *)
(*   StartRefinement(R2,1)   preview generated                               *)
(*   MakeStale(R2,1)         a fragment arrives; the preview is now behind   *)
(*   BackgroundRun(R2,1)     R2 is Automatic, so the engine publishes at     *)
(*                           once, including the fragment — target is fresh  *)
(*   ApprovePreview(R2,1)    the older preview supersedes it — stale again   *)
(*                                                                           *)
(* So a refinement can raise the flag, by publishing content older than what *)
(* it supersedes. What remains true is the pair below.                       *)
RefinementIsNotAStalenessTrigger ==
    [][ \A tg \in Targets :
          ApprovePreview(tg) =>
            \* a refinement whose preview saw everything leaves the target fresh:
            \* the refinement itself is never the thing that makes it stale
            /\ (prevFresh[tg] => ~stale'[tg])
            \* and other windows of the same Reflection keep their flags exactly
            \* (§Specification Edits: "leaves any other already-stale windows stale")
            /\ \A u \in Targets \ {tg} : stale'[u] = stale[u]
      ]_vars

====
