package mapdoc

import (
	"encoding/json"
	"strings"
)

const (
	StatusPending = "pending"
	StatusActive  = "active"
	StatusMerged  = "merged"
)

var Kinds = []string{"person", "organisation", "place", "project", "topic", "other"}

type Thing struct {
	ID          string   `json:"id"`
	Name        string   `json:"name"`
	Aliases     []string `json:"aliases"`
	Kind        string   `json:"kind"`
	Blurb       string   `json:"blurb"`
	Note        string   `json:"note,omitempty"`
	Status      string   `json:"status"`
	MergedInto  string   `json:"merged_into,omitempty"`
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

func (d *Document) Resolve(id string) *Thing {
	t := d.Find(id)
	if t == nil {
		return nil
	}
	if t.Status == StatusMerged && t.MergedInto != "" {
		if target := d.Find(t.MergedInto); target != nil {
			return target
		}
	}
	return t
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
