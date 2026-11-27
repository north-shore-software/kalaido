package parsers

import (
	"archive/zip"
	"bytes"
	"context"
	"fmt"
	"io"
	"log/slog"
	"strings"
	"unicode/utf8"
)

const (
	// Matches apps/desktop/src-tauri/src/files.rs (MAX_ARCHIVE_DEPTH, SAMPLE_SIZE).
	maxArchiveDepth = 16
	textSampleSize  = 8192
)

func parseZip(ctx context.Context, src Source, exts []string, emit Emit, depth int) error {
	zr, err := zip.NewReader(bytes.NewReader(src.Data), int64(len(src.Data)))
	if err != nil {
		return fmt.Errorf("invalid zip archive: %w", err)
	}
	if len(exts) == 0 && isDocxZip(zr) {
		return parseDocx(ctx, Source{Name: src.Name, Format: "docx", Data: src.Data}, emit)
	}
	return parseZipReader(ctx, zr, exts, emit, depth)
}

func parseZipReader(ctx context.Context, zr *zip.Reader, exts []string, emit Emit, depth int) error {
	for _, f := range zr.File {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		if f.FileInfo().IsDir() || isMacOSMetadata(f.Name) {
			continue
		}
		if len(exts) > 0 && !matchExt(f.Name, exts) {
			continue
		}
		rc, err := f.Open()
		if err != nil {
			slog.Default().With("component", "ingest").Warn("skipping unreadable zip entry", "file", f.Name, "error", err)
			continue
		}
		data, err := io.ReadAll(rc)
		rc.Close()
		if err != nil {
			slog.Default().With("component", "ingest").Warn("skipping unreadable zip entry", "file", f.Name, "error", err)
			continue
		}

		if len(exts) > 0 {
			if err := parseWithDepth(ctx, Source{Name: f.Name, Data: data}, exts, emit, depth+1); err != nil {
				return err
			}
			continue
		}

		if err := parseZipEntryByContent(ctx, f.Name, data, emit, depth+1); err != nil {
			return err
		}
	}
	return nil
}

func parseZipEntryByContent(ctx context.Context, name string, data []byte, emit Emit, depth int) error {
	if isZipSignature(data) {
		if depth > maxArchiveDepth {
			return nil
		}
		inner, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
		if err != nil {
			return nil
		}
		if isDocxZip(inner) {
			return parseDocx(ctx, Source{Name: name, Format: "docx", Data: data}, emit)
		}
		return parseZipReader(ctx, inner, nil, emit, depth)
	}

	sample := data
	if len(sample) > textSampleSize {
		sample = sample[:textSampleSize]
	}
	if !looksLikeText(sample) {
		return nil
	}

	format := inferFormat(name)
	if format == "zip" || format == "docx" {
		format = "text"
	}
	return parseWithDepth(ctx, Source{Name: name, Format: format, Data: data}, nil, emit, depth)
}

func isMacOSMetadata(name string) bool {
	last := ""
	for _, seg := range strings.FieldsFunc(name, func(r rune) bool {
		return r == '/' || r == '\\'
	}) {
		if seg == "__MACOSX" {
			return true
		}
		last = seg
	}
	return last == ".DS_Store" || strings.HasPrefix(last, "._")
}

func isZipSignature(data []byte) bool {
	if len(data) < 4 {
		return false
	}
	return data[0] == 'P' && data[1] == 'K' &&
		((data[2] == 0x03 && data[3] == 0x04) ||
			(data[2] == 0x05 && data[3] == 0x06) ||
			(data[2] == 0x07 && data[3] == 0x08))
}

func isDocxZip(zr *zip.Reader) bool {
	for _, f := range zr.File {
		if f.Name == "word/document.xml" {
			return true
		}
	}
	return false
}

func looksLikeText(sample []byte) bool {
	if len(sample) == 0 {
		return true
	}
	if bytes.IndexByte(sample, 0) >= 0 {
		return false
	}
	if utf8.Valid(sample) {
		return true
	}
	// A multi-byte UTF-8 rune chopped at the sample boundary is still valid text.
	for trim := 1; trim <= 3 && trim <= len(sample); trim++ {
		tail := sample[len(sample)-trim:]
		if !utf8.FullRune(tail) && utf8.Valid(sample[:len(sample)-trim]) {
			return true
		}
	}
	bad := 0
	for _, b := range sample {
		if isControlByte(b) {
			bad++
		}
	}
	return float64(bad)/float64(len(sample)) < 0.30
}

func isControlByte(b byte) bool {
	switch b {
	case '\t', '\n', '\r', 0x0C:
		return false
	}
	return b <= 0x1F || b == 0x7F
}
