# Kalaido Domain Model

## Authorization & Scoping

### Kalaidoscope

- Alt names: scope, workspace.
- The top-level entity; container for the project/space/etc.

#### Containment
- Every Fragment, Colour, Projection, Reflection, Lens, Chat, and Refinement Chat belongs to exactly one Kalaidoscope.
- All references are scope-local. A `Context Spec` may not reference Fragments, Colours, Projections, or Reflections belonging to a different Kalaidoscope. There is no cross-scope composition.
- "Whole Scope" selection in a `Context Spec` means the whole of the containing Kalaidoscope.

---

## Inputs & Classification

### Fragment

Immutable source data.

#### Content & Sources
- Currently text only; later may also include images.
- **Fragment Types** (canonical list): email, text message, note, Slack message, WhatsApp message, GitHub commit, document, scraped webpage.

#### Temporal Tracking
- **Import date**: When it entered the scope.
- **Event date**: When the item was created (e.g., for an email = send date). More important than import date, and the date used for all time-window filtering.

#### Immutability Scope
- A Fragment's content, type, import date, and event date are immutable once ingested.
- **Colour assignments are not part of the Fragment record.** They are separate, mutable association records between a Fragment and a Colour. Adding or removing a Colour tag therefore does not violate Fragment immutability.

### Colour

A tag/label that matches a subset of fragments in the scope.

Fragments may match multiple colours.

#### Implementation
In practice, a short LLM prompt that can be applied to a single fragment, and outputs a "yes/no" classification.

#### Lifecycle & Classification Events
- **Ingest**: At ingest time, fragments are classified to see which colour they match.
- **Colour Backfill**: Fragments may retroactively have a colour applied (applied after ingest time, e.g. when creating a new colour).
- **Definition Updates**: Fragments that do not match an existing colour at ingest time will not match the colour later, if/when the colour definition is updated (create a new colour for this use case).
- **Manual Tagging**: Fragments may manually have a colour added or removed after ingest time (e.g., if it was misclassified).
- **Archiving**: Colours can never be deleted outright, only "archived." Archived colours become inactive and cannot be added to or removed from any fragments. This preserves existing tags and avoids triggering massive regeneration of syntheses.

---

## Context & Scoping

### Context Spec

A descriptor for the input into a projection or a reflection.

#### Core Purpose
- A declarative query/specification defining which data sources feed into a Projection or Reflection.
- Stored primarily as a rule-based specification rather than a fixed list of IDs, allowing syntheses to dynamically pull in new matching data over time. A spec **may** additionally pin a set of **Explicit Fragments** by ID; these are a static supplement to the rule-based criteria, not a replacement for them.

#### Scoping Modes
- **Whole Scope**: Automatically selects all current and future fragments within the workspace. Suppresses all fragment-level Filter Criteria (Explicit Fragments, Fragment Types, Colours), but explicit **Source Composition** inputs (Source Projections/Reflections) may still be attached *(for Projections only)*.
- **Filtered Selection**: Selects a targeted subset of fragments based on explicit Filter Criteria.

#### Filter Criteria
- **Explicit Fragments**: A pinned set of individual Fragment IDs, always included regardless of type or colour, **provided the fragment has not been deleted** — deletion removes a fragment from all future context resolution whether it was pinned or matched by rule (see **Deletion & Retention**). Because this set is static, it never grows as new fragments arrive.
- **Fragment Types**: Filters by source types (see the canonical Fragment Types list under **Fragment**).
- **Colours**: Selects fragments matching one or more designated Colour tags.

The resolved fragment set is the **union** of the criteria above.

#### Source Composition & Nesting (Projections Only)
- **Source Projections**: Projections can include output Snapshots from existing Projections as inputs, enabling multi-stage or hierarchical summaries.
- **Source Reflections (`Last N` Rule)**: When a Projection includes a Source Reflection as an input, its `Context Spec` specifies a count parameter $N$. At context resolution time, the system selects the active Reflection Snapshots for up to the **$N$ most recent materialized windows** (ordered by `Resolved Window` time). If $N$ exceeds the total number of materialized windows for that Reflection (e.g., requesting $N=7$ on an Absolute-window Reflection that has only 1 window, or a newly created relative Reflection with fewer than $N$ snapshots), $N$ is automatically **clamped** to the maximum available count ($N_{\text{actual}} = \min(N, \text{materialized\_windows})$). The symbolic value $N=\text{all}$ is treated as an unconstrained maximum lookback.
- **Reflection Input Constraint**: Reflections are strictly restricted to primary fragment-level inputs (Explicit Fragments, Fragment Types, Colours, or Whole Scope). Reflections **cannot** consume Source Projections or Source Reflections, completely eliminating indirect nested temporal loops.

#### Resolution & Staleness Lifecycle
- Evaluated at snapshot generation time to produce a concrete **Resolved Context** (a static, reproducible list of resolved Fragment IDs and source Snapshot IDs).
- Serves as the base dependency definition for tracking when workspace changes invalidate a synthesis (governed by the canonical **Staleness Triggers**).

### Window Spec

A specification defining the temporal boundaries for a Reflection.

#### Core Purpose
- Defines the temporal boundaries used to filter fragments for a **Reflection**.
- Enables time-aware synthesis, allowing reflections to summarize data over moving or fixed timeframes (e.g., daily standups, weekly summaries, project retrospectives).

#### Window Spec Versions
- A Reflection holds an **append-only, ordered list of Window Spec versions**, each carrying an **Effective From** timestamp. Editing a Window Spec appends a new version; it never modifies or deletes an existing one.
- The version **governing** a point in time is the latest whose Effective From is at or before it.
- Because versions are only ever appended and never applied retroactively, no already-generated window's `Resolved Window` can change. Snapshots therefore never lose their correspondence to the grid, and the time series is never invalidated by an edit — it simply changes shape from the Effective From onward.

#### Window Modes
- **Relative (Rolling Window)**: Anchored on a fixed **Start Time** origin and stepped by **Period** to establish a deterministic time-window grid. Grid point $k$ falls at $\text{Start Time} + k \times \text{Period}$ and marks the **end** of window $k$; the window covers a lookback frame of **Duration** ending at that grid point.
- **Absolute (Fixed Window)**: Bound by explicit, fixed start and end timestamps (e.g., "Jan 1, 2024 – Jan 31, 2024"). An Absolute `Window Spec` defines exactly one window.

#### Key Parameters
- **Start Time**: The grid origin (relative mode) or the window's start timestamp (absolute mode).
- **End Time**: The explicit closing timestamp for an **Absolute Window**.
- **Duration**: The lookback length of time covered by a **Relative Window** (e.g., 24 hours, 7 days).
- **Period**: The evaluation recurrence or step interval for periodic reflections (e.g., generating a new candidate snapshot every 24 hours). Relevant only for relative/periodic mode.
- **Effective From**: When this version begins governing. **Never backdated** — it is either the moment of the edit or a user-chosen future date. The first version's Effective From is the Reflection's creation time.

#### Version Boundaries
When a new version's Effective From arrives, the two versions overlap for a bounded interval rather than one cutting the other off:
- **The outgoing version completes every window it has already started, and starts no new ones.** The incoming version begins producing windows immediately from its Effective From.
- No window is ever truncated, re-keyed, or removed. This is what makes edits non-destructive: an in-flight window keeps the exact `Resolved Window` it was generated under, and any pending Candidate Snapshot for it stays valid.
- The overlap lasts as long as the outgoing version has open windows: one **Period** under contiguous tumbling windows (`Duration == Period`), and up to one **Duration** under overlapping windows (`Duration > Period`), where $\lceil \text{Duration} / \text{Period} \rceil$ windows are open at once.
- **Current-window precedence.** While two versions overlap, more than one window can satisfy "the latest grid point at or before now". The current window is the **most recently completed window across every version currently in effect** — the one with the latest end timestamp — and where two such windows share an end timestamp, the one belonging to the **newer version** wins. Without this rule "the current window" is ambiguous exactly when it matters, since it is both the default refinement target and the driver of materialisation.
  - It is specifically *not* "the newest live version's most recent window". Immediately after a new version takes effect it has completed no windows at all, and the current window is still the outgoing version's. Defining it the other way would leave a Reflection with **no** current window across every version boundary — nothing to materialize and no default refinement target — until the incoming version closed its first window.
- **Overlap is temporary but real.** Across a version boundary a fragment may belong to both the outgoing version's closing window and the incoming version's first, *even in a tumbling configuration that otherwise never double-counts*. Anything aggregated across the `Last N` windows — counts, totals, durations — will double-count that fragment once per edit.

#### Mixed Window Shapes Are Expected
A consequence of versioning: a Reflection's time series may contain windows of different lengths and cadences, and adjacent windows may overlap at a version boundary. This is the direct sibling of **Mixed Lens Versions Are Expected**, and the reason every Reflection Snapshot records the **Window Spec version** that produced it alongside its Lens version.

#### Boundary Semantics
- Window boundaries are **half-open**: a fragment belongs to window $w$ if and only if $w.\text{start} \le \text{eventDate} < w.\text{end}$. **Within a single Window Spec version**, this ensures contiguous tumbling windows (`Duration == Period`) never double-count fragments, while naturally allowing fragments to belong to multiple windows in overlapping mode (`Duration > Period`). Across a version boundary the guarantee does not hold — see **Version Boundaries**.
- **First-window truncation**: where a relative window's computed start would fall before **Start Time**, the window is truncated to begin at Start Time.
- **Grid Evaluation**: Grid points at or before **Start Time** are not evaluated (preventing zero-length windows). Windows at grid points in the future relative to now are also not evaluated.

#### Duration vs. Period Relationship
For relative/periodic reflections, the relationship between **Duration** (window length) and **Period** (evaluation cadence) defines the coverage behavior. These hold **within a Window Spec version**; across a version boundary a bounded overlap occurs regardless of mode (see **Version Boundaries**).
- **Overlapping Windows (`Duration > Period`)**: Each evaluated window looks back further than the generation cadence (e.g., a 7-day lookback evaluated every 24 hours). Consecutive snapshots share overlapping input data.
- **Contiguous Tumbling Windows (`Duration == Period`)**: Each window covers the exact elapsed interval since the last evaluation (e.g., a 24-hour lookback evaluated every 24 hours) with no gaps or overlaps.
- **Gapped Windows (`Duration < Period`)**: Windows sample discrete time slices (e.g., a 1-hour lookback evaluated every 24 hours), leaving un-evaluated gaps between snapshots.

#### Materialized Windows
- A window is **materialized** if it has at least one Approved Snapshot, or if it **is or has ever been** the **current window** for this Reflection — that is, if it has been current at any point at or after the Reflection's first Window Spec version's **Effective From**.
  - For **Relative Mode**, the current window is the most recently completed window—the one whose grid point (end time) is the latest at or before now. While two versions overlap, **Current-window precedence** resolves which of them it is.
  - For **Absolute Mode**, the single window defined by each version is always materialized.
- **Materialisation is permanent, without exception.** Once a window is materialized it remains materialized, even as the grid advances past it and even if it never receives an Approved Snapshot. Were materialisation transient, a window that was current while the engine lagged behind the clock would silently drop out of the time series, out of downstream `Last N` resolution, and out of refinement targeting — recoverable only by an explicit Window Backfill. Window Spec edits are not an exception: they append a version rather than re-keying the grid, so no existing window is affected at all.
- Only materialized windows can be flagged stale, appear in a Reflection's time series, or be selected by a downstream `Last N` rule.
- This bounds the system: ingesting a fragment with an Event Date years in the past does not cause the engine to generate snapshots for every intervening grid window. Un-materialized historical windows are generated only on explicit user **Window Backfill** request.
- The bound rests on the **first version's Effective From**. Grid points preceding it were never current *for this Reflection*, so they never become materialized by the clause above, no matter how far back the grid extends. At that moment exactly one historical window is materialized — the most recently completed one, which is current then. Every earlier window stays un-materialized until an explicit **Window Backfill** targets it. Later versions do not re-open this: each governs only from its own Effective From onward.

#### Window Backfill
- A **Window Backfill** is an explicit user operation that targets an un-materialized historical window (or range of windows) on the grid.
- Executing a Window Backfill **materializes** the targeted window(s) — permanently, as with all materialisation — and triggers the background engine to generate a Candidate Snapshot for each, which is then subject to the entity's standard Approval Policy.

#### Evaluation Timestamp & Backdated Fragments
- **Event Date Alignment**: Time window filtering evaluates the **Event Date** of fragments (when the original event occurred, e.g., email send date), rather than their import date.
- **Handling Backdated Fragments**: When historical fragments are ingested with Event Dates falling within the boundaries of **materialized** windows, the system flags all such affected windows as stale, triggering background candidate re-generation for those windows. *(Under overlapping windows (`Duration > Period`), a single backdated fragment may flag multiple overlapping windows; under gapped windows (`Duration < Period`), fragments with Event Dates landing in un-evaluated gaps outside window boundaries do not belong to any window and do not trigger staleness; fragments landing only in un-materialized windows likewise trigger nothing).*

#### Window Spec Edits & Versioning
Reflection Snapshots are uniquely keyed by `Resolved Window`, so re-keying an existing grid would change the identity of every window already generated and detach every snapshot from the series. Editing therefore **appends a version** instead (see *Window Spec Versions*), and the following hold:
- Editing **Start Time**, **Period**, **Duration**, or **End Time** appends a new version with an **Effective From** at or after the moment of the edit. Changing mode (relative ↔ absolute) is an ordinary version append under the same rules.
- **Nothing existing is touched.** Every already-generated window keeps its `Resolved Window`, every Approved Snapshot stays in Snapshot History *and* stays active and eligible for `Last N`, and every pending Candidate Snapshot remains valid. There is no orphaning, no re-keying, and no obsolescence arising from a Window Spec edit.
- The outgoing version finishes its open windows while the incoming version begins — see **Version Boundaries** for the overlap this creates and the precedence rule it requires.
- For **Absolute Mode**, each version defines its own window. Editing an Absolute Window Spec therefore *adds* a window rather than replacing one; the previous window and its snapshots remain materialized and visible, and the Reflection accumulates windows across edits.
- Downstream consumers are **not** flagged at edit time, because at that moment nothing about their resolved context has changed. They are flagged by the **Upstream Window Materialisation** trigger when the incoming version's first window materializes, which is the point at which the `Last N` set actually shifts.

#### Resolution & Engine Behavior
- Evaluated at snapshot generation time to produce a concrete **Resolved Window** with exact start and end timestamps.
- Drives the reflection engine's evaluation loop to identify **Pending Windows** — materialized windows that need snapshot creation or updates as new fragments arrive or time advances.

### Resolved Window

A `Window Spec` evaluated at snapshot generation time into concrete, fixed time boundaries.

#### Core Concept
- The exact, immutable temporal boundary (start and end timestamps) applied when generating a **Reflection Snapshot**.

#### Evaluation Rules
Evaluated against the **Window Spec version governing** the window being generated — the latest version whose **Effective From** is at or before it (see *Window Spec Versions*).
- **Absolute Mode**: Uses the explicit fixed start and end timestamps defined in that version.
- **Relative Mode**: Takes grid point $k$ ($\text{Start Time} + k \times \text{Period}$) of that version as the window end and subtracts its **Duration** to compute the start, truncating at Start Time where necessary. This deterministic grid ensures that delayed engine runs or backdated fragments identify exact pending windows without shifting window boundaries.
- Because versions are appended and never applied retroactively, re-evaluating any historical window always selects the same governing version and therefore yields the same boundaries.

#### Role in Snapshot Immutability
- Stored as a distinct field on the **Reflection Snapshot** alongside `Resolved Context`.
- Guarantees that historical Reflection Snapshots retain the exact time boundaries under which they were generated, even as time advances or the `Window Spec` is edited. Under versioning this is doubly assured: an edit appends a version rather than re-keying the grid, so a historical window's boundaries are never recomputed in the first place.

### Resolved Context

A declarative `Context Spec` evaluated at a specific moment in time into an immutable, concrete set of input references.

#### Core Concept
- The static, fully resolved list of input references used when generating any Snapshot — whether by applying a `Lens` (Candidate Snapshots) or by an interactive Refinement Chat turn (Preview Snapshots).
- Translates abstract declarative rules (explicit fragments, colours, fragment types, source projections/reflections) into concrete IDs.

#### Reproducibility & Snapshot Binding
- Resolves nested source Projections and Reflections to their specific approved **Snapshot IDs** (rather than living container IDs).
- Pointing to specific Snapshot IDs guarantees complete reproducibility: re-evaluating a Snapshot's context will always yield the exact same input data.

#### Resolution Factors
- **Fragment Resolution**: Maps `Context Spec` criteria (explicit fragment IDs, types, colours, whole scope) to a concrete set of Fragment IDs.
- **Source Projection Resolution**: For Source Projections, locks to the single active (latest-approved) Snapshot ID at generation time.
- **Source Reflection Resolution (`Last N` Rule)**: For Source Reflections, evaluates the `Last N` rule against the Reflection's time series to select the active Reflection Snapshots corresponding to up to the **$N$ most recent materialized windows** (clamping $N$ to the materialized window count, ordered by `Resolved Window` time, rather than approval order).

---

## Synthesized Views

Synthesized views (Projections and Reflections) represent living, user-facing containers built over dynamic data streams. To balance background automation with user control and composition stability, synthesized views manage outputs through a formal Snapshot lifecycle and approval policy.

### Core Concept: Staleness Target

Staleness, candidate queueing, and active-snapshot resolution operate on a **Staleness Target**:
- For a **Projection**, the target is the entity itself.
- For a **Reflection**, the target is an individual **window** ($t$).

A Reflection therefore maintains a *set* of stale windows and queued candidates rather than a single entity-level state.

### Snapshot Lifecycle & Approval Policies

#### Snapshot States
- **Preview Snapshot (Interactive / Ephemeral)**: Generated dynamically on-the-fly during Creation or Refinement Chat workflows. Created from a **`Resolved Context` + `Refinement Chat` history** (plus a **`Resolved Window`** for Reflections), representing a proposed prompt iteration before a new or updated `Lens` is compiled upon approval. Serves as a live draft preview for user critique and iteration.
- **Candidate Snapshot (Pending)**: Generated by the background engine, without user request, for a Staleness Target that has become stale or whose time window has elapsed. Becoming stale makes a target *eligible* for generation rather than causing it — see **Engine Execution & Liveness**. Created by executing an existing, compiled **`Lens`** against an updated **`Resolved Context`** (plus a **`Resolved Window`** for Reflections). Represents a proposed output state awaiting approval policy evaluation.
- **Retired Candidate Snapshot (Read-Only)**: A candidate that was removed from the pending queue before being reviewed. Candidates are retired in two ways: they are **replaced** when a newer background run produces a fresher candidate for the same Staleness Target, or marked **obsolete** when the specification they were generated under (`Context Spec` or `Lens`) changes. Retired candidates are moved to the entity's **Candidate Execution Log**, where they are locked as read-only execution records for auditability. They cannot be promoted to Approved Snapshots.
- **Approved Snapshot (Published / Immutable)**: An official, immutable point-in-time output state. Promoted from a Preview Snapshot upon user approval (which distills the chat history into a new Lens) or from a Candidate Snapshot via the entity's Approval Policy. Records an explicit **approval timestamp**, and an **approval sequence number** that is unique and monotonically increasing per Staleness Target. The sequence number, not the wall-clock timestamp, defines approval order; the timestamp is retained for display and audit only. Only Approved Snapshots are published for primary user viewing and available for composition into downstream syntheses. An Approved Snapshot becomes **superseded** when an Approved Snapshot with a higher approval sequence number is published for the same target; supersession is a derived, query-time property, not a stored flag.

#### Approval Policies
Synthesized views govern the transition from Candidate to Approved Snapshot through an **Approval Policy**:
- **Manual Approval (Human Gate)**: The engine automatically pre-computes Candidate Snapshots and places them in the pending queue for review. A candidate becomes an Approved Snapshot only when explicitly reviewed and approved by a user. *(Default for Projections)*.
- **Automatic Approval (Unattended / Continuous)**: The engine promotes each Candidate Snapshot to an Approved Snapshot as soon as generation completes, without requiring human intervention. Under this policy candidates are transient and are never held in the pending queue; the queue is therefore always empty. *(Default for Reflections)*.

#### Composition Rule
- Nested Projections and Reflections never reference living containers, ephemeral Preview Snapshots, or unapproved Candidate Snapshots — they bind strictly to published **Approved Snapshots**.

#### Active Snapshot Resolution Rule
- **No Mutable Active Flag**: "Active" status (and conversely, **supersession**) is not stored as a mutable state flag on snapshot records; snapshot history is an immutable, append-only list of published Approved Snapshots.
- **Query-Time Derivation**: The "active" (canonical) snapshot is derived dynamically at query or resolution time based on approval sequence numbers:
  - **Projections**: The active snapshot is the snapshot with the highest approval sequence number.
  - **Reflections**: Snapshots are grouped by their `Resolved Window` ($t$). The active snapshot for a window $t$ is the snapshot with the highest approval sequence number for that specific window. A Window Spec edit never removes a window from resolution — it appends a version rather than re-keying the grid (see **Window Spec Edits & Versioning**).
  - Because approval sequence numbers are unique per Staleness Target, exactly one snapshot is active for a Projection, and exactly one for each window of a Reflection. Wall-clock approval timestamps are **not** used for this derivation: they are not guaranteed unique (a batched operation such as a multi-window Window Backfill under Automatic Approval may approve several snapshots at one instant) and not guaranteed to increase in approval order.
- **Preservation of History**: **Superseded** snapshots ($R_t$) remain permanently in the entity's append-only snapshot history for auditability and lineage, but are bypassed in favor of the active snapshot ($R'_t$) during primary viewing and downstream `Last N` resolution.

#### Refinement Approval & Candidate Retirement Rules
- **Target Window (Reflections)**: A refinement always names a **target window**. If the user does not explicitly select one, the target defaults to the **current materialized window** (the most recently completed grid point for relative, or the fixed window for absolute), whether or not that window already has an Approved Snapshot. Users may explicitly target any materialized window, including a historical one, and including windows generated under an earlier Window Spec version.
- **Refinement Approval Supercession**: Approving a Preview Snapshot during refinement of an existing Projection or Reflection distills a new Lens and promotes the refined preview into a new Approved Snapshot for that entity (or target window $t$), which becomes active and thereby supersedes the previously active Approved Snapshot for that target.
- **Obsolete Candidate Retirement (Specification Edits)**: When a user modifies an entity's `Context Spec`, or approves a Refinement Chat that distills an updated `Lens`, any unapproved Candidate Snapshots in the pending queue were generated under an earlier specification and are automatically marked **obsolete** and retired to the Candidate Execution Log. *(A `Window Spec` edit does **not** obsolete candidates: it appends a version rather than altering any existing window, so a queued candidate is still valid for the window it was generated against — see **Window Spec Edits & Versioning**.)*
- **Candidate Queue Replacement (Context Updates)**: To prevent approving stale outputs, a synthesis never maintains a backlog of unapproved Candidate Snapshots for the same **Staleness Target**. When the background engine generates a new Candidate Snapshot ($C_2$), it **replaces** any unapproved Candidate Snapshot ($C_1$) currently in the pending queue for that target, retiring $C_1$ to the Candidate Execution Log.
- **Latest Candidate Approval Restriction**: Users can only review and promote the **latest** Candidate Snapshot ($C_{\text{latest}}$) for a Staleness Target. Retired candidates cannot be approved, ensuring that any promoted Approved Snapshot reflects the latest resolved context available at generation time.
- **Cascading Interaction (Manual Projection over Auto Reflection)**: When a Manual-Approval Projection consumes a periodic Automatic-Approval Reflection (e.g., daily standup), each new Reflection period generates a fresh Candidate Snapshot for the Projection that replaces the previous pending candidate. The user always sees a single review item representing the latest proposed state, eliminating candidate backlog clutter.
- **Generation Provenance (Chat vs. Lens Execution)**: To maintain precise provenance across interactive draft previews and automated background recalculations, every Snapshot explicitly records its **Generation Source**:
  - **Chat Provenance (`generation_source: refinement_chat`)**: When an Approved Snapshot is promoted from a Preview Snapshot (during initial creation or interactive refinement), its Artifact was generated directly via interactive Refinement Chat turns. The snapshot records the distilled `Lens` ID for future background executions, but explicitly marks its Artifact's origin as the Refinement Chat.
  - **Lens Provenance (`generation_source: lens_execution`)**: When an Approved Snapshot is promoted from a Candidate Snapshot generated by the background engine, its Artifact was produced by executing a compiled `Lens` against a `Resolved Context`.

### Staleness & Dependency Management

Synthesized views are living entities whose underlying input data continuously evolves. The system maintains consistency and determinism across nested syntheses using a formal staleness and dependency model.

#### Staleness Triggers
A Staleness Target is flagged as **stale** (requiring background re-evaluation) when triggered by any of the following events:
- **Fragment Ingestion**: A new fragment enters the scope matching the entity's `Context Spec` (by explicit fragment ID, fragment type, colour tag, or whole-scope selection). For a Reflection, the fragment flags **every materialized window whose temporal boundaries cover its Event Date**. *(If a fragment's Event Date lands in an un-evaluated gap between windows under `Duration < Period`, or falls only within un-materialized windows, it flags nothing).*
- **Colour Tagging & Colour Backfills**: A Colour tag is created (triggering retroactive **Colour Backfill** classification), or a Colour tag is manually added or removed on fragments. *(Updating an existing Colour definition does not re-evaluate past fragments or trigger staleness).*
- **Fragment Deletion**: A fragment the entity's `Context Spec` resolved to is deleted. For a Reflection, this flags **every materialized window whose temporal boundaries cover its Event Date**. The fragment leaves all future context resolution — pinned or matched by rule — while remaining in historical `Resolved Context` records as a tombstone (see **Deletion & Retention**).
- **Upstream Synthesis Approval**: An upstream source Projection or Reflection publishes a new Approved Snapshot **that changes the downstream entity's resolvable context**. Specifically:
  - For a **Source Projection**, any new Approved Snapshot changes the active snapshot and therefore always flags the downstream Projection.
  - For a **Source Reflection**, the downstream Projection is flagged only if the new snapshot enters that Projection's `Last N` set: i.e. it is published for a **newer** window, or it is published for a window **already inside** the $N$-set — whether or not it displaces an existing active snapshot there. A window inside the $N$-set receiving its *first* Approved Snapshot changes the downstream `Resolved Context` just as much as one whose snapshot is superseded, and flags the same. A new snapshot for an older window that falls outside the $N$-set changes nothing downstream and does not flag it.
- **Temporal Advancement (Reflections)**: The passage of time advances the window grid, materializing a new current window that has no snapshot yet.
- **Upstream Window Materialisation**: a Source Reflection materializes a window — through **Temporal Advancement** of its grid, or an explicit **Window Backfill** — and this changes the *membership* of a consuming Projection's `Last N` set, flagging that Projection even though no snapshot was published. A `Last N` set is rolling: once $N$ windows are materialized, each newly materialized window displaces the oldest, removing that window's snapshot from the Projection's `Resolved Context`.
  - Under **Automatic Approval** (the Reflection default) this trigger is a tightening, not a necessity. The newly materialized window is published almost at once, and that publication already flags the consumer via **Upstream Synthesis Approval**; the trigger only closes the interval between materialisation and publication.
  - Under **Manual Approval** it is load-bearing. The candidate for the new window may never be approved, so no publication ever occurs — yet the displacement has already happened, and without this trigger the consuming Projection is never flagged at all.
- **Specification Edits**: A user modifies an entity's `Context Spec`. *(A `Window Spec` edit is **not** a staleness trigger: it appends a version effective from now onward and leaves every existing window's `Resolved Window` and inputs untouched, so no existing target has become stale. The new version's first window enters the series through **Temporal Advancement** when it materializes. Approving a Refinement Chat that distills a new `Lens` is likewise **not** a staleness trigger — the refinement itself publishes a fresh Approved Snapshot for its target, so the target is by definition not stale. Lens distillation does retire obsolete candidates, and for a Reflection it leaves any **other** already-stale windows stale, to be regenerated under the new Current Lens.)*

#### Dependency Graph & Cascading Updates
- **Directed Acyclic Graph (DAG)**: Nested syntheses form a directed dependency graph. Circular references are strictly prohibited. Because Reflections are leaf-only, the only cycles structurally possible are Projection → Projection, and these are rejected at spec-edit time.
- **Reflection Input Restriction**: Reflections serve as primary/leaf nodes in the dependency graph, consuming inputs exclusively from primary fragment-level inputs (Explicit Fragments, Fragment Types, Colours, or Whole Scope). Only Projections can consume upstream Projections or Reflections.
- **Snapshot-Level Isolation**: Downstream syntheses bind strictly to specific **Approved Snapshots** of upstream sources. An upstream entity becoming stale does not affect downstream entities until that upstream entity publishes a new Approved Snapshot.
- **Cascading Staleness**: When an upstream entity publishes a new Approved Snapshot, staleness propagates downstream along the dependency graph to each dependent synthesis whose resolvable context is changed by that publication, per the **Upstream Synthesis Approval** trigger above. Propagation continues transitively as each affected downstream entity publishes in turn.

#### Active View Stability
- **Non-Destructive Staleness**: Flagging a target as stale does not invalidate, replace, or obscure its active **Approved Snapshot** (for a Reflection, the active approved snapshot for each window remains viewable). Users continue to view the last approved output without disruption.
- **Background Recalculation**: Staleness acts as an instruction for the background engine to re-evaluate the **Current Lens** against the updated `Resolved Context` (and `Resolved Window`), producing a new **Candidate Snapshot**. It is an instruction, not a schedule — see **Engine Execution & Liveness** for what causes it to be acted on.

#### Resolution of Staleness
Staleness is cleared **per Staleness Target** (the Projection, or the individual Reflection window) by either of the two paths that produce a new active Approved Snapshot:
- **Background path**: the engine generates a Candidate Snapshot and it is promoted to an Approved Snapshot, via manual user review or automatic policy.
- **Interactive path**: the user approves a Preview Snapshot in a Refinement Chat targeting that Projection or window, promoting it directly to an Approved Snapshot.

Clearing one Reflection window's staleness has no effect on other stale windows of the same Reflection.

See **Engine Execution & Liveness** for what causes the background path to run at all.

#### Engine Execution & Liveness

Staleness is a durable flag, not a schedule. This model specifies *what* becomes stale and *what* re-evaluating it produces; it does not specify anything that makes re-evaluation happen.

- **Nothing self-starts.** The system exposes the current set of stale Staleness Targets. An **external driver** reads that set and triggers regeneration through the ordinary flows described above. *(In deployment this is a scheduled job or the UI polling for stale state — a non-normative detail; the model requires only that some driver exists outside it.)*
- **Liveness is a property of the deployment, not of this model.** An unpolled workspace never progresses: stale targets stay stale, candidates are never generated, and windows that have materialized never receive a snapshot. Nothing in this document should be read as promising that the engine eventually runs.
- **Degradation is graceful, not incorrect.** By **Non-Destructive Staleness**, an unpolled workspace continues serving the last Approved Snapshot for every target. Stalling costs freshness, never correctness or consistency.
- **The driver triggers generation only, never approval.** It causes Candidate Snapshots to be produced; what happens to them is governed solely by the target's **Approval Policy**. An external driver must never be able to promote a candidate, or Manual Approval would cease to be a human gate.
- **Context is resolved at generation time, not at poll time.** A target observed stale by the driver and regenerated a moment later resolves its `Context Spec` against the *later* state (per **Resolution & Staleness Lifecycle**). Anything that arrived in the interval is therefore included in the resulting snapshot rather than lost, and the staleness it caused is legitimately cleared by that snapshot.
- **Overlapping runs are safe.** Two drivers, or a run overlapping its predecessor, may generate more than one Candidate Snapshot for the same Staleness Target. **Candidate Queue Replacement** already governs this: the newer candidate replaces the older, which retires to the **Candidate Execution Log**. No backlog accumulates and no candidate is approved twice.
- **Approvals for one target must be serialised.** The **approval sequence number** is required to be unique and monotonically increasing per Staleness Target. Under an external driver that is a genuine constraint on the implementation rather than a free property: concurrent approvals for the *same* target must not be permitted. Targets are independent of one another and may proceed concurrently.

### Projection

A user-facing synthesis defined by a Context Spec.

#### Core Concept & Purpose
- A living, user-facing synthesized view defined by a `Context Spec` (which resolves to a concrete `Resolved Context` at snapshot generation time).
- Conceptually, a projection changes every time a new fragment comes into its context spec.
- To make them usable and allow composition, users only ever view a Snapshot of a projection.
- The Projection entity itself is better thought of as a container for a set of snapshots and the entities that created them.

#### Anatomy & State
In practice, a container holding:
- **Descriptor / Context Spec**: The selection rules defining explicit fragments, fragment types, colours, source projections, or source reflections.
- **Current Lens**: The active prompt template generating the output synthesis.
- **Snapshot History**: A timestamped, append-only list of published **Approved Snapshots**.
- **Pending Candidates**: A queue holding at most one unapproved **Candidate Snapshot** awaiting manual review. *(When a newer background run completes, the older unapproved candidate is replaced and retired to the Candidate Execution Log).*
- **Candidate Execution Log**: A read-only, append-only record of retired (replaced or obsolete) Candidate Snapshots, kept for auditability.
- **Stale Flag**: Whether the entity currently requires background re-evaluation.
- **Approval Policy**: Governs candidate approval behavior (defaults to **Manual Approval**).
- **Metadata**: User preferences. **Pinning status** marks a synthesis for prominent placement in the user's workspace view; it is presentation-only and has no effect on generation, staleness, or composition.

#### Creation Workflow
1. **Context Selection**: User defines input sources (`Context Spec`: selecting explicit fragments, fragment types, colours, source projections, or source reflections with `Last N` parameters).
2. **Interactive Refinement Chat**: User engages in an interactive Refinement Chat with the LLM to describe the desired output synthesis format, tone, and structure.
3. **Preview Snapshot Generation**: An ephemeral Preview Snapshot is generated dynamically from the context and chat history for user review.
4. **Approval & Snapshot Creation**: When happy, the user approves the Preview Snapshot. The system distills the chat conversation into a formal Lens and promotes the preview into the initial Approved Projection Snapshot.

#### Refinement & Versioning
- **Lens Distillation**: Interactive refinement chats distill user feedback into updated Lens prompts.
- **Lens Lineage**: Each new Lens maintains a reference to its parent Lens and the refinement conversation that created it.
- **Context Tweaking**: Users can refine the underlying `Context Spec` over time (e.g., modifying colour tags or fragment types). This flags the Projection stale.

#### Projection Snapshot
- An immutable point-in-time record representing an approved synthesis state.
- Captures the exact combination of the generated **Artifact**, Lens version, Resolved Context, model provenance, token consumption metrics, generation timestamp, **approval timestamp**, **approval sequence number**, and **Generation Source** (`refinement_chat` vs. `lens_execution`).

### Reflection

A time-bounded, user-facing synthesis defined by a Context Spec and a Window Spec.

#### Core Concept & Purpose
- A living, time-bounded synthesized view defined by a `Context Spec` and a `Window Spec`.
- Conceptually, a reflection changes as new fragments arrive within its time boundary or as time advances (for relative/rolling windows).
- To maintain stability and enable composition, users only ever view a **Reflection Snapshot** representing a specific resolved time period.
- The Reflection entity itself is a container holding its context rules, window configuration, snapshot history, and creation entities.

#### Anatomy & State
In practice, a container holding:
- **Descriptor / Context Spec**: The selection rules defining explicit fragments, fragment types, colours, or whole scope. *(Reflections cannot consume source projections or reflections).*
- **Window Spec Versions**: An append-only, ordered list of Window Spec versions defining the time window (relative rolling vs. fixed absolute, duration, period cadence), each with an **Effective From**. The first version's Effective From is the Reflection's creation time, and it bounds which historical windows can ever become materialized (see **Materialized Windows**); grid points before it were never current for this Reflection.
- **Current Lens**: The active prompt template generating the output synthesis.
- **Snapshot History**: A timestamped, append-only list of published **Approved Snapshots**, each keyed by `Resolved Window`.
- **Pending Candidates**: A queue holding at most one unapproved **Candidate Snapshot** per window $t$, populated only when the Reflection's Approval Policy is Manual Approval. *(When a newer background run completes for window $t$, the older unapproved candidate for that window is replaced and retired; pending windows are computed dynamically from the window grid by the background engine).*
- **Candidate Execution Log**: A read-only, append-only record of retired (replaced or obsolete) Candidate Snapshots, kept for auditability.
- **Stale Windows**: The set of materialized windows currently requiring background re-evaluation.
- **Approval Policy**: Governs candidate approval behavior (defaults to **Automatic Approval**).
- **Metadata**: User preferences such as pinning status (see **Projection → Anatomy & State**).

#### Creation Workflow
1. **Context & Window Selection**: User defines input sources (`Context Spec`) and time bounds (`Window Spec`, e.g., "past 7 days", "daily standup").
2. **Interactive Refinement Chat**: User engages in an interactive Refinement Chat with the LLM to describe the desired synthesis format, tone, and temporal focus.
3. **Preview Snapshot Generation**: An ephemeral Preview Snapshot is generated dynamically for the target window (by default the current materialized window) and chat history.
4. **Approval & Snapshot Creation**: When happy, the user approves the Preview Snapshot. The system distills the chat conversation into a formal Lens and promotes the preview into the initial Approved Reflection Snapshot.

#### Refinement & Versioning
- **Lens Distillation**: Interactive refinement chats distill user feedback into updated Lens prompts.
- **Lens Lineage**: Each new Lens maintains a reference to its parent Lens and refinement conversation.
- **Forward-Only Lens Scope Rule**: A newly distilled Lens becomes the **Current Lens** and applies to **all evaluations performed from that moment onward** — not to a range of windows. Concretely: the target window receives the approved preview immediately, and any window subsequently regenerated for an independent reason (a backdated fragment, an explicit backfill, time advancing) is generated under the Current Lens at that time. A Lens update **never** by itself triggers regeneration of any window other than its target. Historical Reflection Snapshots generated under prior Lenses remain permanently intact in the time series.
- **Mixed Lens Versions Are Expected**: A consequence of the rule above is that a Reflection's time series may contain snapshots produced under different Lens versions in non-monotonic order. This is why every Reflection Snapshot records its Lens version.
- **Window & Context Adjustment**: Users can refine either the underlying `Context Spec` or the `Window Spec` parameters over time. See **Window Spec Edits & Versioning** for the consequences of the latter.

#### Time Series, Window Supercession & Downstream Mapping
- **Time Series Output**: A Reflection produces a time series of **Reflection Snapshots**, where each snapshot is uniquely keyed by its **Resolved Window** ($t$).
- **Window Supercession**: Re-evaluating a materialized window $t$ — because of backdated fragments, an explicit backfill, or a refinement explicitly targeting $t$ — produces a new Approved Snapshot $R'_t$ with a higher approval sequence number. Under the **Active Snapshot Resolution Rule**, $R'_t$ dynamically supersedes $R_t$ for window $t$ at query time, while $R_t$ remains preserved in history.
- **Downstream `Last N` Resolution**: When a Projection consumes a Reflection using the `Last N` rule, its `Resolved Context` resolves to the active Reflection Snapshots for up to the $N$ most recent materialized windows (clamping $N$ to the materialized window count, ordered by `Resolved Window` time, selecting the highest approval sequence number for each window). The consuming Projection is flagged stale when a snapshot is published for a window inside its current $N$-set (superseding an existing snapshot or not), when a snapshot is published for a newer window, or when the membership of the $N$-set itself changes because a window materialized upstream; see the **Upstream Synthesis Approval** and **Upstream Window Materialisation** triggers.

#### Reflection Snapshot
- An immutable point-in-time record representing an approved synthesis state for a specific time window.
- Captures the exact combination of the generated **Artifact**, Lens version, **Window Spec version**, **Resolved Context**, **Resolved Window**, model provenance, token consumption metrics, generation timestamp, **approval timestamp**, **approval sequence number**, and **Generation Source** (`refinement_chat` vs. `lens_execution`).

---

## Internal Entities

### Lens

An internal LLM prompt template that transforms a Resolved Context (and Resolved Window for Reflections) into an output Artifact.

#### Core Concept
- An LLM instruction prompt that takes a Resolved Context (and temporal bounds) and generates a synthesized Artifact.

#### System-Managed & Hidden
- Users never write or edit Lens prompts directly; the system distills user feedback from Refinement Chats into structured Lens prompts.

#### Lineage & Evolution
- Tracks prompt evolution via a parent Lens reference, maintaining a version tree of how instructions evolve across iterations. The initial Lens created during entity creation serves as the root of the tree and has no parent Lens.
- Lenses are immutable once compiled; refinement produces a new child Lens rather than mutating an existing one.

#### Provenance
- Stores model metadata and references the specific refinement conversation that produced it.

### Artifact

The raw text content produced by executing a Lens against a Resolved Context (and Resolved Window) or generated directly during an interactive Refinement Chat session.

#### Core Concept
- The fundamental unit of LLM-generated content.

#### Containment in Snapshots
- Artifacts represent the generated content itself; they are contained within Projection and Reflection Snapshots alongside execution provenance rather than exposed directly to users as standalone entities.

#### Immutability
- Once generated and bound to a Snapshot, an Artifact is strictly immutable text content. *(Execution provenance, token consumption metrics, and model parameters are captured at the Snapshot level).*

### Chat

A general-purpose conversational LLM session within Kalaidoscope.

#### Structure & Messages
- Composed of a conversation container holding an ordered series of user and assistant turns.

#### State & Tracking
- Tracks conversation IDs, model parameters, and message turn history.

### Refinement Chat

A specialized, context-aware chat session bound to a Projection or Reflection flow.

#### Purpose & Workflow
- Used interactively by the user during both initial entity creation and subsequent snapshot refinement to describe desired output formats, request changes, or critique draft preview outputs.
- For Reflections, a Refinement Chat is bound to a specific **target window** (defaulting to the current window on the grid).

#### Distillation & Lens Generation
- When the user approves a preview, the Refinement Chat triggers prompt distillation, generating a new `Lens` from the conversation history.

#### Snapshot Linkage
- Persistently links the conversation history directly to the resulting Projection or Reflection and approved Snapshot.

## Deletion & Retention

- **Fragment deletion**: Removes the fragment from all future context resolution and flags every entity whose `Context Spec` matched it (for Reflections, every materialized window covering its Event Date). Existing Approved Snapshots are never rewritten; their `Resolved Context` retains the deleted Fragment ID as a dangling historical reference, marked as deleted for audit purposes.
- **Colour Archiving (No Outright Deletion)**: Colours can never be deleted outright; they can only be "archived." Archiving a Colour makes it inactive (preventing it from being added to or removed from any fragments moving forward) while preserving all existing fragment associations. This design avoids retriggering a massive wave of staleness and regeneration for all entities whose `Context Spec` referenced the Colour. The archived Colour continues to resolve normally for any existing syntheses that depend on it until users explicitly remove it from their specs.
- **Projection / Reflection deletion**: Prohibited while any other synthesis depends on it. The user must first remove the dependency from every downstream `Context Spec`. On deletion, the container and its snapshot history are retired together; downstream binding is impossible by the preceding rule, so no dangling snapshot references can result.
- **Lens deletion**: Not offered. Lenses are immutable version-tree nodes referenced by historical snapshots.