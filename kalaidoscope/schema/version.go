package schema

import (
	"crypto/sha256"
	"encoding/hex"
	"io"
	"os"
	"runtime/debug"
)

// Version is the schema version this binary creates and requires.
//
// Bump it by exactly one for every change to Canonical (or to an extension),
// and register a delta for the new number in schema/deltas that brings a
// database at Version-1 to the same shape. The counter is shared with the
// cloud flavour: a cloud-only change still bumps it here, with the core
// contributing no delta for that number.
//
// Version 1 is the launch schema, frozen in baseline/v1.go.
// Version 2 adds the "edit" fragment type (deltas/v0002_add_fragment_type_edit.go).
const Version = 2

// BuildRev identifies the build, for the failed-migration marker: the same
// build never retries a migration it already failed, a different build does.
// May be set with -ldflags "-X .../schema.BuildRev=<sha>". Otherwise the
// revision Go stamps into a binary built from a clean checkout is used, and
// failing that (a dirty tree, a Docker build without .git) a hash of the
// executable itself — so two builds of different code never share a rev, and
// the same binary always does.
var BuildRev string

func buildRev() string {
	if BuildRev != "" {
		return BuildRev
	}
	if info, ok := debug.ReadBuildInfo(); ok {
		rev, modified := "", false
		for _, s := range info.Settings {
			switch s.Key {
			case "vcs.revision":
				rev = s.Value
			case "vcs.modified":
				modified = s.Value == "true"
			}
		}
		if rev != "" && !modified {
			return rev
		}
	}
	exe, err := os.Executable()
	if err != nil {
		return ""
	}
	f, err := os.Open(exe)
	if err != nil {
		return ""
	}
	defer f.Close()
	h := sha256.New()
	if _, err := io.Copy(h, f); err != nil {
		return ""
	}
	return "exe-" + hex.EncodeToString(h.Sum(nil))[:16]
}
