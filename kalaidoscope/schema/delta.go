// UNREVIEWED
package schema

import (
	"fmt"
	"sort"

	"github.com/pocketbase/pocketbase/core"
)

// Delta upgrades a database from Version-1 to Version. Deltas are registered
// from an init in schema/deltas (core) or the flavour's deltas package and
// run in (Version, Scope, registration) order, each PocketBase save in its
// own transaction, all of them covered by the single pre-migration backup.
//
// A delta is frozen once shipped: it must not read Canonical or an
// Extension (which keep moving), so any table or view it needs is spelled out
// inline. delta_lint_test.go enforces this.
type Delta struct {
	Version int
	Scope   int // ScopeCore before ScopeCloud within a version
	Name    string
	Up      func(app core.App) error
}

const (
	ScopeCore  = 0
	ScopeCloud = 1
)

var deltas []Delta

// RegisterDelta adds a delta to the registry. Panics on a malformed delta so
// a bad registration fails the build's first test run, not a user's boot.
func RegisterDelta(d Delta) {
	if d.Version < 2 {
		panic(fmt.Sprintf("schema: delta %q: version must be >= 2 (version 1 is the baseline)", d.Name))
	}
	if d.Up == nil {
		panic(fmt.Sprintf("schema: delta %q: missing Up", d.Name))
	}
	if d.Name == "" {
		panic(fmt.Sprintf("schema: delta for version %d has no name", d.Version))
	}
	deltas = append(deltas, d)
}

func deltasFor(version int) []Delta {
	var out []Delta
	for _, d := range deltas {
		if d.Version == version {
			out = append(out, d)
		}
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].Scope < out[j].Scope })
	return out
}

// Modify loads a collection, lets fn change it, and saves it. The building
// block for deltas that add, drop or change fields, indexes and rules:
//
//	schema.Modify(app, "fragment", func(c *core.Collection) error {
//		c.Fields.Add(&core.TextField{Name: "language"})
//		c.Fields.RemoveByName("obsolete")
//		c.AddIndex("idx_fragment_language", false, "language", "")
//		return nil
//	})
func Modify(app core.App, name string, fn func(c *core.Collection) error) error {
	c, err := app.FindCollectionByNameOrId(name)
	if err != nil {
		return fmt.Errorf("collection %q: %w", name, err)
	}
	if err := fn(c); err != nil {
		return err
	}
	return app.Save(c)
}

// AddCollection creates a collection from an inline TableDef (or completes a
// partially created one). Relation targets are resolved by name.
func AddCollection(app core.App, def TableDef) error {
	return ApplyTable(app, def)
}

// DropCollection deletes a collection and its rows. Missing is not an error,
// so a delta that ran partway before a crash can be re-run.
func DropCollection(app core.App, name string) error {
	c, err := app.FindCollectionByNameOrId(name)
	if err != nil {
		return nil
	}
	return app.Delete(c)
}
