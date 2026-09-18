package pbutil

import (
	"encoding/json"

	"github.com/pocketbase/pocketbase/tools/types"
)

func JSONObject(v any) types.JSONRaw {
	b, err := json.Marshal(v)
	if err != nil {
		logger().Error("json marshal failed", "error", err)
		return types.JSONRaw([]byte(`{}`))
	}
	return types.JSONRaw(b)
}
