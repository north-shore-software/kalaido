package pbutil

import (
	"encoding/json"
	"log"

	"github.com/pocketbase/pocketbase/tools/types"
)

func JSONString(s string) types.JSONRaw {
	b, err := json.Marshal(s)
	if err != nil {
		log.Printf("pbutil.JSONString marshal: %v", err)
		return types.JSONRaw([]byte(`""`))
	}
	return types.JSONRaw(b)
}

func JSONObject(v any) types.JSONRaw {
	b, err := json.Marshal(v)
	if err != nil {
		log.Printf("pbutil.JSONObject marshal: %v", err)
		return types.JSONRaw([]byte(`{}`))
	}
	return types.JSONRaw(b)
}

func DecodeJSONString(raw string) string {
	var s string
	if json.Unmarshal([]byte(raw), &s) == nil {
		return s
	}
	return raw
}
