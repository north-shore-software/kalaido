package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

const fragmentContentMax = 100_000_000

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
		Name: "fragment",
		Fields: []core.Field{
			&core.SelectField{
				Name:      "type",
				Required:  true,
				MaxSelect: 1,
				// "chat" marks output captured from a chat rather than ingested
				// from outside. It is an ordinary fragment in every other respect;
				// the distinct type is what lets these be selected — or excluded —
				// as a group once a workspace accumulates them.
				Values: []string{"email", "note", "whatsapp", "sms", "chat"},
			},
			&core.TextField{Name: "source"},
			&core.TextField{Name: "content", Required: true, Max: fragmentContentMax},
			&core.DateField{Name: "source_time"},
			&core.DateField{Name: "deleted_at"},
			&core.AutodateField{Name: "created", OnCreate: true},
		},
		Indexes: []indexDef{
			{Name: "idx_fragment_source_time", Columns: "source_time"},
			{Name: "idx_fragment_deleted_at", Columns: "deleted_at"},
		},
	},

	{
		Name: "ingest",
		Fields: []core.Field{
			&core.FileField{Name: "file", MaxSelect: 50, MaxSize: 200 << 20},
			&core.TextField{Name: "format"},
			&core.NumberField{Name: "limit"},
			&core.TextField{Name: "extensions"},
			&core.BoolField{Name: "skip_duplicates"},
			&core.TextField{Name: "status"},
			&core.NumberField{Name: "ingested"},
			&core.TextField{Name: "error"},
			&core.AutodateField{Name: "created", OnCreate: true},
			&core.AutodateField{Name: "updated", OnCreate: true, OnUpdate: true},
		},
	},

	{
		Name:                   "colour",
		DisableWriteOperations: true,
		Fields: []core.Field{
			&core.TextField{Name: "name", Required: true},
			&core.TextField{Name: "colour_value"},
			&core.TextField{Name: "criteria"},
			// Last durable provider failure seen by the background evaluation
			// worker ("auth"/"quota"), cleared on the next success. The worker
			// has no request to fail, so this is how it surfaces a stuck key.
			&core.TextField{Name: "last_provider_error_kind"},
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
			&core.SelectField{
				Name:      "match_type",
				Required:  true,
				MaxSelect: 1,
				Values:    []string{"manual_positive", "manual_negative", "llm_matched_backfill", "llm_matched_tag_on_input"},
			},
			// Model that decided an llm_matched_* row. Empty for manual matches
			// and for rows written before provenance was tracked.
			&core.TextField{Name: "model"},
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
			&core.JSONField{Name: "current_context_spec"},
			&core.RelationField{Name: "current_lens_id", CollectionId: "lens", MaxSelect: 1},
			&core.RelationField{Name: "pinned_by", CollectionId: "users", MaxSelect: 0},
			// Last durable provider failure seen by the background lens
			// distillation worker ("auth"/"quota"), cleared on the next success.
			&core.TextField{Name: "last_provider_error_kind"},
			&core.AutodateField{Name: "created", OnCreate: true},
			&core.AutodateField{Name: "updated", OnCreate: true, OnUpdate: true},
		},
	},

	{
		Name:                   "reflection",
		DisableWriteOperations: true,
		Fields: []core.Field{
			&core.TextField{Name: "name"},
			&core.JSONField{Name: "current_context_spec"},
			&core.JSONField{Name: "window_spec_versions"},
			&core.RelationField{Name: "current_lens_id", CollectionId: "lens", MaxSelect: 1},
			&core.RelationField{Name: "pinned_by", CollectionId: "users", MaxSelect: 0},
			// Last durable provider failure seen by the background lens
			// distillation worker ("auth"/"quota"), cleared on the next success.
			&core.TextField{Name: "last_provider_error_kind"},
			&core.AutodateField{Name: "created", OnCreate: true},
			&core.AutodateField{Name: "updated", OnCreate: true, OnUpdate: true},
		},
	},

	{
		Name:                   "lens",
		DisableWriteOperations: true,
		DisableReadOperations:  true,
		Fields: []core.Field{
			&core.JSONField{Name: "context_spec"},
			&core.JSONField{Name: "prompt"},
			&core.RelationField{Name: "created_from_proj_refinement_id", CollectionId: "refine_proj_snapshot_conversation", MaxSelect: 1},
			&core.RelationField{Name: "created_from_refl_refinement_id", CollectionId: "refine_refl_snapshot_conversation", MaxSelect: 1},
			&core.RelationField{Name: "parent_lens_id", CollectionId: "lens", MaxSelect: 1},
			&core.TextField{Name: "model"}, // concrete model name that generated this row; empty = pre-provenance
			&core.AutodateField{Name: "created", OnCreate: true},
		},
	},

	{
		Name:                   "projection_snapshot",
		DisableWriteOperations: true,
		Fields: []core.Field{
			&core.RelationField{Name: "projection_id", CollectionId: "projection", Required: true, MaxSelect: 1, CascadeDelete: true},
			&core.TextField{Name: "status"},
			&core.JSONField{Name: "context_spec"},
			&core.JSONField{Name: "resolved_context"},
			&core.RelationField{Name: "lens_id", CollectionId: "lens", MaxSelect: 1},
			&core.JSONField{Name: "output"},
			&core.TextField{Name: "model"}, // concrete model name that generated this row; empty = pre-provenance
			// Non-empty when this snapshot was generated as part of a speculative
			// "generate all" wave (it may have consumed unapproved upstream
			// candidates); the marker also propagates through refinement commits
			// so an edited chain re-triggers its downstream regeneration.
			&core.TextField{Name: "chain_origin"},
			&core.NumberField{Name: "approval_sequence_number"},
			&core.DateField{Name: "approval_timestamp"},
			&core.DateField{Name: "generation_timestamp"},
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
			&core.TextField{Name: "status"},
			&core.JSONField{Name: "context_spec"},
			&core.JSONField{Name: "window_spec"},
			&core.JSONField{Name: "resolved_context"},
			&core.JSONField{Name: "resolved_window"},
			&core.RelationField{Name: "lens_id", CollectionId: "lens", MaxSelect: 1},
			&core.JSONField{Name: "output"},
			&core.TextField{Name: "model"}, // concrete model name that generated this row; empty = pre-provenance
			// See projection_snapshot.chain_origin.
			&core.TextField{Name: "chain_origin"},
			&core.NumberField{Name: "approval_sequence_number"},
			&core.DateField{Name: "approval_timestamp"},
			&core.DateField{Name: "generation_timestamp"},
			&core.TextField{Name: "window_key"},
			&core.NumberField{Name: "window_spec_version_number"},
			&core.AutodateField{Name: "created", OnCreate: true},
			&core.AutodateField{Name: "updated", OnCreate: true, OnUpdate: true},
		},
		Indexes: []indexDef{
			{Name: "idx_reflection_snapshot_reflection", Columns: "reflection_id"},
			{Name: "idx_reflection_snapshot_approval_seq", Unique: true, Columns: "reflection_id, window_key, approval_sequence_number", Where: "status = 'approved'"},
		},
	},

	{
		Name:                   "refine_proj_snapshot_conversation",
		DisableWriteOperations: true,
		Fields: []core.Field{
			&core.RelationField{Name: "projection_id", CollectionId: "projection", MaxSelect: 1, CascadeDelete: true},
			&core.RelationField{Name: "projection_snapshot_id", CollectionId: "projection_snapshot", MaxSelect: 1, CascadeDelete: true},
			&core.TextField{Name: "external_conversation_id"},

			&core.AutodateField{Name: "created", OnCreate: true},
		},
		Indexes: []indexDef{
			{Name: "idx_refine_proj_external", Unique: true, Columns: "external_conversation_id"},
			{Name: "idx_refine_proj_projection", Columns: "projection_id"},
			{Name: "idx_refine_proj_snapshot", Columns: "projection_snapshot_id"},
		},
	},

	{
		Name:                   "refine_refl_snapshot_conversation",
		DisableWriteOperations: true,
		Fields: []core.Field{
			&core.RelationField{Name: "reflection_id", CollectionId: "reflection", MaxSelect: 1, CascadeDelete: true},
			&core.RelationField{Name: "reflection_snapshot_id", CollectionId: "reflection_snapshot", MaxSelect: 1, CascadeDelete: true},
			&core.TextField{Name: "external_conversation_id"},
			&core.AutodateField{Name: "created", OnCreate: true},
		},
		Indexes: []indexDef{
			{Name: "idx_refine_refl_external", Unique: true, Columns: "external_conversation_id"},
			{Name: "idx_refine_refl_reflection", Columns: "reflection_id"},
			{Name: "idx_refine_refl_snapshot", Columns: "reflection_snapshot_id"},
		},
	},

	{
		Name: "chat_conversation",

		Fields: []core.Field{
			&core.TextField{Name: "external_conversation_id"},
			&core.AutodateField{Name: "created", OnCreate: true},
		},
		Indexes: []indexDef{
			{Name: "idx_chat_conversation_external", Unique: true, Columns: "external_conversation_id"},
		},
	},

	{
		Name: "chat_message",
		Fields: []core.Field{
			&core.RelationField{Name: "chat_conversation_id", CollectionId: "chat_conversation", Required: false, MaxSelect: 1, CascadeDelete: true},
			&core.RelationField{Name: "refine_proj_conversation_id", CollectionId: "refine_proj_snapshot_conversation", Required: false, MaxSelect: 1, CascadeDelete: true},
			&core.RelationField{Name: "refine_refl_conversation_id", CollectionId: "refine_refl_snapshot_conversation", Required: false, MaxSelect: 1, CascadeDelete: true},
			&core.JSONField{Name: "content"},
			&core.TextField{Name: "model"}, // concrete model name that generated this row; empty = pre-provenance
			&core.AutodateField{Name: "created", OnCreate: true},
			&core.AutodateField{Name: "updated", OnCreate: true, OnUpdate: true},
		},
		Indexes: []indexDef{
			{Name: "idx_chat_message_chat_conv", Columns: "chat_conversation_id"},
			{Name: "idx_chat_message_refine_proj", Columns: "refine_proj_conversation_id"},
			{Name: "idx_chat_message_refine_refl", Columns: "refine_refl_conversation_id"},
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
			&core.AutodateField{Name: "created", OnCreate: true},
			&core.AutodateField{Name: "updated", OnCreate: true, OnUpdate: true},
		},
		Indexes: []indexDef{
			{Name: "idx_usage_period", Unique: true, Columns: "period"},
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
			&core.TextField{Name: "state"}, // "idle" | "active"
			&core.JSONField{Name: "running"},
			&core.JSONField{Name: "waiting"},
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
			WITH indexed_colours AS (
				SELECT id, (row_number() OVER (ORDER BY created) - 1) % 8 as idx
				FROM colour
			)
			SELECT
				f.id as id,
				f.type as type,
				f.content as content,
				f.source_time as source_time,
				f.created as created,
				COALESCE(
					(SELECT json_group_array(ic.idx)
					 FROM colour_fragment cf
					 JOIN indexed_colours ic ON ic.id = cf.colour_id
					 WHERE cf.fragment_id = f.id),
					'[]'
				) as colours
			FROM fragment f
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
