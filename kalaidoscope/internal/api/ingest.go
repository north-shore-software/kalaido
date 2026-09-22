// UNREVIEWED
package api

import "encoding/json"

// IngestMessage is the body of the sync POST /api/ingest. Field names are
// lowerCamelCase like every other route; the snake_case spellings this route
// shipped with (ingested_via, occurred_at, fragment_limit, skip_duplicates)
// are still accepted so an older client keeps working.
type IngestMessage struct {
	// Inline single-entry fields (sync endpoint).
	Type        string `json:"type,omitempty"`
	IngestedVia string `json:"ingestedVia,omitempty"`
	Source      string `json:"source,omitempty"`
	Content     string `json:"content,omitempty"`
	OccurredAt  string `json:"occurredAt,omitempty"` // RFC3339; optional

	// File-ingestion config. These belong to the async `ingest` collection;
	// the sync route rejects Format, Limit and Extensions since it has no
	// file to apply them to.
	Format         string `json:"format,omitempty"`        // override; else inferred from filename
	Limit          int    `json:"fragmentLimit,omitempty"` // stop after this many fragments; 0 = no limit
	Extensions     string `json:"extensions,omitempty"`    // csv zip filter
	SkipDuplicates bool   `json:"skipDuplicates,omitempty"`
}

// legacyIngestKeys maps each retired snake_case key to its current name.
var legacyIngestKeys = map[string]string{
	"ingested_via":    "ingestedVia",
	"occurred_at":     "occurredAt",
	"fragment_limit":  "fragmentLimit",
	"skip_duplicates": "skipDuplicates",
}

// UnmarshalJSON accepts both spellings. When a body carries both, the
// lowerCamelCase one wins.
func (m *IngestMessage) UnmarshalJSON(data []byte) error {
	var raw map[string]json.RawMessage
	if err := json.Unmarshal(data, &raw); err != nil {
		return err
	}
	for legacy, current := range legacyIngestKeys {
		v, ok := raw[legacy]
		if !ok {
			continue
		}
		if _, has := raw[current]; !has {
			raw[current] = v
		}
		delete(raw, legacy)
	}
	normalised, err := json.Marshal(raw)
	if err != nil {
		return err
	}
	type plain IngestMessage // no UnmarshalJSON: avoids recursion
	var p plain
	if err := json.Unmarshal(normalised, &p); err != nil {
		return err
	}
	*m = IngestMessage(p)
	return nil
}

// IngestResponse is returned by the sync POST /api/ingest endpoint.
type IngestResponse struct {
	FragmentID string `json:"fragmentId"`
	Ingested   int    `json:"ingested"`
}
