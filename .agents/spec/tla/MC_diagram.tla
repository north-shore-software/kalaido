---- MODULE MC_diagram ----
EXTENDS Kalaido

mc_Projections == {"P1"}
mc_Reflections == {}
mc_WindowIndices == {}
mc_Fragments == {"F1"}
mc_Colours == {}
mc_ProjDependsOnProj == [p \in {"P1"} |-> {}]
mc_ProjDependsOnRefl == [p \in {"P1"} |-> {}]
mc_ProjContextColours == [p \in {"P1"} |-> {}]
mc_ReflContextColours == [r \in {} |-> {}]
mc_ReflWindowSpecs == [r \in {} |-> [startTime |-> 0, period |-> 10, duration |-> 15]]

\* ---------------------------------------------------------
\* RESTRICTED STATE SPACE FOR DIAGRAM GENERATION
\* ---------------------------------------------------------
\* We define a "VIEW" which tells the model checker to map complex, 
\* highly-detailed states down into simple tuples. TLC will generate 
\* graph nodes based ONLY on this tuple, naturally collapsing the 25 million 
\* states into the exact 3-4 conceptual states we care about.

View == << projStaleness["P1"], projCandidates["P1"].type >>

\* We explicitly restrict the transitions to just the core Lifecycle 
\* so the generated graph focuses only on Candidate Snapshot promotion.
Next_Diag == 
    \/ \E f \in mc_Fragments : IngestFragment(f, 0)
    \/ \E p \in mc_Projections : ProjBackgroundRun(p) 
    \/ \E p \in mc_Projections : ApproveProjCandidate(p)

StateLimit == 
    /\ \A p \in Projections : projSeqNums[p] < 2

====