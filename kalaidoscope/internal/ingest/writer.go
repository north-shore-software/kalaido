package ingest

import (
	"crypto/sha256"
	"fmt"
	"log"
	"strings"
	"time"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/types"
)

type writer struct {
	app    core.App
	col    *core.Collection
	limit  int                   // 0 = unlimited
	seen   map[[32]byte]struct{} // nil when dedupe is disabled
	count  int                   // records actually created
	lastID string                // id of the most recently created fragment
}

func newWriter(app core.App, limit int, skipDuplicates bool) (*writer, error) {
	col, err := app.FindCollectionByNameOrId("fragment")
	if err != nil {
		return nil, fmt.Errorf("fragment collection missing: %w", err)
	}
	w := &writer{app: app, col: col, limit: limit}
	if skipDuplicates {
		w.seen = map[[32]byte]struct{}{}
		if records, err := app.FindAllRecords("fragment"); err == nil {
			for _, r := range records {
				w.seen[sha256.Sum256([]byte(r.GetString("content")))] = struct{}{}
			}
		} else {
			log.Printf("ingest: preload existing fragments for dedupe: %v", err)
		}
	}
	return w, nil
}

func (w *writer) full() bool { return w.limit > 0 && w.count >= w.limit }

func (w *writer) addAt(fragType, source, content string, sourceTime time.Time) error {
	content = strings.TrimSpace(content)
	if content == "" {
		return nil
	}
	if w.seen != nil {
		h := sha256.Sum256([]byte(content))
		if _, ok := w.seen[h]; ok {
			return nil
		}
		w.seen[h] = struct{}{}
	}
	rec := core.NewRecord(w.col)
	rec.Set("type", fragType)
	rec.Set("source", source)
	rec.Set("content", content)
	if !sourceTime.IsZero() {
		if dt, err := types.ParseDateTime(sourceTime); err == nil {
			rec.Set("source_time", dt)
		}
	}
	if err := w.app.Save(rec); err != nil {
		return err
	}
	w.count++
	w.lastID = rec.Id
	return nil
}
