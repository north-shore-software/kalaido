package mapping

import (
	"encoding/json"

	"github.com/pocketbase/pocketbase/core"
)

type workspaceMap struct {
	rec     *core.Record
	body    string
	version int
}

func loadMap(app core.App) (*workspaceMap, error) {
	recs, err := app.FindRecordsByFilter("kalaidoscope_map", "1=1", "", 1, 0, nil)
	if err != nil {
		return nil, err
	}
	if len(recs) > 0 {
		rec := recs[0]
		return &workspaceMap{
			rec:     rec,
			body:    rawBody(rec),
			version: rec.GetInt("version"),
		}, nil
	}
	col, err := app.FindCollectionByNameOrId("kalaidoscope_map")
	if err != nil {
		return nil, err
	}
	rec := core.NewRecord(col)
	rec.Set("version", 0)
	if err := app.Save(rec); err != nil {
		return nil, err
	}
	return &workspaceMap{rec: rec, version: 0}, nil
}

func rawBody(rec *core.Record) string {
	var raw json.RawMessage
	if err := rec.UnmarshalJSONField("body", &raw); err != nil || len(raw) == 0 {
		return ""
	}
	return string(raw)
}

type annotation struct {
	fragmentID      string
	body            json.RawMessage
	groundedVersion int
}

func persistChunk(app core.App, m *workspaceMap, runID, model, newBody string, anns []annotation) error {
	annCol, err := app.FindCollectionByNameOrId("fragment_annotation")
	if err != nil {
		return err
	}
	newVersion := m.version + 1
	err = app.RunInTransaction(func(tx core.App) error {
		m.rec.Set("body", json.RawMessage(newBody))
		m.rec.Set("version", newVersion)
		if err := tx.Save(m.rec); err != nil {
			return err
		}
		for _, a := range anns {
			rec := core.NewRecord(annCol)
			rec.Set("fragment_id", a.fragmentID)
			rec.Set("annotation", a.body)
			rec.Set("map_version", a.groundedVersion)
			rec.Set("model", model)
			rec.Set("run_id", runID)
			if err := tx.Save(rec); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		return err
	}
	m.body = newBody
	m.version = newVersion
	return nil
}
