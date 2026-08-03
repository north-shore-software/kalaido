package parsers

import (
	"archive/zip"
	"bytes"
	"context"
	"fmt"
	"io"
	"log"
)

func parseZip(ctx context.Context, src Source, exts []string, emit Emit) error {
	zr, err := zip.NewReader(bytes.NewReader(src.Data), int64(len(src.Data)))
	if err != nil {
		return fmt.Errorf("invalid zip archive: %w", err)
	}

	for _, f := range zr.File {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		if f.FileInfo().IsDir() {
			continue
		}
		if len(exts) > 0 && !matchExt(f.Name, exts) {
			continue
		}
		rc, err := f.Open()
		if err != nil {
			log.Printf("ingest: open zip entry %q: %v", f.Name, err)
			continue
		}
		data, _ := io.ReadAll(rc)
		rc.Close()

		if err := Parse(ctx, Source{Name: f.Name, Data: data}, exts, emit); err != nil {
			return err
		}
	}
	return nil
}
