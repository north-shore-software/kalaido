package api

type IngestMessage struct {
	// Inline single-entry fields (sync endpoint).
	Type        string `json:"type,omitempty"`
	IngestedVia string `json:"ingested_via,omitempty"`
	Source      string `json:"source,omitempty"`
	Content     string `json:"content,omitempty"`
	OccurredAt  string `json:"occurred_at,omitempty"` // RFC3339; optional

	// File-ingestion config (async table; also accepted by sync for symmetry).
	Format         string `json:"format,omitempty"`         // override; else inferred from filename
	Limit          int    `json:"fragment_limit,omitempty"` // stop after this many fragments; 0 = no limit
	Extensions     string `json:"extensions,omitempty"`     // csv zip filter
	SkipDuplicates bool   `json:"skip_duplicates,omitempty"`
}

// IngestResponse is returned by the sync POST /api/ingest endpoint.
type IngestResponse struct {
	FragmentID string `json:"fragmentId"`
	Ingested   int    `json:"ingested"`
}
