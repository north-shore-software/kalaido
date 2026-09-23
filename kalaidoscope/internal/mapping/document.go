package mapping

import (
	"encoding/json"

	"github.com/pocketbase/pocketbase/core"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/mapdoc"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/pbutil"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/sourcedata"
	"github.com/north-shore-software/kalaido/kalaidoscope/schema"
)

const maxExemplars = 5

type document struct {
	rec     *core.Record
	doc     *mapdoc.Document
	version int
}

func loadDocument(app core.App) (*document, error) {
	rec, err := sourcedata.FindMapRecord(app)
	if err != nil {
		return nil, err
	}
	if rec == nil {
		col, err := app.FindCollectionByNameOrId(schema.ColKalaidoscopeMap.String())
		if err != nil {
			return nil, err
		}
		rec = core.NewRecord(col)
		rec.Set("version", 0)
		if err := app.Save(rec); err != nil {
			return nil, err
		}
	}
	doc, _ := mapdoc.Parse(rawBody(rec))
	return &document{rec: rec, doc: doc, version: rec.GetInt("version")}, nil
}

func rawBody(rec *core.Record) string {
	return pbutil.RawJSONField(rec, "body")
}

func (d *document) save(tx core.App) error {
	body, err := json.Marshal(d.doc)
	if err != nil {
		return err
	}
	d.rec.Set("body", json.RawMessage(body))
	return tx.Save(d.rec)
}
