// UNREVIEWED
// Package sourcedata provides unified, read-only accessors for workspace
// source data: fragments, colour membership, map document & annotation index,
// and upstream snapshots.
//
// Functions in this package are pure query helpers over PocketBase core.App.
// They do not perform writes, execute LLM tool loops, or format prompt cards.
package sourcedata
