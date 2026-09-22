// UNREVIEWED
package pbutil

import (
	"encoding/json"
	"log/slog"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/types"
)

func JSONObject(v any) types.JSONRaw {
	b, err := json.Marshal(v)
	if err != nil {
		slog.Default().With("component", "pbutil").Error("json marshal failed", "error", err)
		return types.JSONRaw([]byte(`{}`))
	}
	return types.JSONRaw(b)
}

// RawJSONField extracts a record's JSON field as a raw JSON string, or "" if empty or invalid.
func RawJSONField(rec *core.Record, field string) string {
	if rec == nil {
		return ""
	}
	var raw json.RawMessage
	if err := rec.UnmarshalJSONField(field, &raw); err != nil || len(raw) == 0 {
		return ""
	}
	return string(raw)
}
