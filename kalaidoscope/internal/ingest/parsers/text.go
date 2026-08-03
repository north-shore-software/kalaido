package parsers

import (
	"context"
	"strings"
)

func parseText(ctx context.Context, src Source, emit Emit) error {
	if ctx.Err() != nil {
		return ctx.Err()
	}
	source := src.Name
	if strings.TrimSpace(source) == "" {
		source = "imported text"
	}
	return emit(Fragment{Type: "note", Source: source, Content: string(src.Data)})
}
