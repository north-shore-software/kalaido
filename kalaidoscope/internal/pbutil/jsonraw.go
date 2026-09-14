package pbutil

import (
	"encoding/json"
	"log"

	"github.com/pocketbase/pocketbase/tools/types"
)

func JSONObject(v any) types.JSONRaw {
	b, err := json.Marshal(v)
	if err != nil {
		log.Printf("pbutil.JSONObject marshal: %v", err)
		return types.JSONRaw([]byte(`{}`))
	}
	return types.JSONRaw(b)
}
