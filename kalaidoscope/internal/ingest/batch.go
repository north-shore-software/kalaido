// UNREVIEWED
package ingest

import (
	"context"
	"errors"
	"fmt"
	"io"
	"strings"

	"github.com/pocketbase/pocketbase/core"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/discover"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/engine"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/ingest/parsers"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/mapping"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/reconcile"
	"github.com/north-shore-software/kalaido/kalaidoscope/schema"
)

// Deps are the workers an import hands off to once its fragments are in.
type Deps struct {
	Mapping   *mapping.Worker
	Reconcile *reconcile.Worker
	Discover  *discover.Worker
	// Runner owns the processing goroutine, so shutdown can cancel and
	// await an import in progress.
	Runner engine.Runner
}

// RegisterHooks processes every new `ingest` record off the request
// goroutine: the row is forced to pending, the uploads are parsed, and the
// row ends done or error.
func RegisterHooks(app core.App, deps Deps) {
	app.OnRecordCreate("ingest").BindFunc(func(e *core.RecordEvent) error {
		files, err := readUnsavedFiles(e.Record)
		if err != nil {
			logger().Error("read uploads failed", "error", err)
		}
		cfg := readConfig(e.Record)

		e.Record.Set("status", "pending")
		if err := e.Next(); err != nil {
			return err
		}

		recID := e.Record.Id
		deps.Runner.Go(func(ctx context.Context) {
			processIngestRecord(ctx, app, deps, recID, cfg, files)
		})
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
	w.batch = importBatch

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
	// Whatever ended the parse, the fragments it did yield are good.
	if ferr := w.flush(); ferr != nil {
		return w.count, ferr
	}
	// A cancelled parse is an incomplete import: report it so the record is
	// marked failed rather than done with a partial count.
	if err != nil && !errors.Is(err, errBudget) {
		return w.count, err
	}
	return w.count, nil
}

func readConfig(rec *core.Record) ingestConfig {
	return ingestConfig{
		format:         rec.GetString("format"),
		limit:          int(rec.GetInt("fragment_limit")),
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

func processIngestRecord(ctx context.Context, app core.App, deps Deps, recID string, cfg ingestConfig, files []uploadedFile) {
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
			logger().Error("processing file failed", "file", uf.name, "error", err)
			break
		}
	}

	rec, err := app.FindRecordById(schema.ColIngest.String(), recID)
	if err != nil {
		logger().Error("reload record failed", "record_id", recID, "error", err)
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
		logger().Error("save status failed", "record_id", recID, "error", err)
	}
	logger().Info("completed record", "record_id", recID, "fragments", total, "files", len(files))
	// The batch is in: every lens over these fragments can now be
	// regenerated ahead of the user. Colour and map follow-ups re-request
	// the wave as they change membership; each re-run skips what is current.
	if total > 0 {
		deps.Reconcile.EnqueueWave()
	}
	if cfg.organizeAfter {
		startPipeline(deps)
		return
	}
	deps.Mapping.SignalAnnotate()
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
