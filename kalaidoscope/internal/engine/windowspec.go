package engine

import (
	"time"

	"github.com/pocketbase/pocketbase/core"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/api"
)

func LoadWindowSpecVersions(rec *core.Record) []api.WindowSpecVersion {
	var versions []api.WindowSpecVersion
	_ = rec.UnmarshalJSONField("window_spec_versions", &versions)
	return versions
}

func GoverningVersion(versions []api.WindowSpecVersion, at time.Time) (api.WindowSpecVersion, bool) {
	var best api.WindowSpecVersion
	var bestAt time.Time
	var found bool
	for _, v := range versions {
		eff, err := time.Parse(time.RFC3339, v.EffectiveFrom)
		if err != nil || eff.After(at) {
			continue
		}
		if !found || eff.After(bestAt) {
			best = v
			bestAt = eff
			found = true
		}
	}
	return best, found
}

func AppendWindowSpecVersion(versions []api.WindowSpecVersion, spec api.WindowSpec, effectiveFrom time.Time) []api.WindowSpecVersion {
	next := 1
	for _, v := range versions {
		if v.VersionNumber >= next {
			next = v.VersionNumber + 1
		}
	}
	return append(versions, api.WindowSpecVersion{
		VersionNumber: next,
		EffectiveFrom: effectiveFrom.UTC().Format(time.RFC3339),
		Spec:          spec,
	})
}
