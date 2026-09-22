package mapdoc

import (
	"crypto/rand"
	"encoding/base32"
	"encoding/json"
	"strings"
	"unicode"
)

var Kinds = []string{"person", "organisation", "place", "project", "topic", "other"}

type Thing struct {
	ID          string   `json:"id"`
	Name        string   `json:"name"`
	Aliases     []string `json:"aliases"`
	Kind        string   `json:"kind"`
	Blurb       string   `json:"blurb"`
	Fragments   int      `json:"fragments"`
	FirstSeen   string   `json:"first_seen,omitempty"`
	LastSeen    string   `json:"last_seen,omitempty"`
	ExemplarIDs []string `json:"exemplar_ids"`
}

type Relationship struct {
	From string `json:"from"`
	To   string `json:"to"`
	Kind string `json:"kind"`
}

type Document struct {
	Things        []Thing        `json:"things"`
	Relationships []Relationship `json:"relationships"`
	Narrative     string         `json:"narrative"`
}

func Parse(body string) (*Document, bool) {
	body = strings.TrimSpace(body)
	if body == "" || body == "{}" || body == "null" {
		return &Document{}, false
	}
	var probe map[string]json.RawMessage
	if err := json.Unmarshal([]byte(body), &probe); err != nil {
		return &Document{}, false
	}
	if _, ok := probe["things"]; !ok {
		return &Document{}, false
	}
	var d Document
	if err := json.Unmarshal([]byte(body), &d); err != nil {
		return &Document{}, false
	}
	if d.Things == nil {
		d.Things = []Thing{}
	}
	if d.Relationships == nil {
		d.Relationships = []Relationship{}
	}
	return &d, true
}

func (d *Document) Find(id string) *Thing {
	for i := range d.Things {
		if d.Things[i].ID == id {
			return &d.Things[i]
		}
	}
	return nil
}

func NormalizeKind(kind string) string {
	kind = strings.ToLower(strings.TrimSpace(kind))
	if kind == "organization" || kind == "company" || kind == "org" {
		return "organisation"
	}
	for _, k := range Kinds {
		if kind == k {
			return k
		}
	}
	return "other"
}

var idEncoding = base32.StdEncoding.WithPadding(base32.NoPadding)

// MintID mints a new server-side thing ID: "t_" + 8 lower-case unpadded base32 chars.
func MintID() string {
	var b [5]byte
	if _, err := rand.Read(b[:]); err != nil {
		panic(err)
	}
	return "t_" + strings.ToLower(idEncoding.EncodeToString(b[:]))
}

// NormalizeName strips trailing punctuation, collapses internal whitespace, and lowercases.
func NormalizeName(s string) string {
	s = strings.ToLower(strings.TrimSpace(s))
	s = strings.Join(strings.Fields(s), " ")
	return strings.TrimRightFunc(s, unicode.IsPunct)
}

// FindByName finds a thing by normalized name or alias.
func (d *Document) FindByName(name string) *Thing {
	want := NormalizeName(name)
	if want == "" {
		return nil
	}
	for i := range d.Things {
		t := &d.Things[i]
		if NormalizeName(t.Name) == want {
			return t
		}
		for _, a := range t.Aliases {
			if NormalizeName(a) == want {
				return t
			}
		}
	}
	return nil
}

// Resolve looks up a thing by exact ID (Find), then by normalized name or alias (FindByName).
func (d *Document) Resolve(ref string) *Thing {
	if t := d.Find(ref); t != nil {
		return t
	}
	return d.FindByName(ref)
}
