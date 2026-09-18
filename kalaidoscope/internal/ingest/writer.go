package ingest

import (
	"crypto/sha256"
	"fmt"
	"strings"
	"time"

	"github.com/north-shore-software/kalaido/kalaidoscope/schema"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/types"
)

// importBatch is how many fragments an import commits per transaction. One
// transaction per fragment costs a disk sync each; one per import would hold
// PocketBase's single write connection for the whole parse of a large
// archive. A page of a hundred is a compromise between the two.
const importBatch = 100

type writer struct {
	app    core.App
	col    *core.Collection
	limit  int                   // 0 = unlimited
	seen   map[[32]byte]struct{} // nil when dedupe is disabled
	count  int                   // records actually created
	lastID string                // id of the most recently created fragment
	origin string
	// batch is how many records one transaction commits; 1 saves each
	// fragment as it arrives. pending holds the built records not yet saved.
	batch   int
	pending []*core.Record
}

func newWriter(app core.App, limit int, skipDuplicates bool) (*writer, error) {
	col, err := app.FindCollectionByNameOrId(schema.ColFragment.String())
	if err != nil {
		return nil, fmt.Errorf("fragment collection missing: %w", err)
	}
	w := &writer{app: app, col: col, limit: limit, batch: 1}
	if skipDuplicates {
		w.seen = map[[32]byte]struct{}{}
		if records, err := app.FindAllRecords(schema.ColFragment.String()); err == nil {
			for _, r := range records {
				w.seen[sha256.Sum256([]byte(r.GetString("content")))] = struct{}{}
			}
		} else {
			logger().Warn("preload existing fragments for dedupe failed", "error", err)
		}
	}
	return w, nil
}

func (w *writer) full() bool { return w.limit > 0 && w.count+len(w.pending) >= w.limit }

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
	rec.Set("ingested_via", w.origin)
	rec.Set("source", source)
	rec.Set("content", content)
	if !sourceTime.IsZero() {
		if dt, err := types.ParseDateTime(sourceTime); err == nil {
			rec.Set("occurred_at", dt)
		}
	}
	w.pending = append(w.pending, rec)
	if len(w.pending) >= w.batch {
		return w.flush()
	}
	return nil
}

// flush commits every pending record in one transaction. The fragment
// after-create hooks fire once it commits, so the workers they signal see
// the whole page at once. On failure the page is dropped and the count
// stays at what actually landed.
func (w *writer) flush() error {
	if len(w.pending) == 0 {
		return nil
	}
	page := w.pending
	w.pending = nil
	err := w.app.RunInTransaction(func(tx core.App) error {
		for _, rec := range page {
			if err := tx.Save(rec); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		return err
	}
	w.count += len(page)
	w.lastID = page[len(page)-1].Id
	return nil
}
