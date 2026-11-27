package parsers

import (
	"context"
	"io"
	"path/filepath"
	"strings"
	"time"
)

type Source struct {
	Name   string // entry/file name; drives format inference and the default fragment source
	Format string // "zip" | "mbox" | "eml" | "docx" | "text" | "" (infer from Name)
	Data   []byte // raw payload
}

type Fragment struct {
	Type       string    // "email" | "note"
	Source     string    // source label
	Content    string    // text content
	SourceTime time.Time // event time; zero = unknown (core defaults to ingestion time)
}

type Emit func(Fragment) error

func Parse(ctx context.Context, src Source, exts []string, emit Emit) error {
	return parseWithDepth(ctx, src, exts, emit, 0)
}

func parseWithDepth(ctx context.Context, src Source, exts []string, emit Emit, depth int) error {
	format := src.Format
	if format == "" {
		format = inferFormat(src.Name)
	}

	switch format {
	case "zip":
		return parseZip(ctx, src, exts, emit, depth)
	case "mbox":
		return parseMbox(ctx, src, emit)
	case "eml":
		return parseEml(ctx, src, emit)
	case "docx":
		return parseDocx(ctx, src, emit)
	default: // "text"
		return parseText(ctx, src, emit)
	}
}

func inferFormat(name string) string {
	switch strings.ToLower(filepath.Ext(name)) {
	case ".mbox":
		return "mbox"
	case ".eml":
		return "eml"
	case ".zip":
		return "zip"
	case ".docx":
		return "docx"
	default:
		return "text"
	}
}

func matchExt(name string, extensions []string) bool {
	lname := strings.ToLower(name)
	for _, ext := range extensions {
		if strings.HasSuffix(lname, ext) {
			return true
		}
	}
	return false
}

func readAllString(r io.Reader) string {
	b, _ := io.ReadAll(r)
	return string(b)
}
