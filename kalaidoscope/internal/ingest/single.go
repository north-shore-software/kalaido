package ingest

import (
	"strings"
	"time"

	"github.com/pocketbase/pocketbase/core"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/api"
)

func IngestSingle(app core.App, m api.IngestMessage) (string, error) {
	w, err := newWriter(app, 0, m.SkipDuplicates)
	if err != nil {
		return "", err
	}
	w.origin = "sync"
	fragType := strings.TrimSpace(m.Type)
	if fragType == "" {
		fragType = "note"
	}
	var occurredAt time.Time
	if m.OccurredAt != "" {
		if t, perr := time.Parse(time.RFC3339, m.OccurredAt); perr == nil {
			occurredAt = t
		}
	}
	if err := w.addAt(fragType, m.Source, m.Content, occurredAt); err != nil {
		return "", err
	}
	return w.lastID, nil
}
