package engine

import (
	"crypto/md5"
	"encoding/hex"
	"errors"
	"time"

	"github.com/pocketbase/pocketbase/core"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/api"
)

var ErrReflectionNotFound = errors.New("reflection not found")

type ReflectionStrategy struct{}

func (s ReflectionStrategy) TargetType() string             { return "reflection" }
func (s ReflectionStrategy) CollectionName() string         { return "reflection" }
func (s ReflectionStrategy) LensCollectionName() string     { return "lens" }
func (s ReflectionStrategy) SnapshotCollectionName() string { return "reflection_snapshot" }
func (s ReflectionStrategy) ForeignKeyCol() string          { return "reflection_id" }
func (s ReflectionStrategy) EnsureFragmentsOnly() bool      { return true }
func (s ReflectionStrategy) GetPendingWindows(app core.App, record *core.Record) ([]api.Window, error) {
	return GetPendingWindows(app, record.Id)
}

func CalculatePendingWindows(reflectionID string, spec api.WindowSpec, lastWindowEnd, created, now time.Time) []api.Window {
	var pending []api.Window

	period, err := time.ParseDuration(spec.Period)
	if err != nil || period <= 0 {
		return pending
	}

	if lastWindowEnd.IsZero() {
		anchorStr := spec.StartTime
		if anchorStr != "" {
			if t, err := time.Parse(time.RFC3339, anchorStr); err == nil {
				lastWindowEnd = t
			}
		}
		if lastWindowEnd.IsZero() {
			lastWindowEnd = created
		}
	}

	elapsed := now.Sub(lastWindowEnd)
	periods := int(elapsed.Nanoseconds() / period.Nanoseconds())
	for i := 1; i <= periods; i++ {
		start := lastWindowEnd.Add(time.Duration(i-1) * period)
		end := lastWindowEnd.Add(time.Duration(i) * period)

		hash := md5.Sum([]byte(reflectionID + start.Format(time.RFC3339) + end.Format(time.RFC3339)))
		id := hex.EncodeToString(hash[:])

		pending = append(pending, api.Window{
			ID:    id,
			Start: start.Format(time.RFC3339),
			End:   end.Format(time.RFC3339),
		})
	}
	return pending
}

func GetPendingWindows(app core.App, reflectionID string) ([]api.Window, error) {
	rec, err := app.FindRecordById("reflection", reflectionID)
	if err != nil {
		return nil, err
	}

	version, ok := GoverningVersion(LoadWindowSpecVersions(rec), time.Now())
	if !ok || version.Spec.Period == "" {
		return nil, nil
	}
	currentSpec := version.Spec

	recs, _ := app.FindRecordsByFilter("reflection_snapshot",
		"reflection_id = {:id} && status = 'approved'", "-approval_sequence_number", 1, 0,
		map[string]any{"id": reflectionID})

	var lastWindowEnd time.Time
	if len(recs) > 0 {
		snapRec := recs[0]
		var winSpec map[string]string
		if err := snapRec.UnmarshalJSONField("window_spec", &winSpec); err == nil {
			if endStr, ok := winSpec["end"]; ok && endStr != "" {
				if t, err := time.Parse(time.RFC3339, endStr); err == nil {
					lastWindowEnd = t
				}
			}
		}
	}

	created := rec.GetDateTime("created").Time()
	return CalculatePendingWindows(reflectionID, currentSpec, lastWindowEnd, created, time.Now()), nil
}
