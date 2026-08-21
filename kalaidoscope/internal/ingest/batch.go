package ingest

import (
	"context"
	"errors"
	"fmt"
	"io"
	"log"
	"strings"

	"github.com/pocketbase/pocketbase/core"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/ingest/parsers"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/mapping"
)

func RegisterHooks(app core.App) {
	app.OnRecordCreate("ingest").BindFunc(func(e *core.RecordEvent) error {
		files, err := readUnsavedFiles(e.Record)
		if err != nil {
			log.Printf("ingest: read uploads: %v", err)
		}
		cfg := readConfig(e.Record)

		e.Record.Set("status", "pending")
		if err := e.Next(); err != nil {
			return err
		}

		go processIngestRecord(app, e.Record.Id, cfg, files)
		return nil
	})
}

type options struct {
	Format         string
	Limit          int
	Extensions     []string
	SkipDuplicates bool
	SourceName     string
	Data           []byte
}

var errBudget = errors.New("ingest: write budget reached")

var defaultExtensions = []string{".txt", ".md", ".docx"}

type uploadedFile struct {
	name string
	data []byte
}

type ingestConfig struct {
	format         string
	limit          int
	extensions     []string
	skipDuplicates bool
	organizeAfter  bool
}

func run(ctx context.Context, app core.App, opts options, progress func(ingested int)) (int, error) {
	w, err := newWriter(app, opts.Limit, opts.SkipDuplicates)
	if err != nil {
		return 0, err
	}
	w.origin = "import"

	exts := opts.Extensions
	if len(exts) == 0 {
		exts = defaultExtensions
	}

	sink := func(fr parsers.Fragment) error {
		if w.full() {
			return errBudget
		}
		if err := w.addAt(fr.Type, fr.Source, fr.Content, fr.SourceTime); err != nil {
			return err
		}
		if progress != nil {
			progress(w.count)
		}
		return nil
	}

	src := parsers.Source{Name: opts.SourceName, Format: opts.Format, Data: opts.Data}
	err = parsers.Parse(ctx, src, exts, sink)
	if err != nil && !errors.Is(err, errBudget) && !errors.Is(err, context.Canceled) {
		return w.count, err
	}
	return w.count, nil
}

func readConfig(rec *core.Record) ingestConfig {
	return ingestConfig{
		format:         rec.GetString("format"),
		limit:          int(rec.GetInt("limit")),
		extensions:     normalizeExtensions(rec.GetString("extensions")),
		skipDuplicates: rec.GetBool("skip_duplicates"),
		organizeAfter:  rec.GetBool("organize_after"),
	}
}

func readUnsavedFiles(rec *core.Record) ([]uploadedFile, error) {
	unsaved := rec.GetUnsavedFiles("file")
	out := make([]uploadedFile, 0, len(unsaved))
	for _, f := range unsaved {
		rc, err := f.Reader.Open()
		if err != nil {
			return out, fmt.Errorf("open upload %q: %w", f.OriginalName, err)
		}
		data, err := io.ReadAll(rc)
		rc.Close()
		if err != nil {
			return out, fmt.Errorf("read upload %q: %w", f.OriginalName, err)
		}
		out = append(out, uploadedFile{name: f.OriginalName, data: data})
	}
	return out, nil
}

func processIngestRecord(app core.App, recID string, cfg ingestConfig, files []uploadedFile) {
	ctx := context.Background()

	total := 0
	var ingestErr error
	for _, uf := range files {
		n, err := run(ctx, app, options{
			Format:         cfg.format,
			Limit:          cfg.limit,
			Extensions:     cfg.extensions,
			SkipDuplicates: cfg.skipDuplicates,
			SourceName:     uf.name,
			Data:           uf.data,
		}, nil)
		total += n
		if err != nil {
			ingestErr = err
			log.Printf("ingest: processing %q: %v", uf.name, err)
			break
		}
	}

	rec, err := app.FindRecordById("ingest", recID)
	if err != nil {
		log.Printf("ingest: reload record %s: %v", recID, err)
		return
	}
	rec.Set("ingested", total)
	if ingestErr != nil {
		rec.Set("status", "error")
		rec.Set("error", ingestErr.Error())
	} else {
		rec.Set("status", "done")
	}
	if err := app.Save(rec); err != nil {
		log.Printf("ingest: save status for %s: %v", recID, err)
	}
	log.Printf("ingest: completed record %s (ingested %d fragments across %d file(s))", recID, total, len(files))
	switch {
	case cfg.organizeAfter && ingestErr != nil:
		setPipeline(app, recID, "error", ingestErr)
		mapping.Signal()
	case cfg.organizeAfter:
		startPipeline(app, recID)
	default:
		mapping.Signal()
	}
}

func normalizeExtensions(s string) []string {
	var out []string
	for _, p := range strings.Split(s, ",") {
		p = strings.TrimSpace(strings.ToLower(p))
		if p == "" {
			continue
		}
		if !strings.HasPrefix(p, ".") {
			p = "." + p
		}
		out = append(out, p)
	}
	return out
}
