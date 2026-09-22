// Package deltas holds the core upgrade steps, one file per version:
//
//	v0002_add_fragment_language.go
//
//	func init() {
//		schema.RegisterDelta(schema.Delta{
//			Version: 2,
//			Scope:   schema.ScopeCore,
//			Name:    "add_fragment_language",
//			Up: func(app core.App) error {
//				return schema.Modify(app, "fragment", func(c *core.Collection) error {
//					c.Fields.Add(&core.TextField{Name: "language"})
//					return nil
//				})
//			},
//		})
//	}
//
// Every change to schema.Canonical needs a bump of schema.Version and a delta
// here that produces the identical result on a database at the previous
// version; schema/parity_test.go checks that. A delta is frozen once
// shipped and must not reference Canonical. The server blank-imports this
// package so the registrations run.
package deltas
