package mapping

import (
	"crypto/rand"
	"encoding/base32"
	"encoding/json"
	"log"
	"strings"
	"unicode"

	"github.com/pocketbase/pocketbase/core"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/mapdoc"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/prompts"
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

func fold(d *mapdoc.Document, cites []prompts.ThingCitation, fragmentID, sourceDate string) []string {
	ids := make([]string, len(cites))
	bumped := map[string]bool{}
	for i, c := range cites {
		var t *mapdoc.Thing
		switch {
		case c.Ref != "":
			t = d.Resolve(c.Ref)
			if t == nil {
				log.Printf("mapping: fold %s: unknown thing ref %q dropped", fragmentID, c.Ref)
				continue
			}
		case c.Name != "":
			t = findByName(d, c.Name)
			if t == nil {
				d.Things = append(d.Things, mapdoc.Thing{
					ID:          mintID(),
					Name:        strings.TrimSpace(c.Name),
					Aliases:     []string{},
					Kind:        mapdoc.NormalizeKind(c.Kind),
					Note:        c.Note,
					Status:      mapdoc.StatusPending,
					ExemplarIDs: []string{},
				})
				t = &d.Things[len(d.Things)-1]
			}
		default:
			continue
		}
		ids[i] = t.ID
		if bumped[t.ID] {
			continue
		}
		bumped[t.ID] = true
		t.Fragments++
		if sourceDate != "" {
			if t.FirstSeen == "" || sourceDate < t.FirstSeen {
				t.FirstSeen = sourceDate
			}
			if t.LastSeen == "" || sourceDate > t.LastSeen {
				t.LastSeen = sourceDate
			}
		}
		if len(t.ExemplarIDs) < maxExemplars {
			t.ExemplarIDs = append(t.ExemplarIDs, fragmentID)
		}
	}
	return ids
}

func foldPending(app core.App) (int, error) {
	n := 0
	err := app.RunInTransaction(func(tx core.App) error {
		rows, err := tx.FindRecordsByFilter("fragment_annotation", "folded = false", "created", 0, 0, nil)
		if err != nil {
			return err
		}
		if len(rows) == 0 {
			return nil
		}
		d, err := loadDocument(tx)
		if err != nil {
			return err
		}
		for _, row := range rows {
			var cites []prompts.ThingCitation
			if err := row.UnmarshalJSONField("things", &cites); err != nil {
				cites = nil
			}
			if len(cites) > 0 {
				fragmentID := row.GetString("fragment_id")
				sourceDate := ""
				if frag, err := tx.FindRecordById("fragment", fragmentID); err == nil {
					if st := frag.GetDateTime("source_time"); !st.IsZero() {
						sourceDate = st.Time().Format("2006-01-02")
					}
				}
				ids, err := json.Marshal(fold(d.doc, cites, fragmentID, sourceDate))
				if err != nil {
					return err
				}
				row.Set("thing_ids", json.RawMessage(ids))
			}
			row.Set("folded", true)
			if err := tx.Save(row); err != nil {
				return err
			}
			n++
		}
		return d.save(tx)
	})
	if err != nil {
		return 0, err
	}
	return n, nil
}
