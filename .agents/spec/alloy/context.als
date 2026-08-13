module context

/*
 * Kalaido domain model — scope, fragments, colours, Context Spec resolution
 * (see ../model.md).
 *
 * In scope:    §Containment
 *              §Fragment → Immutability Scope
 *              §Colour → Lifecycle & Classification Events
 *              §Context Spec → Scoping Modes, Filter Criteria
 *              §Deletion & Retention → Fragment deletion
 *              §Staleness Triggers, as they bear on fragment-level context
 *
 * Out of scope: Source Composition (that is reflection.als and dag.als), Resolved
 * Context snapshot binding, window filtering by Event Date.
 *
 * Standalone by design — this module opens nothing. The properties below concern which
 * fragments a Context Spec resolves to and whether every change to that set is covered
 * by a staleness trigger; none of it needs the snapshot lifecycle in core.als. Keeping
 * it independent also keeps the state space small enough to solve on SAT4J.
 *
 * Transcription discipline: each section is encoded as written, including where two
 * sections appear to disagree. Reconciling them here would hide exactly what the
 * checks exist to find.
 */

--------------------------------------------------------------------------------
-- Entities
--------------------------------------------------------------------------------

sig Kalaidoscope {}

-- §Fragment Types, canonical list. Three atoms is enough to distinguish "matches the
-- spec's type filter" from "does not"; the real list has eight.
abstract sig FragmentType {}
one sig Email, Note, Document extends FragmentType {}

-- §Immutability Scope: "A Fragment's content, type, import date, and event date are
-- immutable once ingested." Hence static fields.
sig Fragment {
  scope: one Kalaidoscope,
  ftype: one FragmentType
}

sig Colour {
  cscope: one Kalaidoscope
}

-- Fragments enter the scope over time, and may be deleted.
one sig World {
  var ingested: set Fragment,
  var deleted:  set Fragment
}

-- §Immutability Scope: "Colour assignments are not part of the Fragment record. They
-- are separate, mutable association records between a Fragment and a Colour." Modelled
-- as a relation held outside Fragment, exactly as the spec insists.
one sig Tags { var tagged: Fragment -> Colour }

-- §Archiving: colours are never deleted, only archived. Append-only.
one sig Colours { var archived: set Colour }

abstract sig ScopeMode {}
one sig WholeScope, FilteredSelection extends ScopeMode {}

-- §Context Spec. Criteria are `var` because §Context Tweaking allows users to refine a
-- spec over time.
sig ContextSpec {
  owner:        one Kalaidoscope,
  var mode:     one ScopeMode,
  var explicit: set Fragment,
  var types:    set FragmentType,
  var colours:  set Colour
}

-- §Containment: "A Context Spec may not reference Fragments, Colours, Projections, or
-- Reflections belonging to a different Kalaidoscope."
fact scopeLocalReferences {
  always all cs: ContextSpec {
    cs.explicit.scope in cs.owner
    cs.colours.cscope in cs.owner
  }
}

fact deletedWereIngested {
  always World.deleted in World.ingested
}

-- A fragment that has not entered the scope cannot carry colour associations.
-- Missing at first, and `archivedColoursAreFrozen` failed because of it: a tag could
-- attach to an un-ingested fragment and then be dropped when it was ingested, which
-- looked like removing a tag from an archived colour. An under-constraint here, not
-- anything in model.md.
fact tagsOnlyOnIngestedFragments {
  always Tags.tagged in World.ingested -> Colour
}

--------------------------------------------------------------------------------
-- Resolution
--------------------------------------------------------------------------------

-- §Scoping Modes and §Filter Criteria, transcribed as written.
--
-- History: the explicit branch originally admitted deleted fragments, because
-- §Filter Criteria said Explicit Fragments are "always included regardless of type or
-- colour" with no exemption, while §Deletion & Retention said deletion "removes the
-- fragment from all future context resolution". `deletedNeverResolves` failed on
-- exactly that conflict. §Filter Criteria now says "provided the fragment has not been
-- deleted", which is what is modelled below.
fun resolves [cs: ContextSpec]: set Fragment {
  cs.mode = WholeScope
    => -- "Automatically selects all current and future fragments within the workspace.
       --  Suppresses all fragment-level Filter Criteria."
       { f: World.ingested - World.deleted | f.scope in cs.owner }
    else
       -- explicit pins: always included, deletion excepted
       { f: World.ingested - World.deleted | f.scope in cs.owner and f in cs.explicit }
       +
       -- union of the rule-based criteria
       { f: World.ingested - World.deleted | f.scope in cs.owner and
           (f.ftype in cs.types or some (f.(Tags.tagged) & cs.colours)) }
}

--------------------------------------------------------------------------------
-- Transitions
--------------------------------------------------------------------------------

pred specUnchanged [cs: ContextSpec] {
  cs.mode' = cs.mode
  cs.explicit' = cs.explicit
  cs.types' = cs.types
  cs.colours' = cs.colours
}

pred allSpecsUnchanged { all cs: ContextSpec | specUnchanged[cs] }

-- §Ingest: "At ingest time, fragments are classified to see which colour they match."
pred ingest [f: Fragment] {
  f not in World.ingested
  World.ingested' = World.ingested + f
  World.deleted'  = World.deleted
  Colours.archived' = Colours.archived
  -- classification attaches colours to f alone, and never an archived one
  all g: Fragment - f | g.(Tags.tagged') = g.(Tags.tagged)
  f.(Tags.tagged') in (Colour - Colours.archived)
  allSpecsUnchanged
}

-- §Deletion & Retention: fragment deletion.
pred deleteFragment [f: Fragment] {
  f in World.ingested
  f not in World.deleted
  World.deleted'  = World.deleted + f
  World.ingested' = World.ingested
  Tags.tagged' = Tags.tagged
  Colours.archived' = Colours.archived
  allSpecsUnchanged
}

-- §Colour Backfill and §Manual Tagging, together: any change to the association
-- records. §Archiving: archived colours "cannot be added to or removed from any
-- fragments", so their column is frozen.
pred retag {
  Tags.tagged' != Tags.tagged
  all c: Colours.archived | (Tags.tagged' :> c) = (Tags.tagged :> c)
  World.ingested' = World.ingested
  World.deleted'  = World.deleted
  Colours.archived' = Colours.archived
  allSpecsUnchanged
}

-- §Archiving.
pred archiveColour [c: Colour] {
  c not in Colours.archived
  Colours.archived' = Colours.archived + c
  Tags.tagged' = Tags.tagged
  World.ingested' = World.ingested
  World.deleted'  = World.deleted
  allSpecsUnchanged
}

-- §Context Tweaking / §Specification Edits.
pred specEdit [cs: ContextSpec] {
  not specUnchanged[cs]
  all other: ContextSpec - cs | specUnchanged[other]
  World.ingested' = World.ingested
  World.deleted'  = World.deleted
  Tags.tagged' = Tags.tagged
  Colours.archived' = Colours.archived
}

pred contextStutter {
  World.ingested' = World.ingested
  World.deleted'  = World.deleted
  Tags.tagged' = Tags.tagged
  Colours.archived' = Colours.archived
  allSpecsUnchanged
}

fact init {
  no World.ingested
  no World.deleted
  no Tags.tagged
  no Colours.archived
}

fact traces {
  always (contextStutter
          or some f: Fragment | ingest[f] or deleteFragment[f]
          or retag
          or some c: Colour | archiveColour[c]
          or some cs: ContextSpec | specEdit[cs])
}

--------------------------------------------------------------------------------
-- The staleness triggers, transcribed as written
--------------------------------------------------------------------------------

-- §Staleness Triggers lists, for fragment-level context:
--   - Fragment Ingestion: "A new fragment enters the scope matching the entity's
--     Context Spec (by explicit fragment ID, fragment type, colour tag, or whole-scope
--     selection)."
--   - Colour Tagging & Colour Backfills: "A Colour tag is created (triggering
--     retroactive Colour Backfill classification), or a Colour tag is manually added or
--     removed on fragments."
--   - Specification Edits: "A user modifies an entity's Context Spec."
--
--   - Fragment Deletion: "A fragment the entity's Context Spec resolved to is deleted."
--
-- History: that last trigger was absent from §Staleness Triggers, whose flagging rule
-- for deletion lived only in §Deletion & Retention — and §Resolution & Staleness
-- Lifecycle calls this list "the canonical Staleness Triggers". `contextChangeAlwaysFlags`
-- failed on it: a deletion changed a resolved set with nothing firing. Now listed.
pred contextTriggerFires [cs: ContextSpec] {
  (some f: World.ingested' - World.ingested | f in (resolves[cs])')   -- Fragment Ingestion
  or (Tags.tagged' != Tags.tagged)                                  -- Colour Tagging & Backfills
  or (World.deleted' != World.deleted)                              -- Fragment Deletion
  or (not specUnchanged[cs])                                        -- Specification Edits
}

--------------------------------------------------------------------------------
-- Consistency gates
--------------------------------------------------------------------------------

run fragmentsFlow {
  some cs: ContextSpec | cs.mode = FilteredSelection
  eventually some World.ingested
  eventually some Tags.tagged
  eventually some cs: ContextSpec | some resolves[cs]
} for 3 but 1..6 steps

run deletionHappens {
  eventually some World.deleted
} for 3 but 1..6 steps

run archivingHappens {
  eventually some Colours.archived
} for 3 but 1..6 steps

run bothModesPopulated {
  eventually (some cs: ContextSpec | cs.mode = WholeScope and some resolves[cs])
  eventually (some cs: ContextSpec | cs.mode = FilteredSelection and some resolves[cs])
} for 3 but 1..6 steps

--------------------------------------------------------------------------------
-- Invariants
--------------------------------------------------------------------------------

-- §Containment: resolution never crosses a Kalaidoscope boundary.
assert resolutionIsScopeLocal {
  always all cs: ContextSpec | resolves[cs].scope in cs.owner
}

-- §Whole Scope: "Suppresses all fragment-level Filter Criteria (Explicit Fragments,
-- Fragment Types, Colours)." Two Whole Scope specs over the same Kalaidoscope must
-- resolve identically however their criteria differ.
assert wholeScopeSuppressesCriteria {
  always all c1, c2: ContextSpec |
    (c1.mode = WholeScope and c2.mode = WholeScope and c1.owner = c2.owner)
      implies resolves[c1] = resolves[c2]
}

-- §Whole Scope: "Automatically selects all current and future fragments."
assert wholeScopeIsLive {
  always all cs: ContextSpec, f: Fragment |
    (cs.mode' = WholeScope and f in World.ingested' - World.ingested
     and f.scope in cs.owner and f not in World.deleted')
      implies f in (resolves[cs])'
}

-- §Deletion & Retention: deletion "removes the fragment from all future context
-- resolution". Tested against §Filter Criteria's "always included regardless".
assert deletedNeverResolves {
  always all cs: ContextSpec | no (resolves[cs] & World.deleted)
}

-- §Colour Archiving: archiving "preserves all existing fragment associations" and the
-- colour "continues to resolve normally for any existing syntheses that depend on it".
assert archivingChangesNoResolution {
  always all cs: ContextSpec |
    (some c: Colour | archiveColour[c]) implies (resolves[cs])' = resolves[cs]
}

-- §Archiving: archived colours "cannot be added to or removed from any fragments".
assert archivedColoursAreFrozen {
  always all c: Colours.archived | (Tags.tagged' :> c) = (Tags.tagged :> c)
}

-- The load-bearing one, and the analogue of reflection.als's resolvedChangeAlwaysFlags:
-- can a Context Spec's resolved fragment set change without any listed trigger firing?
assert contextChangeAlwaysFlags {
  always all cs: ContextSpec |
    (resolves[cs])' != resolves[cs] implies contextTriggerFires[cs]
}

check resolutionIsScopeLocal       for 3 but 1..6 steps
check wholeScopeSuppressesCriteria for 3 but 1..6 steps
check wholeScopeIsLive             for 3 but 1..6 steps
check deletedNeverResolves         for 3 but 1..6 steps
check archivingChangesNoResolution for 3 but 1..6 steps
check archivedColoursAreFrozen     for 3 but 1..6 steps
check contextChangeAlwaysFlags     for 3 but 1..6 steps
