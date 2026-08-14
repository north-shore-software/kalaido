# Working in `.agents/spec/`

This directory holds the Kalaido domain specification and two formal models of it.
Read this before touching anything here.

```
model.md              the prose specification — the source of truth
alloy/*.als           7 Alloy modules: relational structure
tla/*.tla, *.cfg      TLA+ modules: arithmetic, liveness, the refinement lifecycle
tla/tla.sh            the TLA+ harness (check / autodiagram / viz / clean)
```

**`model.md` is the deliverable. The models exist to find defects in it.** They are not
the product, they are not a build artifact, and they are not authoritative. When a model
and `model.md` disagree, that is a finding to be reported, not a bug to be quietly
patched in whichever file is easier to edit.

---

## 1. The one rule that matters most

**Never edit `model.md` from a model result without the user approving the wording first.**

Every change to `model.md` in this directory's history was proposed as wording, reviewed,
and only then applied. That is deliberate. A model can tell you two sentences disagree; it
cannot tell you which one the product is supposed to honour. That is the user's call, and
they have overruled proposed answers before.

Work in **small reviewable slices** — one module or one property group at a time, then
stop and report. The user has said explicitly that they cannot review a large drop.

---

## 2. What is here and what state it is in

### `model.md`

~445 lines, ~86 sections. Ordinary prose with a few LaTeX expressions. Covers
Kalaidoscopes, Fragments, Colours, Context Specs, Window Specs, Projections, Reflections,
Snapshots, Lenses, staleness and the dependency graph.

### `alloy/` — relational structure

| module | subject | gates | checks |
|---|---|---|---|
| `core.als` | snapshot lifecycle over an abstract `Target` | 3 | 5 |
| `projection.als` | `Projection extends Target` | 2 | 5 |
| `window.als` | versioned window grid, materialisation | 3 | 4 |
| `reflection.als` | `Last N`, upstream staleness | 6 | 3 |
| `context.als` | scope, fragments, colours, Context Spec resolution | 4 | 7 |
| `dag.als` | Projection→Projection composition, cascading staleness | 3 | 5 |
| `composite.als` | one Projection with all three input kinds at once | 5 | 3 |

All passing as of the last run. **No Alloy jar is committed** — download Alloy 6 and run
each module separately (see §5).

### `tla/` — arithmetic, liveness, refinement lifecycle

| module | subject | status |
|---|---|---|
| `Grid.tla` + `MC_grid` | relative-mode window grid coverage | complete, passing |
| `Lifecycle.tla` + `MC_lifecycle` | snapshot lifecycle incl. Preview / refinement | complete, passing |
| `MC_diag_proj`, `MC_diag_refl` | derived state machine diagrams | complete |
| `Kalaido.tla`, `MC`, `MC_diagram` | **legacy draft — do not extend** | see §7 |

---

## 3. The division of labour, and why

Alloy and TLA+ cover **disjoint** ground. Nothing is verified in both. If you find
yourself modelling something in one that the other already covers, stop.

**Alloy owns relational structure**: set-valued resolution, transitive closure
(`^` for DAG acyclicity is one line), "does any state exist where X", subtyping.
Its `Int` is bit-bounded and it has no clock, so it cannot express arithmetic.

**TLA+ owns three things Alloy structurally cannot reach:**

1. **Integer arithmetic over the window grid.** `window.als` models grid points as an
   abstract `util/ordering`, so it can say "window A ends before window B" but has nothing
   to say about coverage. `Grid.tla` checks the quantitative claims.
2. **Liveness under fairness.** `dag.als` states outright that cascade termination is
   "unstatable here rather than false", and `reflection.als` carries `engineIsLive` as a
   named *assumption* that two of its results are conditioned on.
3. **The half of the snapshot lifecycle Alloy never modelled.** `core.als` has only
   `generate` and `approve` — no Preview Snapshots, no interactive Refinement path, no
   obsolete-candidate retirement on a spec edit. `Lifecycle.tla` covers those.

---

## 4. Discipline — follow all of this

These exist because each one caught a real error, several of them mine.

### 4.1 A green run proves nothing until you have gated it

The failure mode is not a check that fails. It is a check that passes for the wrong
reason. This has happened here more than once:

- `composite.als` once ran fully green with **two-thirds of its intended state space
  empty**: `Target` scope 2 was consumed by two Projections, leaving zero Windows, so
  `resolved[SourceReflection]` was permanently empty. It was about to be reported as
  "the Source Reflection trigger clause is redundant, consider simplifying it".
- A diagram was generated showing `Preview (stale) --ApprovePreview--> Idle`, the exact
  opposite of the rule it was supposed to illustrate.

So, before reading any result:

- **Alloy**: every module carries `run` commands that must produce non-empty instances.
  If a gate is UNSAT, every `check` in that file is vacuous and worthless.
- **TLA+**: use `ASSUME` for parameter-space coverage (checked at startup — the cheapest
  possible gate; see `Grid.tla`), and `-coverage 5` for per-action state counts. If an
  action shows zero, every property about it passed for want of a subject.
  `MC_lifecycle.tla`'s header records the expected counts; re-run coverage whenever you
  add an action or tighten a guard.

### 4.2 Label every property GUARD or CONTENT

A hand-written module cannot produce many non-tautological invariants about its own
actions. An invariant restating what an action's update clause already says is
construction-true and can never fail.

The previous TLA+ draft's **entire** `PROPERTY` list was of this kind — five properties,
each asserting something its own action definition supplied as a conjunct
(`Diagram_ArchivedFrozen` asserts `TagFragment(f,c) => colArchived[c] = FALSE`, and
`TagFragment` has exactly that as a guard). A 25-million-state exhaustive run verified
almost nothing.

Content arises only where **two independently written rules of `model.md` must agree**.
Label each property in a comment: `GUARD` (construction-true, kept as a regression
tripwire) or `CONTENT` (crosses two rules, can genuinely fail). Do not dress a guard up
as a finding.

### 4.3 Mutation-test anything that passes first time

If a property passes on its first run you have learned nothing about whether it can fail.
Break one rule at a time and confirm the expected property fires. `Grid.tla`'s header
carries the resulting table — which mutation is caught by which property. Keep it current.
Two of its properties are absent from that table and are labelled `GUARD` for that reason.

### 4.4 Isolate before you report

A failing check is a hypothesis, not a finding. Add or remove exactly **one** fact or
conjunct and confirm the result flips. This step changed the diagnosis three times:
twice the failure was an under-constraint in the model rather than a defect in `model.md`,
and once an assertion was simply wrong (it quantified over a single source when a
Projection may have several).

### 4.5 Transcribe literally, including disagreements

Where two sections of `model.md` conflict, encode **both** and let the check decide.
Reconciling them while transcribing hides exactly the thing the check exists to find.
That is how the explicit-pins-vs-deletion contradiction surfaced.

### 4.6 Report bounds honestly

Every result here is bounded: "no counterexample at scope 3 over ≤8 steps", or "48
parameter triples". That is evidence, not proof. Say so. Do not write "verified",
"proven", or "mathematically guaranteed" — a previous summary in this project claimed
"cascading staleness verified" when no such invariant existed in the config at all.

### 4.7 The blind spot you cannot gate away

There is **no mechanical link** between `model.md` and either model. The `.als` and `.tla`
files are somebody's reading of the prose, checked against themselves. A transcription
error that makes a check *fail* gets investigated. One that makes a check *pass* is
invisible. Nothing in this directory can detect it. Say so when summarising.

---

## 5. Alloy: environment and traps

Run with:

```sh
java -jar alloy.jar exec -c '*' core.als      # repeat per module
```

- **No jar is committed.** Download Alloy 6 yourself.
- The default subcommand is `gui` and **fails headless** — you must pass `exec`.
- `exec` writes its output directory **relative to the working directory**, not the source
  file. Running from a read-only dir gives `AccessDeniedException`. `cd` into a writable
  scratch dir and copy the `.als` files there.
- **Alloy ships no native SAT solver for linux/aarch64** (this container). It falls back to
  pure-Java SAT4J. Scope 5 with the default 10 steps does not finish; **scope 3 with 8
  steps does**. Scopes in the files are tuned for this and documented in-file — do not
  raise them casually.
- **Counterexample tables render empty** in the CLI's markdown output. To see an actual
  witness, read `receipt.json`, or write a constructive positive `run` that asks for the
  bad state directly.

Module system, all verified empirically here:

- `open` imports **vocabulary and facts but not commands**. Only the exec'd file's
  `run`/`check` execute. Every module therefore carries its own commands and must be run
  in turn.
- **You cannot add a field to an imported sig** — it is an ambiguous-name type error. This
  is why all shared mutable state lives on `Target` in `core.als` and why relations like
  `SourceReflection` are their own sigs. **Design shared state into a common parent up
  front**; retrofitting it means editing every module.
- `sig X extends Imported` works, including `var` fields, and subtypes inherit the
  parent's facts.
- **`as` aliases are file-local and do not propagate through `open`.** If you need
  `grid/gte`, re-open `util/ordering[GridPoint] as grid` in your own file.
- **Priming a function call needs parentheses**: `(f[x])'`, not `f[x]'`. This is a syntax
  error, and it was hit twice.
- `abstract` with no subtypes in scope is treated as concrete, so it is not a vacuity trap.
- Watch for **name clashes** across opened modules (`stutter` in `core.als` vs
  `context.als` had to be renamed).

---

## 6. TLA+: environment and traps

Run with `./tla.sh` — never raw `java` unless you know why:

```sh
./tla.sh check grid          # MC_grid       — window arithmetic, seconds
./tla.sh check lifecycle     # MC_lifecycle  — snapshot lifecycle, ~7-8 minutes
./tla.sh autodiagram diag_proj   # Projection lifecycle state machine
./tla.sh autodiagram diag_refl   # Reflection window lifecycle state machine
./tla.sh viz                 # hand-written @mermaid blocks
./tla.sh clean
```

`tla2tools.jar` is gitignored and self-downloading. Generated `view_*.html` and `*.dot`
are gitignored — **never commit them**, they were committed once and rotted.

### Traps that produce clean, plausible, wrong output

These are the dangerous ones, because nothing fails loudly.

- **Never pass TLC's `-view` flag.** Its help text says it "applies VIEW when printing out
  states". It also **truncates the search**: when this was caught, the flag explored 6 states
  where the same model without it explored 5619, silently losing an entire branch of
  the machine.
- **A cfg `VIEW` is also lossy.** TLC expands one representative per equivalence class and
  never the others, so the emitted graph is a *subgraph* of the true abstract machine — it
  rendered 15 states / 60 transitions where there were 20 / 97. This is inherent to VIEW,
  not tunable.
  **Therefore: `autodiagram` uses no VIEW at all.** It searches the full space, then
  collapses the dump by the `phase` variable in `awk`. That is exact by construction.
  If you reintroduce a VIEW anywhere, you reintroduce this bug.
- **Do not fold a conjunct into `Next`.** `-dump dot,actionlabels` names each edge after
  the sub-action that produced it. Writing `Next == Step /\ phase' = ...` collapses every
  edge label to `"Next"` and throws away the action names. Put such conjuncts inside each
  action instead (see `UpdPhase`).
- **Edge lines in a dot dump are identified by `$2 == "->"`**, never by searching for `->`
  anywhere in the line: TLA+ record syntax (`[id |-> 1]`) puts an arrow inside every node's
  state dump. Getting this wrong made an entire gate silently no-op.

### Ordinary traps

- **TLC refuses to compare values of different types.** `tg \in Projections` where `tg` may
  be a tuple is a *runtime error*, not a false test. Hence every Staleness Target is
  uniformly `<<entity, window>>`, with Projections using the sentinel window `0`. Keep
  null values the same shape as real ones too — `NoSnap` is a full record, not a string.
- **`\o` (string concatenation) requires `Sequences` in `EXTENDS`.**
- **Bounds belong in an action's domain, not in a `CONSTRAINT`.** The legacy `MC.cfg`
  generates 101 event dates per fragment and then discards everything ≥ 25.
- **Never take a powerset over a variable.** `\E fs \in SUBSET fragments` is a
  2^|Fragments| branching factor.
- **Use `CHECK_DEADLOCK FALSE`, not a `\/ UNCHANGED vars` disjunct.** Exhausting a bound is
  an intended terminal condition; adding explicit stuttering to `Next` decorates every node
  of every generated diagram with a self-loop.
- **Concurrent runs.** Each model gets its own `-metadir` under `states/`. Do not blanket
  `rm -rf states/` — that kills a concurrently running model's metadir and surfaces as an
  opaque `StatePoolWriter` disk error in the *other* process. This cost real debugging time
  twice; `clean_tmp` is now scoped per-model.
- **This tree is often mounted case-insensitively**, so `[ -f lifecycle.tla ]` matches
  `Lifecycle.tla`. `resolve_model` tries the `MC_` form first for that reason.
- Runtimes: `check lifecycle` is 7–8 minutes at the current scope. Raising `MaxSnaps` or
  `MaxVers` is expensive; the header records the state counts — read them before assuming
  a scope bump is free.

---

## 7. Decisions made, with reasons

Recorded because none of them is obvious from the files alone.

- **Duration/Period coverage went to TLA+, not Alloy.** It is arithmetic; Alloy cannot
  express it. This was the user's call and it is the right split.
- **`model.md` is not edited during modelling.** Findings return as proposed wording.
- **Deletion is mostly inert, but not entirely.** Three of the four deletion rules need no
  modelling (Colours archive rather than delete; Lens deletion is not offered;
  Projection/Reflection deletion is prohibited while anything depends on it). **Fragment
  deletion is not inert** — it removes the fragment from all future context resolution and
  flags every entity whose Context Spec matched it. Do not repeat the assumption that
  "deletion is only cosmetic tombstoning"; it was raised and corrected.
- **Multi-Reflection grids are not modelled.** Reflections are leaf-only and cannot depend
  on each other, so a second one adds indexing noise and no behaviour. `window.als` and
  `reflection.als` deliberately model exactly one.
- **`phase` in `Lifecycle.tla` is a mirror, not state.** §Active Snapshot Resolution Rule
  says active/superseded status is never stored as a mutable flag. `phase` exists solely so
  the dot export has a readable node label, is recomputed from the real variables on every
  action, and is checked by `PhaseIsFaithful`. Do not let anything read it as an authority.
- **The hand-drawn `@mermaid snapshot_lifecycle` block was deleted** from `Kalaido.tla`. It
  drew states that module had no actions for. Rule going forward: **hand-drawn `@mermaid`
  blocks only for things that are not state machines.** A state machine drawn by hand
  beside one defined in TLA+ will drift from it. Use `autodiagram`.
- **Window Spec edits append a version; they never re-key the grid.** The earlier design
  orphaned an entire time series on any edit. The overlapping-boundary rule at a version
  change was the user's proposal and is strictly better than waiting or truncating.
- **Liveness is a property of the deployment, not the model.** Nothing self-starts; an
  external driver polls for stale targets and triggers regeneration through the ordinary
  flows. The driver triggers generation only, never approval. `stutter` in `core.als`
  permits unbounded lag, and that is *faithful*, not a convenience.

---

## 8. Open items

Pick these up before starting anything new.

1. **`dag.als` contradicts `model.md`.** Its `cascadeRule` clears staleness unconditionally
   on publication, but §Resolution of Staleness now says a snapshot only clears triggers
   that fired at or before its context was resolved. Making `dag.als` faithful requires
   `core.als` to record generation-time context — a change to the Alloy core, not a
   one-liner. This is the top of the list.
2. **Slice 3 — version boundaries** (`Grid.tla`), not started: overlap bounded by one
   Period (tumbling) or one Duration (overlapping); the "double-counted once per edit"
   claim; current-window precedence as `one` over the real grid rather than `lone` over an
   abstract order.
3. **Slices 4–5 — clock, materialisation, liveness under fairness.** These replace
   `Kalaido.tla`. Needs `Spec == Init /\ [][Next]_vars /\ WF_vars(Driver)`; the current
   `INIT`/`NEXT` config cannot express fairness at all, which is why the legacy draft could
   not check anything Alloy couldn't. `engineIsLive` should become a theorem rather than an
   assumption.
4. **`Kalaido.tla`, `MC.tla`, `MC_diagram.tla` are legacy.** Roughly 70% duplicates Alloy,
   and it diverges from `model.md` in four places (it flags every Projection stale on any
   ingest; it flags un-materialized windows; it flags downstream Reflection consumers
   unconditionally, ignoring `Last N`; it leaves dangling references on fragment deletion).
   Do not extend it. Its one genuinely useful invariant, `DependenciesNotDeleted`, is not
   covered by Alloy and should move to `dag.als`.

---

## 9. Writing about this work

When summarising to the user:

- Distinguish what was **checked** from what was **read**. Several findings in this
  directory's history came from reading, and were labelled as such.
- State the scope with the result. "No counterexample at scope 3 over ≤8 steps" is the
  claim; "verified" is not.
- Do not claim `model.md` is correct or complete. It is internally consistent *across the
  areas actually modelled*, which is a much smaller statement. Unmodelled: Refinement Chat
  and Lens lineage beyond the lifecycle transition, Artifact and generation provenance,
  Absolute-mode window accumulation, and multi-Reflection behaviour.
- Consistency sweeps over `model.md` have been `grep`-driven and manual. They caught real
  contradictions, three of which had been introduced by earlier edits in this same
  directory. Assume the next sweep will be similarly imperfect.
- **Cite section names (`§Resolution of Staleness`), not line numbers.** Line numbers in
  `model.md` drift with every edit; some existing model comments cite them and are already
  approximate.
