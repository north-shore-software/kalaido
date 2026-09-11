// Package schema owns the kalaidoscope database schema and its lifecycle.
//
// A brand-new database is created from Canonical (canonical.go) in one pass
// and stamped at Version. An existing database records the version it is at
// (state.go) and, when a newer binary opens it, is upgraded delta by delta
// (delta.go, schema/deltas) after a pre-migration backup (backup.go). A failed
// upgrade restores that backup, leaves a marker the next boot honours
// (failed.go), and exits. A binary never opens a database newer than itself.
//
// The whole lifecycle runs inside PocketBase's bootstrap (runner.go), before
// any serve hook, so every command and every test sees a migrated database.
package schema

import "github.com/pocketbase/pocketbase/core"

// TableDef declares one collection: its fields, indexes, and which of the
// CRUD operations are open to an authenticated user (the rest are
// superuser-only, i.e. server-written).
type TableDef struct {
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
	Indexes       []IndexDef
}

type IndexDef struct {
	Name    string
	Unique  bool
	Columns string
	Where   string
}

func ensureField(c *core.Collection, f core.Field) {
	if c.Fields.GetByName(f.GetName()) == nil {
		c.Fields.Add(f)
	}
}

// ApplyTable creates the collection if missing and brings its type, rules,
// fields and indexes up to def. Fields already present are left as they are
// (this adds, it never rewrites), and relation targets are resolved by name.
func ApplyTable(app core.App, def TableDef) error {
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

// ApplyTables applies a whole schema: every base collection is created empty
// first so relations can resolve their targets by name, then each table is
// filled in with ApplyTable. Views come last since they select from tables.
func ApplyTables(app core.App, defs []TableDef) error {
	for _, t := range defs {
		if t.Type == "view" {
			continue
		}
		if _, err := app.FindCollectionByNameOrId(t.Name); err != nil {
			if err := app.Save(core.NewBaseCollection(t.Name)); err != nil {
				return err
			}
		}
	}
	for _, t := range defs {
		if err := ApplyTable(app, t); err != nil {
			return err
		}
	}
	return nil
}
