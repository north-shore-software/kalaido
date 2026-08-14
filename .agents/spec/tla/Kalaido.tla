---- MODULE Kalaido ----
EXTENDS Integers, Sequences, FiniteSets, TLC

\* ===========================================================================
\* CONSTANTS
\* ===========================================================================
CONSTANTS 
    Projections,    
    Reflections,    
    WindowIndices,  \* e.g., {1, 2, 3} for grid evaluation multiplier k
    Fragments,      
    Colours,
    
    \* Dependency DAG
    ProjDependsOnProj, \* [Projections -> SUBSET Projections]
    ProjDependsOnRefl, \* [Projections -> SUBSET Reflections]
    
    \* Configuration Specs
    ProjContextColours, \* [Projections -> SUBSET Colours]
    ReflContextColours, \* [Reflections -> SUBSET Colours]
    ReflWindowSpecs     \* [Reflections -> [startTime: Int, period: Int, duration: Int]]

\* ===========================================================================
\* VARIABLES
\* ===========================================================================
VARIABLES 
    \* Inputs & Classification
    fragments,          \* Set of ingested fragment IDs
    fragEventDate,      \* [Fragments -> Int]
    fragColours,        \* [Fragments -> SUBSET Colours]
    fragDeleted,        \* [Fragments -> BOOLEAN]
    
    colArchived,        \* [Colours -> BOOLEAN]
    
    \* Synthesized Views
    projStaleness,      \* [Projections -> BOOLEAN]
    projCandidates,     \* [Projections -> "NONE" or Record]
    projSeqNums,        \* [Projections -> Nat]
    projDeleted,        \* [Projections -> BOOLEAN]
    
    reflStaleness,      \* [Reflections -> [WindowIndices -> BOOLEAN]]
    reflCandidates,     \* [Reflections -> [WindowIndices -> "NONE" or Record]]
    reflSeqNums,        \* [Reflections -> [WindowIndices -> Nat]]
    reflDeleted,        \* [Reflections -> BOOLEAN]
    
    snapshotHistory,    
    retiredCandidates   

vars == << fragments, fragEventDate, fragColours, fragDeleted, colArchived,
           projStaleness, projCandidates, projSeqNums, projDeleted, 
           reflStaleness, reflCandidates, reflSeqNums, reflDeleted, 
           snapshotHistory, retiredCandidates >>

\* ===========================================================================
\* HELPERS (Window Grid Logic: Duration vs Period)
\* ===========================================================================
\* @mermaid domain_rules_diagrams
\* stateDiagram-v2
\*     direction TB
\*     
\*     %% Window Mechanics
\*     state "Fragment Event Date Evaluated" as Eval
\*     state "Duration vs Period\n(Window Overlap/Gap logic)" as Logic
\*     state "Flags multiple Windows\n(Duration > Period)" as Overlap
\*     state "Flags exactly 1 Window\n(Duration == Period)" as Tumbling
\*     state "Flags ZERO Windows\n(Duration < Period & lands in gap)" as Gap
\*     
\*     Eval --> Logic
\*     Logic --> Overlap : Event falls in multiple overlapping bounds
\*     Logic --> Tumbling : Event falls in contiguous bounds
\*     Logic --> Gap : Event falls outside all bounds
\*     
\*     %% Classification
\*     state "Colour Created\n(Backfill)" as Backfill
\*     state "Colour Manually Added" as Manual
\*     state "Colour Archived" as Archived
\*     state "Colour Definition Updated" as DefUpdate
\*     
\*     Backfill --> "Massive Downstream Staleness" : Retroactive tagging
\*     Manual --> "Targeted Staleness" : Single fragment updated
\*     Archived --> "Frozen State" : Prevents tagging/untagging
\*     DefUpdate --> "No Staleness Triggered"
\*     
\*     %% Deletion
\*     state "Dependency Deletion Check" as DelCheck
\*     state "Projection/Reflection Deleted" as Del
\*     state "Deletion Rejected" as DelRej
\*     
\*     DelCheck --> Del : No downstream dependencies
\*     DelCheck --> DelRej : Active downstream dependency exists
\* @end
\* k is the grid point multiplier.
WindowEnd(r, k) == ReflWindowSpecs[r].startTime + (k * ReflWindowSpecs[r].period)

WindowStartUnclamped(r, k) == WindowEnd(r, k) - ReflWindowSpecs[r].duration

\* "First-window truncation: where a relative window's computed start would fall before Start Time, the window is truncated to begin at Start Time."
WindowStart(r, k) == 
    IF WindowStartUnclamped(r, k) < ReflWindowSpecs[r].startTime 
    THEN ReflWindowSpecs[r].startTime 
    ELSE WindowStartUnclamped(r, k)

\* Boundary Semantics: half-open [start, end)
\* Overlapping windows: A single fragment can land in multiple windows if Duration > Period.
\* Gapped windows: A single fragment might land in ZERO windows if Duration < Period and it falls in a gap.
FragInWindow(f, r, k) == 
    /\ fragEventDate[f] >= WindowStart(r, k)
    /\ fragEventDate[f] < WindowEnd(r, k)

\* ===========================================================================
\* INITIAL STATE
\* ===========================================================================
Init == 
    /\ fragments = {}
    /\ fragEventDate = [f \in Fragments |-> 0]
    /\ fragColours = [f \in Fragments |-> {}]
    /\ fragDeleted = [f \in Fragments |-> FALSE]
    /\ colArchived = [c \in Colours |-> FALSE]
    
    /\ projStaleness = [p \in Projections |-> FALSE]
    /\ projCandidates = [p \in Projections |-> [type |-> "NONE"]]
    /\ projSeqNums = [p \in Projections |-> 1]
    /\ projDeleted = [p \in Projections |-> FALSE]
    
    /\ reflStaleness = [r \in Reflections |-> [k \in WindowIndices |-> FALSE]]
    /\ reflCandidates = [r \in Reflections |-> [k \in WindowIndices |-> [type |-> "NONE"]]]
    /\ reflSeqNums = [r \in Reflections |-> [k \in WindowIndices |-> 1]]
    /\ reflDeleted = [r \in Reflections |-> FALSE]
    
    /\ snapshotHistory = {}
    /\ retiredCandidates = {}

IsCandidateNone(c) == c.type = "NONE"

\* ===========================================================================
\* ACTIONS (Inputs & Classification)
\* ===========================================================================

IngestFragment(f, eDate) ==
    /\ f \notin fragments
    /\ fragments' = fragments \union {f}
    /\ fragEventDate' = [fragEventDate EXCEPT ![f] = eDate]
    /\ fragColours' = [fragColours EXCEPT ![f] = {}]
    /\ fragDeleted' = [fragDeleted EXCEPT ![f] = FALSE]
    \* Note: Fragment ingest triggers staleness universally here unless filtered.
    /\ projStaleness' = [p \in Projections |-> IF ~projDeleted[p] THEN TRUE ELSE projStaleness[p]]
    /\ reflStaleness' = [r \in Reflections |-> [k \in WindowIndices |->
            IF ~reflDeleted[r] /\ FragInWindow(f, r, k) THEN TRUE ELSE reflStaleness[r][k]]]
    /\ UNCHANGED <<colArchived, projCandidates, projSeqNums, projDeleted, 
                   reflCandidates, reflSeqNums, reflDeleted, snapshotHistory, retiredCandidates>>

TagFragment(f, c) ==
    \* Manual Tagging
    /\ f \in fragments
    /\ fragDeleted[f] = FALSE
    /\ colArchived[c] = FALSE
    /\ c \notin fragColours[f]
    /\ fragColours' = [fragColours EXCEPT ![f] = @ \union {c}]
    /\ projStaleness' = [p \in Projections |-> 
            IF ~projDeleted[p] /\ c \in ProjContextColours[p] THEN TRUE ELSE projStaleness[p]]
    /\ reflStaleness' = [r \in Reflections |-> [k \in WindowIndices |->
            IF ~reflDeleted[r] /\ c \in ReflContextColours[r] /\ FragInWindow(f, r, k)
            THEN TRUE ELSE reflStaleness[r][k]]]
    /\ UNCHANGED <<fragments, fragEventDate, fragDeleted, colArchived, projCandidates, 
                   projSeqNums, projDeleted, reflCandidates, reflSeqNums, reflDeleted, 
                   snapshotHistory, retiredCandidates>>

ColourBackfill(c, fs) ==
    \* Retroactive application to existing fragments (Massive Staleness Trigger)
    /\ colArchived[c] = FALSE
    /\ fs \subseteq fragments
    /\ fs /= {}
    /\ \A f \in fs : fragDeleted[f] = FALSE /\ c \notin fragColours[f]
    /\ fragColours' = [f \in Fragments |-> IF f \in fs THEN fragColours[f] \union {c} ELSE fragColours[f]]
    /\ projStaleness' = [p \in Projections |-> 
            IF ~projDeleted[p] /\ c \in ProjContextColours[p] THEN TRUE ELSE projStaleness[p]]
    /\ reflStaleness' = [r \in Reflections |-> [k \in WindowIndices |->
            IF ~reflDeleted[r] /\ c \in ReflContextColours[r] /\ (\E f \in fs : FragInWindow(f, r, k))
            THEN TRUE ELSE reflStaleness[r][k]]]
    /\ UNCHANGED <<fragments, fragEventDate, fragDeleted, colArchived, projCandidates, 
                   projSeqNums, projDeleted, reflCandidates, reflSeqNums, reflDeleted, 
                   snapshotHistory, retiredCandidates>>

ArchiveColour(c) ==
    /\ colArchived[c] = FALSE
    /\ colArchived' = [colArchived EXCEPT ![c] = TRUE]
    \* Freezes colour. No Staleness Trigger.
    /\ UNCHANGED <<fragments, fragEventDate, fragColours, fragDeleted, projStaleness, 
                   projCandidates, projSeqNums, projDeleted, reflStaleness, reflCandidates, 
                   reflSeqNums, reflDeleted, snapshotHistory, retiredCandidates>>

DeleteFragment(f) ==
    /\ f \in fragments
    /\ fragDeleted[f] = FALSE
    /\ fragDeleted' = [fragDeleted EXCEPT ![f] = TRUE]
    \* Leaves dangling references, triggers staleness
    /\ projStaleness' = [p \in Projections |-> IF ~projDeleted[p] THEN TRUE ELSE projStaleness[p]]
    /\ reflStaleness' = [r \in Reflections |-> [k \in WindowIndices |-> 
            IF ~reflDeleted[r] /\ FragInWindow(f, r, k) THEN TRUE ELSE reflStaleness[r][k]]]
    /\ UNCHANGED <<fragments, fragEventDate, fragColours, colArchived, projCandidates, 
                   projSeqNums, projDeleted, reflCandidates, reflSeqNums, reflDeleted, 
                   snapshotHistory, retiredCandidates>>

\* ===========================================================================
\* ACTIONS (Synthesis Rules & Deletion Locks)
\* ===========================================================================
\* NOTE: the hand-drawn `snapshot_lifecycle` state diagram that used to sit here has
\* been removed. It drew states this module has no actions for (Preview, and the
\* obsolete-candidate retirement path), so it documented intent rather than the spec,
\* and could not be regenerated from anything. The snapshot lifecycle now lives in
\* Lifecycle.tla, and its two state machines are *derived* from the math:
\*
\*     ./tla.sh autodiagram diag_proj   -- Projection lifecycle
\*     ./tla.sh autodiagram diag_refl   -- Reflection window lifecycle
\*
\* Add hand-drawn @mermaid blocks only for things that are not state machines. A
\* state machine drawn by hand alongside one defined in TLA+ will drift from it.

DeleteProjection(p) ==
    /\ projDeleted[p] = FALSE
    \* Dependency Lock: Cannot be deleted if a downstream entity depends on it
    /\ \A p2 \in Projections : (~projDeleted[p2] => p \notin ProjDependsOnProj[p2])
    /\ projDeleted' = [projDeleted EXCEPT ![p] = TRUE]
    /\ projStaleness' = [projStaleness EXCEPT ![p] = FALSE]
    /\ projCandidates' = [projCandidates EXCEPT ![p] = [type |-> "NONE"]]
    /\ UNCHANGED <<fragments, fragEventDate, fragColours, fragDeleted, colArchived,
                   projSeqNums, reflStaleness, reflCandidates, reflSeqNums, reflDeleted,
                   snapshotHistory, retiredCandidates>>

DeleteReflection(r) ==
    /\ reflDeleted[r] = FALSE
    \* Dependency Lock
    /\ \A p2 \in Projections : (~projDeleted[p2] => r \notin ProjDependsOnRefl[p2])
    /\ reflDeleted' = [reflDeleted EXCEPT ![r] = TRUE]
    /\ reflStaleness' = [reflStaleness EXCEPT ![r] = [k \in WindowIndices |-> FALSE]]
    /\ reflCandidates' = [reflCandidates EXCEPT ![r] = [k \in WindowIndices |-> [type |-> "NONE"]]]
    /\ UNCHANGED <<fragments, fragEventDate, fragColours, fragDeleted, colArchived,
                   projStaleness, projCandidates, projSeqNums, projDeleted,
                   reflSeqNums, snapshotHistory, retiredCandidates>>

ProjBackgroundRun(p) ==
    /\ ~projDeleted[p]
    /\ projStaleness[p] = TRUE
    /\ retiredCandidates' = IF IsCandidateNone(projCandidates[p]) 
                            THEN retiredCandidates 
                            ELSE retiredCandidates \union {projCandidates[p]}
    /\ projCandidates' = [projCandidates EXCEPT ![p] = [type |-> "PROJ_CAND", target |-> p, seqNum |-> projSeqNums[p]]]
    /\ UNCHANGED <<fragments, fragEventDate, fragColours, fragDeleted, colArchived, 
                   projStaleness, projSeqNums, projDeleted, reflStaleness, reflCandidates, 
                   reflSeqNums, reflDeleted, snapshotHistory>>

ReflBackgroundRun(r, k) ==
    /\ ~reflDeleted[r]
    /\ reflStaleness[r][k] = TRUE
    /\ retiredCandidates' = IF IsCandidateNone(reflCandidates[r][k]) 
                            THEN retiredCandidates 
                            ELSE retiredCandidates \union {reflCandidates[r][k]}
    /\ reflCandidates' = [reflCandidates EXCEPT ![r][k] = [type |-> "REFL_CAND", target |-> r, window |-> k, seqNum |-> reflSeqNums[r][k]]]
    /\ UNCHANGED <<fragments, fragEventDate, fragColours, fragDeleted, colArchived, 
                   projStaleness, projCandidates, projSeqNums, projDeleted, reflStaleness, 
                   reflSeqNums, reflDeleted, snapshotHistory>>

ApproveProjCandidate(p) ==
    /\ ~projDeleted[p]
    /\ ~IsCandidateNone(projCandidates[p])
    /\ snapshotHistory' = snapshotHistory \union {[
            type |-> "PROJECTION", target |-> p, seqNum |-> projSeqNums[p]
       ]}
    /\ projCandidates' = [projCandidates EXCEPT ![p] = [type |-> "NONE"]]
    /\ projSeqNums' = [projSeqNums EXCEPT ![p] = projSeqNums[p] + 1]
    /\ projStaleness' = [p2 \in Projections |-> 
            IF ~projDeleted[p2] /\ p \in ProjDependsOnProj[p2] THEN TRUE 
            ELSE (IF p2 = p THEN FALSE ELSE projStaleness[p2])]
    /\ UNCHANGED <<fragments, fragEventDate, fragColours, fragDeleted, colArchived, 
                   projDeleted, reflStaleness, reflCandidates, reflSeqNums, reflDeleted, 
                   retiredCandidates>>

ApproveReflCandidate(r, k) ==
    /\ ~reflDeleted[r]
    /\ ~IsCandidateNone(reflCandidates[r][k])
    /\ snapshotHistory' = snapshotHistory \union {[
            type |-> "REFLECTION", target |-> r, window |-> k, seqNum |-> reflSeqNums[r][k]
       ]}
    /\ reflCandidates' = [reflCandidates EXCEPT ![r][k] = [type |-> "NONE"]]
    /\ reflSeqNums' = [reflSeqNums EXCEPT ![r][k] = reflSeqNums[r][k] + 1]
    /\ projStaleness' = [p2 \in Projections |-> 
            IF ~projDeleted[p2] /\ r \in ProjDependsOnRefl[p2] THEN TRUE 
            ELSE projStaleness[p2]]
    /\ reflStaleness' = [reflStaleness EXCEPT ![r][k] = FALSE]
    /\ UNCHANGED <<fragments, fragEventDate, fragColours, fragDeleted, colArchived, 
                   projCandidates, projSeqNums, projDeleted, reflDeleted, retiredCandidates>>

\* ===========================================================================
\* SYSTEM EVOLUTION (Next State Relation)
\* ===========================================================================
Next == 
    \/ \E f \in Fragments, e \in 0..100 : IngestFragment(f, e)
    \/ \E f \in Fragments, c \in Colours : TagFragment(f, c)
    \/ \E c \in Colours, fs \in SUBSET fragments : ColourBackfill(c, fs)
    \/ \E c \in Colours : ArchiveColour(c)
    \/ \E f \in Fragments : DeleteFragment(f)
    \/ \E p \in Projections : DeleteProjection(p)
    \/ \E r \in Reflections : DeleteReflection(r)
    \/ \E p \in Projections : ProjBackgroundRun(p) \/ ApproveProjCandidate(p)
    \/ \E r \in Reflections, k \in WindowIndices : ReflBackgroundRun(r, k) \/ ApproveReflCandidate(r, k)
    \/ UNCHANGED vars

\* ===========================================================================
\* INVARIANTS (Properties to verify)
\* ===========================================================================

\* DIAGRAM INVARIANT: "Pending --> ApprovedActive : User Approves / Auto-Approve"
\* Asserts that if an approve action is taken, the pending candidate must transition to NONE.
Diagram_PendingToApproved_Proj == 
    [][\A p \in Projections : ApproveProjCandidate(p) => 
        (projCandidates[p].type = "PROJ_CAND" /\ projCandidates'[p].type = "NONE")]_vars

Diagram_PendingToApproved_Refl == 
    [][\A r \in Reflections, k \in WindowIndices : ApproveReflCandidate(r, k) => 
        (reflCandidates[r][k].type = "REFL_CAND" /\ reflCandidates'[r][k].type = "NONE")]_vars

\* DIAGRAM INVARIANT: "Pending --> Retired : Replaced by newer Background Run"
\* Asserts that if a background run occurs while a candidate exists, the old one is moved to retired.
Diagram_PendingToRetired_Proj ==
    [][\A p \in Projections : ProjBackgroundRun(p) => 
        (~IsCandidateNone(projCandidates[p]) => projCandidates[p] \in retiredCandidates')
    ]_vars

Diagram_PendingToRetired_Refl ==
    [][\A r \in Reflections, k \in WindowIndices : ReflBackgroundRun(r, k) => 
        (~IsCandidateNone(reflCandidates[r][k]) => reflCandidates[r][k] \in retiredCandidates')
    ]_vars

\* DIAGRAM INVARIANT: "Archived --> Frozen State : Prevents tagging/untagging"
\* Asserts that if a colour is archived, TagFragment can never be successfully executed for it.
Diagram_ArchivedFrozen ==
    [][\A f \in Fragments, c \in Colours : TagFragment(f, c) => colArchived[c] = FALSE]_vars

NoStalenessMeansNoCandidateProj ==
    \A p \in Projections : (~projDeleted[p] /\ projStaleness[p] = FALSE) => IsCandidateNone(projCandidates[p])

NoStalenessMeansNoCandidateRefl ==
    \A r \in Reflections, k \in WindowIndices : (~reflDeleted[r] /\ reflStaleness[r][k] = FALSE) => IsCandidateNone(reflCandidates[r][k])

DependenciesNotDeleted ==
    \A p \in Projections : ~projDeleted[p] => 
        ( \A dep \in ProjDependsOnProj[p] : ~projDeleted[dep] ) /\
        ( \A dep \in ProjDependsOnRefl[p] : ~reflDeleted[dep] )

====