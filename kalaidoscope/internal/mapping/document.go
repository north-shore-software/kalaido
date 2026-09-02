package mapping

import (
	"crypto/rand"
	"encoding/base32"
	"encoding/json"
	"strings"
	"unicode"

	"github.com/pocketbase/pocketbase/core"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/mapdoc"
)

const maxExemplars = 5

type document struct {
	rec     *core.Record
	doc     *mapdoc.Document
	version int
}

func loadDocument(app core.App) (*document, error) {
	recs, err := app.FindRecordsByFilter("kalaidoscope_map", "1=1", "", 1, 0, nil)
	if err != nil {
		return nil, err
	}
	var rec *core.Record
	if len(recs) > 0 {
		rec = recs[0]
	} else {
		col, err := app.FindCollectionByNameOrId("kalaidoscope_map")
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
	var raw json.RawMessage
	if err := rec.UnmarshalJSONField("body", &raw); err != nil || len(raw) == 0 {
		return ""
	}
	return string(raw)
}

func (d *document) save(tx core.App) error {
	body, err := json.Marshal(d.doc)
	if err != nil {
		return err
	}
	d.rec.Set("body", json.RawMessage(body))
	return tx.Save(d.rec)
}

var idEncoding = base32.StdEncoding.WithPadding(base32.NoPadding)

func mintID() string {
	var b [5]byte
	if _, err := rand.Read(b[:]); err != nil {
		panic(err)
	}
	return "t_" + strings.ToLower(idEncoding.EncodeToString(b[:]))
}

func normalizeName(s string) string {
	s = strings.ToLower(strings.TrimSpace(s))
	s = strings.Join(strings.Fields(s), " ")
	return strings.TrimRightFunc(s, unicode.IsPunct)
}

func findByName(d *mapdoc.Document, name string) *mapdoc.Thing {
	want := normalizeName(name)
	if want == "" {
		return nil
	}
	for i := range d.Things {
		t := &d.Things[i]
		if t.Status == mapdoc.StatusMerged {
			continue
		}
		if normalizeName(t.Name) == want {
			return t
		}
		for _, a := range t.Aliases {
			if normalizeName(a) == want {
				return t
			}
		}
	}
	return nil
}
