// UNREVIEWED
package schema

import "github.com/pocketbase/pocketbase/core"

// Extension is a flavour's addition to the canonical schema — the cloud
// binary's member and allowance collections and its rule overrides. It is
// applied after Canonical when a fresh database is created, and it shares the
// single Version counter: a change to an extension is a delta like any other,
// registered with its own Scope so it runs after the core deltas of the same
// version.
type Extension struct {
	Name string
	// Tables are applied with ApplyTables after Canonical.
	Tables []TableDef
	// After runs once the tables exist, for anything a TableDef cannot say:
	// auth collections, rule overrides on core collections, partial indexes.
	// It must be idempotent.
	After func(app core.App) error
}

var extensions []Extension

// Extend registers an extension. Call it from an init in the flavour's
// schema package, which the binary blank-imports.
func Extend(e Extension) {
	extensions = append(extensions, e)
}

// applyCanonical creates the latest schema — Canonical plus every registered
// extension — in one pass.
func applyCanonical(app core.App) error {
	if err := ApplyTables(app, Canonical); err != nil {
		return err
	}
	for _, e := range extensions {
		if err := ApplyTables(app, e.Tables); err != nil {
			return err
		}
		if e.After != nil {
			if err := e.After(app); err != nil {
				return err
			}
		}
	}
	return nil
}
