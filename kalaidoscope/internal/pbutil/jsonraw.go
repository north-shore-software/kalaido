// UNREVIEWED
package pbutil

import (
	"encoding/json"
	"log/slog"

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
