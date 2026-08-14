---- MODULE MC ----
EXTENDS Kalaido

mc_Projections == {"P1"}
mc_Reflections == {"R1"}
mc_WindowIndices == {1, 2}
mc_Fragments == {"F1", "F2"}
mc_Colours == {"C1"}

mc_ProjDependsOnProj == [p \in {"P1"} |-> {}]
mc_ProjDependsOnRefl == [p \in {"P1"} |-> {"R1"}]

mc_ProjContextColours == [p \in {"P1"} |-> {"C1"}]
mc_ReflContextColours == [r \in {"R1"} |-> {"C1"}]

\* R1 Configuration: Overlapping Windows
\* Start Time = 0
\* Period = 10 (Grid updates every 10 units)
\* Duration = 15 (Each window looks back 15 units)
\* Event Date of 5 triggers Window 1 [0, 10) AND Window 2 [5, 20)
mc_ReflWindowSpecs == [r \in {"R1"} |-> [startTime |-> 0, period |-> 10, duration |-> 15]]

StateLimit == 
    /\ \A p \in Projections : projSeqNums[p] < 3
    /\ \A r \in Reflections, k \in WindowIndices : reflSeqNums[r][k] < 3
    /\ \A f \in Fragments : fragEventDate[f] < 25

====