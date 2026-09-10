package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

// Naming: snake_case; relation fields end in _id; timestamps the application
// sets end in _at (occurred_at, approved_at, consolidated_at). The autodate
// fields keep PocketBase's own names, created and updated, like id — the
// system users collection carries those names regardless, so renaming ours
// would only put two conventions on the wire.
//
// PocketBase caps a TextField at 5000 characters unless Max is set; the
// fields that hold documents (fragment content, lens prompts, generated
// output) carry this instead.
const longTextMax = 100_000_000

type tableDef struct {
	Name                   string
	Type                   string // "base" or "view"
	ViewQuery              string
	DisableWriteOperations bool // shorthand for create+update+delete
	DisableReadOperations  bool
	// Per-operation overrides, for collections that are writable in one
	// direction only. Each is OR-ed with DisableWriteOperations.
	DisableCreate bool
	DisableUpdate bool
	DisableDelete bool
	Fields        []core.Field
	Indexes       []indexDef
}

type indexDef struct {
	Name    string
	Unique  bool
	Columns string
	Where   string
}

var schema = []tableDef{
	{
		Name:                   "fragment",
		DisableWriteOperations: true,
		Fields: []core.Field{
			&core.SelectField{
				Name:      "type",
				Required:  true,
				MaxSelect: 1,
				// "chat" marks output captured from a chat rather than ingested
				// from outside. It is an ordinary fragment in every other respect;
				// the distinct type is what lets these be selected — or excluded —
				// as a group once a workspace accumulates them.
				Values: []string{"email", "note", "chat"},
			},
			// How the fragment entered: a file import batch, the app's
			// add-fragment flow, or an external client on POST /api/ingest
			// (the default when the body names nothing). The create hook
			// defaults it to "app".
			&core.SelectField{
				Name:      "ingested_via",
				MaxSelect: 1,
				Values:    []string{"import", "app", "sync"},
			},
			// Human-readable attribution of where the content came from: an
			// email's sender and subject, a file's name, a chat's id. Rendered
			// into prompts alongside the content; never parsed.
			&core.TextField{Name: "source"},
			&core.TextField{Name: "content", Required: true, Max: longTextMax},
			// When the underlying event happened (an email's Date header);
			// the create hook defaults it to now when the source has none.
			&core.DateField{Name: "occurred_at"},
			&core.DateField{Name: "deleted_at"},
			&core.AutodateField{Name: "created", OnCreate: true},
		},
		Indexes: []indexDef{
			{Name: "idx_fragment_occurred_at", Columns: "occurred_at"},
			{Name: "idx_fragment_deleted_at", Columns: "deleted_at"},
		},
	},

	{
		Name:          "ingest",
		DisableUpdate: true,
		DisableDelete: true,
		Fields: []core.Field{
			&core.FileField{Name: "file", MaxSelect: 50, MaxSize: 200 << 20},
			// Parser override; empty = infer per file from its name.
			&core.SelectField{Name: "format", MaxSelect: 1, Values: []string{"zip", "mbox", "docx", "text"}},
			// Stop after this many fragments; 0 = no limit.
			&core.NumberField{Name: "fragment_limit"},
			// Comma-separated zip member filter; empty = the parser default.
			&core.TextField{Name: "extensions"},
			&core.BoolField{Name: "skip_duplicates"},
			// Server-written lifecycle; the create hook forces "pending".
			&core.SelectField{Name: "status", MaxSelect: 1, Values: []string{"pending", "done", "error"}},
			&core.NumberField{Name: "ingested"},
			&core.TextField{Name: "error"},
			&core.BoolField{Name: "organize_after"},
			&core.AutodateField{Name: "created", OnCreate: true},
			&core.AutodateField{Name: "updated", OnCreate: true, OnUpdate: true},
		},
	},

	{
		Name:                   "colour",
		DisableWriteOperations: true,
		Fields: []core.Field{
			&core.TextField{Name: "name", Required: true},
			// Palette slot (0..colour.SwatchCount-1) the app draws this colour
			// with. Assigned round-robin at creation and kept for life.
			&core.NumberField{Name: "swatch"},
			// A colour is defined by any of: a prompt (written by the user; every
			// fragment is judged against it by the colour role), a set of map
			// things (written by discover; every fragment citing one of them is a
			// member, no LLM), and manual positive/negative examples in
			// colour_fragment. Membership is materialised in colour_fragment.
			&core.TextField{Name: "prompt"},
			// Map thing ids (JSON array of strings). Backend-only: set by the
			// discover colours flow, never edited from the app.
			&core.JSONField{Name: "thing_ids"},
			// Prompt-matching watermark: the newest fragment (in created, id
			// order) judged against the current prompt. Empty means nothing has
			// been judged yet; a prompt edit resets it. No cascade: if the
			// fragment is ever hard-deleted PocketBase clears the reference and
			// the scan starts over.
			&core.RelationField{Name: "prompt_match_completed_up_to_fragment_id", CollectionId: "fragment", MaxSelect: 1},
			// Last durable provider failure seen by the background evaluation
			// worker ("auth"/"quota"), cleared on the next success. The worker
			// has no request to fail, so this is how it surfaces a stuck key.
			&core.TextField{Name: "last_provider_error_kind"},
			// Set by the discover worker; empty = human-created.
			&core.RelationField{Name: "created_by_discover_run_id", CollectionId: "discover_run", MaxSelect: 1},
			&core.AutodateField{Name: "created", OnCreate: true},
			&core.AutodateField{Name: "updated", OnCreate: true, OnUpdate: true},
		},
	},

	{
		Name:                   "colour_fragment",
		DisableWriteOperations: true,
		Fields: []core.Field{
			&core.RelationField{Name: "colour_id", CollectionId: "colour", Required: true, MaxSelect: 1, CascadeDelete: true},
			&core.RelationField{Name: "fragment_id", CollectionId: "fragment", Required: true, MaxSelect: 1, CascadeDelete: true},
			// Why the fragment is linked. One row per pair; precedence when a
			// pair could carry several reasons: manual_negative > manual_positive
			// > thing > prompt. "thing": the fragment's annotation cites one of
			// the colour's thing_ids (mechanical). "prompt": the colour role said
			// yes to the colour's prompt. A manual_negative row is an exclusion,
			// not a membership: every reader skips it.
			&core.SelectField{
				Name:      "match_type",
				Required:  true,
				MaxSelect: 1,
				Values:    []string{"manual_positive", "manual_negative", "thing", "prompt"},
			},
			&core.AutodateField{Name: "created", OnCreate: true},
		},
		Indexes: []indexDef{
			{Name: "idx_colour_fragment_colour", Columns: "colour_id"},
			{Name: "idx_colour_fragment_fragment", Columns: "fragment_id"},
			{Name: "idx_colour_fragment_pair", Unique: true, Columns: "colour_id, fragment_id"},
		},
	},

	{
		Name:                   "projection",
		DisableWriteOperations: true,
		Fields: []core.Field{
			&core.TextField{Name: "name"},
			&core.SelectField{Name: "status", Required: true, MaxSelect: 1, Values: []string{"proposed", "active"}},
			// The scope every generation resolves (context.md); owned by the
			// entity, not the lens. Written by discover, refinement commits, and
			// the colour-delete scrub.
			&core.JSONField{Name: "current_context_spec"},
			&core.RelationField{Name: "current_lens_id", CollectionId: "lens", MaxSelect: 1},
			// Optional per-entity model override; empty = workspace role default.
			&core.TextField{Name: "generate_with_model"},
			&core.RelationField{Name: "pinned_by", CollectionId: "users", MaxSelect: 999},
			// Set by the discover worker; empty = human-created.
			&core.RelationField{Name: "created_by_discover_run_id", CollectionId: "discover_run", MaxSelect: 1},
			// A short account of what this entity is for. Discover seeds it
			// with its proposal's opening message; empty for human-created
			// entities until one is written.
			&core.TextField{Name: "description"},
			&core.AutodateField{Name: "created", OnCreate: true},
			&core.AutodateField{Name: "updated", OnCreate: true, OnUpdate: true},
		},
		Indexes: []indexDef{
			{Name: "idx_projection_status", Columns: "status"},
		},
	},

	{
		Name:                   "reflection",
		DisableWriteOperations: true,
		Fields: []core.Field{
			&core.TextField{Name: "name"},
			&core.SelectField{Name: "status", Required: true, MaxSelect: 1, Values: []string{"proposed", "active"}},
			// The scope every generation resolves (context.md); owned by the
			// entity, not the lens. Written by discover, refinement commits, and
			// the colour-delete scrub.
			&core.JSONField{Name: "current_context_spec"},
			// Append-only history of the schedule: [{versionNumber, effectiveFrom,
			// spec}]. Creation writes version 1 and every schedule edit appends the
			// next; only the version governing now is ever read, so the list is
			// audit lineage in the same way lens.parent_lens_id is. Kept as one
			// JSON value because it is tiny, always read whole, and never queried
			// by version.
			&core.JSONField{Name: "window_spec_versions"},
			&core.RelationField{Name: "current_lens_id", CollectionId: "lens", MaxSelect: 1},
			// Optional per-entity model override; empty = workspace role default.
			&core.TextField{Name: "generate_with_model"},
			&core.RelationField{Name: "pinned_by", CollectionId: "users", MaxSelect: 999},
			// Set by the discover worker; empty = human-created.
			&core.RelationField{Name: "created_by_discover_run_id", CollectionId: "discover_run", MaxSelect: 1},
			// A short account of what this entity is for. Discover seeds it
			// with its proposal's opening message; empty for human-created
			// entities until one is written.
			&core.TextField{Name: "description"},
			&core.AutodateField{Name: "created", OnCreate: true},
			&core.AutodateField{Name: "updated", OnCreate: true, OnUpdate: true},
		},
		Indexes: []indexDef{
			{Name: "idx_reflection_status", Columns: "status"},
		},
	},

	{
		// A lens is the standing instruction only. The scope it is applied to
		// is the entity's current_context_spec, and each snapshot records the
		// spec it was actually generated with — so a lens never carries a copy
		// that could drift from the entity's.
		Name:                   "lens",
		DisableWriteOperations: true,
		DisableReadOperations:  true,
		Fields: []core.Field{
			// The standing instruction a refinement drafted (see chat.md).
			&core.TextField{Name: "prompt", Max: longTextMax},
			&core.RelationField{Name: "created_from_projection_refinement_id", CollectionId: "projection_refinement", MaxSelect: 1},
			&core.RelationField{Name: "created_from_reflection_refinement_id", CollectionId: "reflection_refinement", MaxSelect: 1},
			&core.RelationField{Name: "parent_lens_id", CollectionId: "lens", MaxSelect: 1},
			&core.AutodateField{Name: "created", OnCreate: true},
		},
	},

	{
		Name:                   "projection_snapshot",
		DisableWriteOperations: true,
		Fields: []core.Field{
			&core.RelationField{Name: "projection_id", CollectionId: "projection", Required: true, MaxSelect: 1, CascadeDelete: true},
			// One row's lifecycle: "generating" (the claim row, inserted when a
			// generation starts; it is the lock) -> "pending_review" (a finished
			// candidate awaiting the user) -> "approved" | "discarded". Server-side
			// publication goes straight from generating to approved. "approved"
			// means promoted at some point, not current: the current output is the
			// highest approval_sequence_number per target (and per window for
			// reflections), and a superseded approval keeps its status so history
			// reads stay simple; a superseded candidate is marked discarded.
			// MaxSelect must stay 1: a single select is stored as plain text,
			// which the partial indexes below and every status filter rely on.
			&core.SelectField{Name: "status", Required: true, MaxSelect: 1, Values: []string{"generating", "pending_review", "approved", "discarded"}},
			&core.JSONField{Name: "context_spec"},
			&core.JSONField{Name: "resolved_context"},
			&core.RelationField{Name: "lens_id", CollectionId: "lens", MaxSelect: 1},
			// The generated document (markdown), as the model returned it.
			&core.TextField{Name: "output", Max: longTextMax},
			// Set when this snapshot was committed from a refinement conversation.
			&core.RelationField{Name: "created_from_refinement_id", CollectionId: "projection_refinement", MaxSelect: 1},
			// The model that generated this row.
			&core.TextField{Name: "generated_by_model"},
			// Non-empty when this snapshot was generated as part of a speculative
			// "generate all" wave (it may have consumed unapproved upstream
			// candidates); the marker also propagates through refinement commits
			// so an edited chain re-triggers its downstream regeneration.
			&core.SelectField{Name: "generation_trigger", MaxSelect: 1, Values: []string{"generate_all"}},
			&core.NumberField{Name: "approval_sequence_number"},
			// approved_at / generated_at are the lifecycle moments; created /
			// updated are row bookkeeping and differ from them: a snapshot
			// starts life as a status='generating' claim row and is filled in
			// place when the model returns (generated_at), then approved or
			// discarded later. created is also the ordering key for the
			// generate-all wave, which reads unapproved rows.
			&core.DateField{Name: "approved_at"},
			&core.DateField{Name: "generated_at"},
			&core.AutodateField{Name: "created", OnCreate: true},
			&core.AutodateField{Name: "updated", OnCreate: true, OnUpdate: true},
		},
		Indexes: []indexDef{
			{Name: "idx_projection_snapshot_projection", Columns: "projection_id"},
			{Name: "idx_projection_snapshot_approval_seq", Unique: true, Columns: "projection_id, approval_sequence_number", Where: "status = 'approved'"},
		},
	},

	{
		Name:                   "reflection_snapshot",
		DisableWriteOperations: true,
		Fields: []core.Field{
			&core.RelationField{Name: "reflection_id", CollectionId: "reflection", Required: true, MaxSelect: 1, CascadeDelete: true},
			// One row's lifecycle: "generating" (the claim row, inserted when a
			// generation starts; it is the lock) -> "pending_review" (a finished
			// candidate awaiting the user) -> "approved" | "discarded". Server-side
			// publication goes straight from generating to approved. "approved"
			// means promoted at some point, not current: the current output is the
			// highest approval_sequence_number per target (and per window for
			// reflections), and a superseded approval keeps its status so history
			// reads stay simple; a superseded candidate is marked discarded.
			// MaxSelect must stay 1: a single select is stored as plain text,
			// which the partial indexes below and every status filter rely on.
			&core.SelectField{Name: "status", Required: true, MaxSelect: 1, Values: []string{"generating", "pending_review", "approved", "discarded"}},
			&core.JSONField{Name: "context_spec"},
			&core.JSONField{Name: "resolved_context"},
			// The half-open [window_start, window_end) this snapshot covers.
			// Each window carries its own approval chain (see the unique
			// index). Both empty for an unscheduled reflection's snapshots.
			// The schedule that produced the window is not recorded here:
			// it is the governing entry of reflection.window_spec_versions
			// at generation time, and the bounds are what matter.
			&core.DateField{Name: "window_start"},
			&core.DateField{Name: "window_end"},
			&core.RelationField{Name: "lens_id", CollectionId: "lens", MaxSelect: 1},
			// The generated document (markdown), as the model returned it.
			&core.TextField{Name: "output", Max: longTextMax},
			// See projection_snapshot.
			&core.RelationField{Name: "created_from_refinement_id", CollectionId: "reflection_refinement", MaxSelect: 1},
			// The model that generated this row.
			&core.TextField{Name: "generated_by_model"},
			// See projection_snapshot.generation_trigger.
			&core.SelectField{Name: "generation_trigger", MaxSelect: 1, Values: []string{"generate_all"}},
			&core.NumberField{Name: "approval_sequence_number"},
			// approved_at / generated_at are the lifecycle moments; created /
			// updated are row bookkeeping and differ from them: a snapshot
			// starts life as a status='generating' claim row and is filled in
			// place when the model returns (generated_at), then approved or
			// discarded later. created is also the ordering key for the
			// generate-all wave, which reads unapproved rows.
			&core.DateField{Name: "approved_at"},
			&core.DateField{Name: "generated_at"},
			&core.AutodateField{Name: "created", OnCreate: true},
			&core.AutodateField{Name: "updated", OnCreate: true, OnUpdate: true},
		},
		Indexes: []indexDef{
			{Name: "idx_reflection_snapshot_reflection", Columns: "reflection_id"},
			{Name: "idx_reflection_snapshot_approval_seq", Unique: true, Columns: "reflection_id, window_start, window_end, approval_sequence_number", Where: "status = 'approved'"},
		},
	},

	{
		// Windows a user explicitly backfilled (spec/model.md §Window
		// Backfill). Materialisation is permanent and independent of whether
		// a snapshot was ever produced, so it is a row of its own rather than
		// something derived from reflection_snapshot; the grid's own windows
		// are derived from window_spec_versions and never stored here.
		Name:                   "reflection_window",
		DisableWriteOperations: true,
		Fields: []core.Field{
			&core.RelationField{Name: "reflection_id", CollectionId: "reflection", Required: true, MaxSelect: 1, CascadeDelete: true},
			&core.DateField{Name: "window_start", Required: true},
			&core.DateField{Name: "window_end", Required: true},
			&core.AutodateField{Name: "created", OnCreate: true},
		},
		Indexes: []indexDef{
			{Name: "idx_reflection_window_reflection", Columns: "reflection_id"},
			{Name: "idx_reflection_window_bounds", Unique: true, Columns: "reflection_id, window_start, window_end"},
		},
	},

	{
		Name:                   "projection_refinement",
		DisableWriteOperations: true,
		Fields: []core.Field{
			&core.RelationField{Name: "projection_id", CollectionId: "projection", MaxSelect: 1, CascadeDelete: true},
			&core.RelationField{Name: "projection_snapshot_id", CollectionId: "projection_snapshot", MaxSelect: 1, CascadeDelete: true},
			&core.TextField{Name: "external_conversation_id"},

			&core.AutodateField{Name: "created", OnCreate: true},
		},
		Indexes: []indexDef{
			{Name: "idx_projection_refinement_external", Unique: true, Columns: "external_conversation_id"},
			{Name: "idx_projection_refinement_projection", Columns: "projection_id"},
			{Name: "idx_projection_refinement_snapshot", Columns: "projection_snapshot_id"},
		},
	},

	{
		Name:                   "reflection_refinement",
		DisableWriteOperations: true,
		Fields: []core.Field{
			&core.RelationField{Name: "reflection_id", CollectionId: "reflection", MaxSelect: 1, CascadeDelete: true},
			&core.RelationField{Name: "reflection_snapshot_id", CollectionId: "reflection_snapshot", MaxSelect: 1, CascadeDelete: true},
			&core.TextField{Name: "external_conversation_id"},
			&core.AutodateField{Name: "created", OnCreate: true},
		},
		Indexes: []indexDef{
			{Name: "idx_reflection_refinement_external", Unique: true, Columns: "external_conversation_id"},
			{Name: "idx_reflection_refinement_reflection", Columns: "reflection_id"},
			{Name: "idx_reflection_refinement_snapshot", Columns: "reflection_snapshot_id"},
		},
	},

	{
		Name:                   "chat_conversation",
		DisableWriteOperations: true,

		Fields: []core.Field{
			&core.TextField{Name: "external_conversation_id"},
			// Optional per-entity model override; empty = workspace role default.
			&core.TextField{Name: "generate_with_model"},
			&core.AutodateField{Name: "created", OnCreate: true},
		},
		Indexes: []indexDef{
			{Name: "idx_chat_conversation_external", Unique: true, Columns: "external_conversation_id"},
		},
	},

	{
		Name:                   "chat_message",
		DisableWriteOperations: true,
		Fields: []core.Field{
			&core.RelationField{Name: "chat_conversation_id", CollectionId: "chat_conversation", Required: false, MaxSelect: 1, CascadeDelete: true},
			&core.RelationField{Name: "projection_refinement_id", CollectionId: "projection_refinement", Required: false, MaxSelect: 1, CascadeDelete: true},
			&core.RelationField{Name: "reflection_refinement_id", CollectionId: "reflection_refinement", Required: false, MaxSelect: 1, CascadeDelete: true},
			&core.JSONField{Name: "content"},
			// The model that generated this row.
			&core.TextField{Name: "generated_by_model"},
			&core.AutodateField{Name: "created", OnCreate: true},
			&core.AutodateField{Name: "updated", OnCreate: true, OnUpdate: true},
		},
		Indexes: []indexDef{
			{Name: "idx_chat_message_chat_conv", Columns: "chat_conversation_id"},
			{Name: "idx_chat_message_projection_refinement", Columns: "projection_refinement_id"},
			{Name: "idx_chat_message_reflection_refinement", Columns: "reflection_refinement_id"},
		},
	},

	{
		Name:                   "usage",
		DisableWriteOperations: true,
		Fields: []core.Field{
			&core.TextField{Name: "period", Required: true},
			&core.NumberField{Name: "prompt_tokens"},
			&core.NumberField{Name: "completion_tokens"},
			&core.NumberField{Name: "total_tokens"},
			&core.NumberField{Name: "cached_tokens"},
			&core.AutodateField{Name: "created", OnCreate: true},
			&core.AutodateField{Name: "updated", OnCreate: true, OnUpdate: true},
		},
		Indexes: []indexDef{
			{Name: "idx_usage_period", Unique: true, Columns: "period"},
		},
	},

	{
		// One row per consolidate call: the record of what the call was asked
		// to adjudicate and what it changed, so a bad or failed consolidation
		// is inspectable after the fact. Created as "running" before the model
		// is called and finished as "done" or "error"; a process that dies
		// mid-call leaves it "running", which the organize status reads as
		// interrupted. Never pruned.
		Name:                   "map_run",
		DisableWriteOperations: true,
		Fields: []core.Field{
			&core.SelectField{
				Name:      "status",
				Required:  true,
				MaxSelect: 1,
				Values:    []string{"running", "done", "error"},
			},
			&core.TextField{Name: "error"},
			&core.TextField{Name: "generated_by_model"},
			// Pending things put in front of the model.
			&core.NumberField{Name: "pending_in"},
			// Deltas applied: pending merged into an existing thing (or two
			// active things merged), and pending admitted as new.
			&core.NumberField{Name: "merges"},
			&core.NumberField{Name: "admits"},
			// kalaidoscope_map.version before and after this call.
			&core.NumberField{Name: "version_before"},
			&core.NumberField{Name: "version_after"},
			&core.AutodateField{Name: "created", OnCreate: true},
			&core.AutodateField{Name: "updated", OnCreate: true, OnUpdate: true},
		},
	},

	{
		Name:                   "discover_run",
		DisableWriteOperations: true,
		Fields: []core.Field{
			&core.SelectField{Name: "kind", Required: true, MaxSelect: 1, Values: []string{"projections", "reflections", "colours"}},
			&core.SelectField{Name: "status", Required: true, MaxSelect: 1, Values: []string{"running", "done", "error"}},
			&core.TextField{Name: "error"},
			&core.NumberField{Name: "map_version"},
			&core.TextField{Name: "generated_by_model"},
			&core.NumberField{Name: "rounds"},
			&core.NumberField{Name: "fragment_reads"},
			&core.JSONField{Name: "outputs"},
			&core.TextField{Name: "summary"},
			&core.AutodateField{Name: "created", OnCreate: true},
			&core.AutodateField{Name: "updated", OnCreate: true, OnUpdate: true},
		},
	},

	{
		// One row per annotated fragment. Written once by an annotate worker
		// (its existence is the done-marker the dispatcher keys on) and
		// updated once by the consolidate pass that folds it into the map;
		// there is no re-annotation. Client-readable (the UI shows
		// title/summary); server-written only.
		Name:                   "fragment_annotation",
		DisableWriteOperations: true,
		Fields: []core.Field{
			&core.RelationField{Name: "fragment_id", CollectionId: "fragment", Required: true, MaxSelect: 1, CascadeDelete: true},
			// 2-6 word display label for the fragment.
			&core.TextField{Name: "title"},
			// 1-5 sentences; things already in the map are tagged inline as
			// [Name](thing id).
			&core.TextField{Name: "summary"},
			// Exactly what the model emitted: [{ref} | {name, kind, note}].
			// Provenance only.
			&core.JSONField{Name: "things"},
			// Each [{text, refs[]}]; always present, empty array is a valid
			// answer.
			&core.JSONField{Name: "decisions"},
			&core.JSONField{Name: "questions"},
			&core.JSONField{Name: "conclusions"},
			// When a consolidate pass read this row into the map (the same
			// instant as kalaidoscope_map.consolidated_at for that pass).
			// Empty until then; the rows still empty are what make the next
			// pass due.
			&core.DateField{Name: "consolidated_at"},
			// The kalaidoscope_map.version the annotation was grounded on: the
			// map put in front of the model, whose thing ids things[].ref cites.
			// Provenance only; not part of the key, since a fragment is
			// annotated once.
			&core.NumberField{Name: "generated_from_map_version"},
			&core.TextField{Name: "generated_by_model"},
			&core.AutodateField{Name: "created", OnCreate: true},
		},
		Indexes: []indexDef{
			{Name: "idx_fragment_annotation_fragment", Unique: true, Columns: "fragment_id"},
			{Name: "idx_fragment_annotation_consolidated_at", Columns: "consolidated_at"},
		},
	},

	{
		// Singleton. body is one JSON document: {things[], relationships[],
		// narrative} — the flat index every annotate call is grounded on.
		// Written only by the aggregate loop.
		Name:                   "kalaidoscope_map",
		DisableWriteOperations: true,
		Fields: []core.Field{
			&core.JSONField{Name: "body"},
			// Bumped per consolidate call, not per fold.
			&core.NumberField{Name: "version"},
			&core.DateField{Name: "consolidated_at"},
			&core.AutodateField{Name: "created", OnCreate: true},
			&core.AutodateField{Name: "updated", OnCreate: true, OnUpdate: true},
		},
	},

	{
		// Live LLM scheduler state, mirrored by the server (server/queue_status.go)
		// so the utility bar can watch the queue over the ordinary realtime
		// channel. Server-written only, and reset to empty at boot — it
		// describes the running process, not the workspace's data.
		Name:                   "llm_queue_status",
		DisableWriteOperations: true,
		Fields: []core.Field{
			&core.SelectField{Name: "state", MaxSelect: 1, Values: []string{"idle", "active"}},
			&core.JSONField{Name: "running"},
			&core.JSONField{Name: "waiting"},
			&core.JSONField{Name: "held"},
			&core.AutodateField{Name: "created", OnCreate: true},
			&core.AutodateField{Name: "updated", OnCreate: true, OnUpdate: true},
		},
	},

	{

		// The singleton row is seeded server-side and never created or deleted
		// by a client, but the provider fields below are user-editable — so
		// update is the one operation left open. model_set stays superuser-only
		// via a hook, since PocketBase rules can't be scoped to a field.
		Name:          "kalaidoscope_config",
		DisableCreate: true,
		DisableDelete: true,
		Fields: []core.Field{
			&core.TextField{Name: "model_set"},
			// Provider selection for this workspace. Empty means unconfigured,
			// which falls back to the env-seeded model set. Deliberately not
			// namespaced per provider — a workspace has exactly one at a time,
			// so a second provider needs no new columns.
			&core.TextField{Name: "provider"},
			// Written by the app, never read back by it: an enrich hook
			// (config.RegisterHooks) strips it from every non-superuser
			// response. Not a Hidden field, which would also block the write.
			&core.TextField{Name: "api_key"},
			&core.TextField{Name: "default_model"},
			&core.JSONField{Name: "role_models"},
			&core.AutodateField{Name: "created", OnCreate: true},
			&core.AutodateField{Name: "updated", OnCreate: true, OnUpdate: true},
		},
	},

	{
		Name: "view_stream",
		Type: "view",
		ViewQuery: `
			SELECT
				f.id as id,
				f.type as type,
				f.content as content,
				f.occurred_at as occurred_at,
				f.created as created,
				fa.title as title,
				COALESCE(
					(SELECT json_group_array(cf.colour_id)
					 FROM colour_fragment cf
					 WHERE cf.fragment_id = f.id
					   AND cf.match_type != 'manual_negative'),
					'[]'
				) as colour_ids
			FROM fragment f
			LEFT JOIN fragment_annotation fa ON fa.fragment_id = f.id
			WHERE f.deleted_at = ''
		`,
	},
}

func ensureField(c *core.Collection, f core.Field) {
	if c.Fields.GetByName(f.GetName()) == nil {
		c.Fields.Add(f)
	}
}

func ensureCollection(app core.App, def tableDef) error {
	c, err := app.FindCollectionByNameOrId(def.Name)
	if err != nil {
		c = core.NewBaseCollection(def.Name)
	}
	rule := "@request.auth.id != ''"
	var readRule *string = &rule
	createRule, updateRule, deleteRule := &rule, &rule, &rule

	if def.DisableReadOperations {
		readRule = nil
	}
	if def.DisableWriteOperations || def.DisableCreate {
		createRule = nil
	}
	if def.DisableWriteOperations || def.DisableUpdate {
		updateRule = nil
	}
	if def.DisableWriteOperations || def.DisableDelete {
		deleteRule = nil
	}

	if def.Type == "view" {
		c.Type = core.CollectionTypeView
		c.ViewQuery = def.ViewQuery
		c.ViewRule = readRule
		c.ListRule = readRule
	} else if def.Type == "" || def.Type == "base" {
		c.Type = core.CollectionTypeBase
		c.ViewRule = readRule
		c.ListRule = readRule
		c.CreateRule = createRule
		c.UpdateRule = updateRule
		c.DeleteRule = deleteRule
	}
	for _, f := range def.Fields {
		if relField, ok := f.(*core.RelationField); ok {
			target, err := app.FindCollectionByNameOrId(relField.CollectionId)
			if err == nil {
				relField.CollectionId = target.Id
			}
		}
		ensureField(c, f)
	}
	for _, idx := range def.Indexes {
		c.AddIndex(idx.Name, idx.Unique, idx.Columns, idx.Where)
	}
	return app.Save(c)
}

func init() {
	m.Register(func(app core.App) error {
		// First pass: ensure base collections exist so they can be referenced
		for _, t := range schema {
			if t.Type == "view" {
				continue
			}
			_, err := app.FindCollectionByNameOrId(t.Name)
			if err != nil {
				c := core.NewBaseCollection(t.Name)
				if err := app.Save(c); err != nil {
					return err
				}
			}
		}
		// Second pass: set fields, indexes, rules
		for _, t := range schema {
			if err := ensureCollection(app, t); err != nil {
				return err
			}
		}
		return nil
	}, func(app core.App) error {
		// Delete in reverse dependency order; ignore collections already gone.
		for i := len(schema) - 1; i >= 0; i-- {
			c, err := app.FindCollectionByNameOrId(schema[i].Name)
			if err != nil {
				continue
			}
			if err := app.Delete(c); err != nil {
				return err
			}
		}
		return nil
	})
}
